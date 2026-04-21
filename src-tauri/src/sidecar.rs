use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub const STATUS_EVENT: &str = "sidecar://status";
pub const BOOTSTRAP_LOG_EVENT: &str = "sidecar://bootstrap/log";

/// Three FastAPI ports served by the Python sidecar.
/// Must stay in sync with `sidecar/src/ovo_sidecar/config.py` defaults.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SidecarPorts {
    pub ollama: u16,
    pub openai: u16,
    pub native: u16,
}

impl Default for SidecarPorts {
    fn default() -> Self {
        Self {
            ollama: 11435,
            openai: 11436,
            native: 11437,
        }
    }
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SidecarHealth {
    Stopped,
    /// First-run runtime install: `uv sync` is creating the Python venv in the
    /// user's Application Support directory. UI shows progress modal.
    Bootstrapping,
    Starting,
    Healthy,
    Failed,
}

#[derive(Clone, Serialize, Debug)]
pub struct SidecarStatus {
    pub health: SidecarHealth,
    pub ports: SidecarPorts,
    pub pid: Option<u32>,
    pub message: Option<String>,
    pub healthy_apis: Vec<String>,
    /// Last stderr line emitted by `uv sync` during bootstrap. Cleared once
    /// health transitions away from Bootstrapping.
    pub bootstrap_progress: Option<String>,
}

pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    status: Mutex<SidecarStatus>,
    // Incremented every time a new child is spawned. Log-pump and health-loop
    // tasks capture the generation they were started with and bail out if it
    // no longer matches the current one — prevents a stale Terminated event
    // from a killed child clobbering the freshly-spawned child's status.
    generation: AtomicU64,
    // [START] Auto-restart limiter — tracks consecutive crash restarts.
    // Resets to 0 on successful health check. Caps at 3 to prevent infinite loops.
    auto_restart_count: AtomicU64,
    // [END]
}

impl SidecarState {
    fn new(ports: SidecarPorts) -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(SidecarStatus {
                health: SidecarHealth::Stopped,
                ports,
                pid: None,
                message: None,
                healthy_apis: vec![],
                bootstrap_progress: None,
            }),
            generation: AtomicU64::new(0),
            auto_restart_count: AtomicU64::new(0),
        }
    }

    pub fn snapshot(&self) -> SidecarStatus {
        self.status.lock().unwrap().clone()
    }
}

// [START] Phase R — runtime install layout.
// Venv lives in the user's Application Support directory so it survives app
// upgrades and sits outside the signed `.app` bundle (the bundle is read-only
// on release builds — we can never write into Contents/Resources).
fn user_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("runtime"))
}

fn user_venv_path(app: &AppHandle) -> Option<PathBuf> {
    user_runtime_dir(app).map(|d| d.join("sidecar-venv"))
}

fn user_venv_sidecar_bin(app: &AppHandle) -> Option<PathBuf> {
    user_venv_path(app).map(|v| v.join("bin").join("ovo-sidecar"))
}

fn bundled_sidecar_source(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    // Tauri flattens `resources/sidecar/**` into `Contents/Resources/resources/sidecar/`.
    let p = resource_dir.join("resources").join("sidecar");
    if p.exists() { Some(p) } else { None }
}

fn bundled_uv_binary(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let p = resource_dir
        .join("resources")
        .join("bin")
        .join("uv-aarch64-apple-darwin");
    if p.exists() { Some(p) } else { None }
}

/// Root where `uv sync` should create the venv. We pin this via
/// `UV_PROJECT_ENVIRONMENT` so the venv location is deterministic regardless
/// of uv's normal project-root discovery (which would pick the bundled
/// read-only sidecar dir).
fn resolve_venv_env(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let venv = user_venv_path(app)?;
    if let Some(parent) = venv.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let src = bundled_sidecar_source(app)?;
    Some((venv, src))
}
// [END]

/// What `resolve_command` decided to spawn.
enum SpawnMode {
    /// User venv is ready — run the sidecar executable directly.
    Run(tauri_plugin_shell::process::Command),
    /// Venv missing — run `uv sync` to create it. On successful termination
    /// the orchestrator recursively re-spawns into Run mode.
    Bootstrap(tauri_plugin_shell::process::Command),
}

// [START] managed sidecar lifecycle — spawn, health monitor, kill on exit
pub fn setup(app: &AppHandle) {
    app.manage(SidecarState::new(SidecarPorts::default()));
    spawn(app.clone());
}

pub fn spawn(app: AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else {
        log::error!("SidecarState not managed — setup() must run first");
        return;
    };
    let ports = state.snapshot().ports;

    let Some(mode) = resolve_command(&app) else {
        update_status(&app, |s| {
            s.health = SidecarHealth::Failed;
            s.message = Some(
                "sidecar command not found — runtime missing and no bundle/dev fallback".into(),
            );
        });
        return;
    };

    match mode {
        SpawnMode::Run(cmd) => spawn_run(&app, cmd, ports),
        SpawnMode::Bootstrap(cmd) => spawn_bootstrap(app.clone(), cmd),
    }
}

fn spawn_run(
    app: &AppHandle,
    command: tauri_plugin_shell::process::Command,
    ports: SidecarPorts,
) {
    let Some(state) = app.try_state::<SidecarState>() else { return };

    update_status(app, |s| {
        s.health = SidecarHealth::Starting;
        s.message = None;
        s.healthy_apis.clear();
        s.bootstrap_progress = None;
    });

    let (mut rx, child) = match command.spawn() {
        Ok(r) => r,
        Err(e) => {
            update_status(app, |s| {
                s.health = SidecarHealth::Failed;
                s.message = Some(format!("spawn failed: {e}"));
            });
            return;
        }
    };

    let pid = child.pid();
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut guard = state.child.lock().unwrap();
        *guard = Some(child);
    }
    update_status(app, |s| s.pid = Some(pid));

    // Log pump
    let app_logs = app.clone();
    let gen_logs = generation;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!(target: "sidecar", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    log::warn!(target: "sidecar", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(e) => {
                    log::error!(target: "sidecar", "{e}");
                }
                CommandEvent::Terminated(payload) => {
                    log::error!(target: "sidecar", "terminated gen={gen_logs}: {payload:?}");
                    let still_current = app_logs
                        .try_state::<SidecarState>()
                        .map(|s| s.generation.load(Ordering::SeqCst) == gen_logs)
                        .unwrap_or(false);
                    if still_current {
                        update_status(&app_logs, |s| {
                            s.health = SidecarHealth::Stopped;
                            s.pid = None;
                            s.healthy_apis.clear();
                            s.message = Some(format!("terminated (code {:?})", payload.code));
                        });
                        if let Some(state) = app_logs.try_state::<SidecarState>() {
                            state.child.lock().unwrap().take();
                        }
                        // [START] Auto-restart — schedule a full restart (kill ports + respawn)
                        // after 3 s so the app recovers from OOM / Metal faults. Capped at
                        // 3 consecutive attempts to prevent infinite crash loops when the
                        // sidecar can't start at all (missing dependency, bad config, etc.).
                        if let Some(st) = app_logs.try_state::<SidecarState>() {
                            let count = st.auto_restart_count.fetch_add(1, Ordering::SeqCst);
                            if count < 3 {
                                let app_restart = app_logs.clone();
                                tauri::async_runtime::spawn(async move {
                                    log::info!(target: "sidecar", "auto-restart {}/3 scheduled in 3s", count + 1);
                                    tokio::time::sleep(Duration::from_secs(3)).await;
                                    restart(app_restart).await;
                                });
                            } else {
                                log::error!(target: "sidecar", "auto-restart limit reached (3/3) — giving up");
                                update_status(&app_logs, |s| {
                                    s.message = Some("auto-restart failed after 3 attempts".into());
                                });
                            }
                        }
                        // [END]
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    // Health monitor
    let app_hc = app.clone();
    let gen_hc = generation;
    tauri::async_runtime::spawn(async move {
        health_loop(app_hc, ports, gen_hc).await;
    });
}

// [START] Phase R — bootstrap flow.
// Spawns `uv sync` with UV_PROJECT_ENVIRONMENT pointed at the user cache.
// Stream stderr to the frontend so the first-run UI can show progress.
// On clean exit we recursively call spawn() which this time picks up the
// newly-minted venv and enters Run mode.
fn spawn_bootstrap(app: AppHandle, command: tauri_plugin_shell::process::Command) {
    update_status(&app, |s| {
        s.health = SidecarHealth::Bootstrapping;
        s.pid = None;
        s.healthy_apis.clear();
        s.message = Some("installing AI runtime…".into());
        s.bootstrap_progress = Some("step 1/2: preparing Python environment…".into());
    });

    let (mut rx, _child) = match command.spawn() {
        Ok(r) => r,
        Err(e) => {
            update_status(&app, |s| {
                s.health = SidecarHealth::Failed;
                s.message = Some(format!("bootstrap spawn failed: {e}"));
                s.bootstrap_progress = None;
            });
            return;
        }
    };

    let app_logs = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_err: Option<String> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line).trim_end().to_string();
                    log::info!(target: "sidecar.boot", "{s}");
                    let _ = app_logs.emit(BOOTSTRAP_LOG_EVENT, &s);
                    if !s.is_empty() {
                        update_status(&app_logs, |st| st.bootstrap_progress = Some(s.clone()));
                    }
                }
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line).trim_end().to_string();
                    log::info!(target: "sidecar.boot", "{s}");
                    let _ = app_logs.emit(BOOTSTRAP_LOG_EVENT, &s);
                    // [START] User-friendly progress messages
                    let friendly = if s.contains("Python") && (s.contains("download") || s.contains("install")) {
                        Some("step 1/2: installing Python…".to_string())
                    } else if s.contains("Resolved") || s.contains("resolved") {
                        Some("step 2/2: resolving AI packages…".to_string())
                    } else if s.contains("Installed") || s.contains("installed") {
                        Some("step 2/2: installing AI packages…".to_string())
                    } else if s.contains("Prepared") || s.contains("prepared") {
                        Some("step 2/2: preparing packages…".to_string())
                    } else if s.contains("Built") || s.contains("built") {
                        Some("step 2/2: building packages…".to_string())
                    } else if !s.is_empty() {
                        Some(s.clone())
                    } else {
                        None
                    };
                    if let Some(msg) = friendly {
                        update_status(&app_logs, |st| st.bootstrap_progress = Some(msg));
                    }
                    // [END]
                    last_err = Some(s);
                }
                CommandEvent::Error(e) => {
                    log::error!(target: "sidecar.boot", "{e}");
                    last_err = Some(e.to_string());
                }
                CommandEvent::Terminated(payload) => {
                    let ok = matches!(payload.code, Some(0));
                    log::info!(target: "sidecar.boot", "uv sync terminated code={:?}", payload.code);
                    if ok {
                        update_status(&app_logs, |s| {
                            s.bootstrap_progress = Some("ready — launching OVO…".into());
                        });
                        // Brief pause before transitioning — lets the UI see
                        // the "ready" frame before the modal closes.
                        tokio::time::sleep(Duration::from_millis(400)).await;
                        spawn(app_logs.clone());
                    } else {
                        update_status(&app_logs, |s| {
                            s.health = SidecarHealth::Failed;
                            s.message = Some(format!(
                                "runtime install failed (exit {:?}): {}",
                                payload.code,
                                last_err
                                    .clone()
                                    .unwrap_or_else(|| "see logs".into())
                            ));
                            s.bootstrap_progress = None;
                        });
                    }
                    break;
                }
                _ => {}
            }
        }
    });
}
// [END]

pub fn kill(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        let ports = state.snapshot().ports;
        if let Some(child) = state.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        // [START] Port-level cleanup — uvicorn spawns 3 worker tasks inside a
        // single Python asyncio loop. If one task crashes uncaught (e.g. the
        // MLX worker thread fault we've hit before) the other two keep running
        // and continue to hold their ports. child.kill() only signals the
        // parent process it originally spawned; orphaned children keep the
        // ports bound. `lsof -ti:<port> | xargs kill -9` guarantees a clean
        // slate before the next spawn.
        for p in [ports.ollama, ports.openai, ports.native] {
            kill_port(p);
        }
        // [END]
        update_status(app, |s| {
            s.health = SidecarHealth::Stopped;
            s.pid = None;
            s.healthy_apis.clear();
            s.message = None;
            s.bootstrap_progress = None;
        });
    }
}

pub async fn restart(app: AppHandle) {
    kill(&app);
    // Reset auto-restart counter — manual restart is a fresh start.
    if let Some(st) = app.try_state::<SidecarState>() {
        st.auto_restart_count.store(0, Ordering::SeqCst);
    }
    // 800ms gives the OS time to release the freed ports before rebinding.
    tokio::time::sleep(Duration::from_millis(800)).await;
    spawn(app);
}

// [START] Phase R — user-facing runtime reinstall.
// Tears down the venv so the next spawn triggers a fresh bootstrap.
pub async fn reinstall_runtime(app: AppHandle) -> Result<(), String> {
    kill(&app);
    if let Some(venv) = user_venv_path(&app) {
        if venv.exists() {
            std::fs::remove_dir_all(&venv)
                .map_err(|e| format!("failed to remove venv at {}: {e}", venv.display()))?;
        }
    }
    if let Some(st) = app.try_state::<SidecarState>() {
        st.auto_restart_count.store(0, Ordering::SeqCst);
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    spawn(app);
    Ok(())
}
// [END]

// [START] kill_port — macOS helper. Uses lsof + kill -9 shelled out via
// std::process so we don't introduce a nix / libc dependency. Errors are
// swallowed (best-effort cleanup).
fn kill_port(port: u16) {
    use std::process::{Command, Stdio};

    let output = match Command::new("/usr/sbin/lsof")
        .args(["-ti", &format!(":{port}")])
        .stderr(Stdio::null())
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            log::warn!("lsof for port {port} failed: {e}");
            return;
        }
    };
    if !output.status.success() {
        return; // no process holds the port
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for pid_str in stdout.split_whitespace() {
        let Ok(pid) = pid_str.parse::<u32>() else { continue };
        let _ = Command::new("/bin/kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        log::info!("killed orphaned sidecar process pid={pid} on port {port}");
    }
}
// [END]

fn update_status<F: FnOnce(&mut SidecarStatus)>(app: &AppHandle, f: F) {
    let Some(state) = app.try_state::<SidecarState>() else { return };
    let snapshot = {
        let mut guard = state.status.lock().unwrap();
        f(&mut guard);
        guard.clone()
    };
    if let Err(e) = app.emit(STATUS_EVENT, snapshot) {
        log::warn!("emit {STATUS_EVENT} failed: {e}");
    }
}

async fn health_loop(app: AppHandle, ports: SidecarPorts, generation: u64) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::error!("reqwest client build: {e}");
            return;
        }
    };
    let endpoints: [(&str, u16); 3] = [
        ("ollama", ports.ollama),
        ("openai", ports.openai),
        ("native", ports.native),
    ];

    let started = Instant::now();
    let startup_grace = Duration::from_secs(45);
    let mut last_healthy: Vec<String> = vec![];
    let mut last_health = SidecarHealth::Starting;
    // [START] Track when health first became Healthy so the auto-restart
    // counter only resets after 60s of continuous uptime — prevents a
    // crash-restart-healthy-crash infinite loop.
    let mut healthy_since: Option<Instant> = None;
    // [END]

    loop {
        let Some(state) = app.try_state::<SidecarState>() else {
            break;
        };
        if state.generation.load(Ordering::SeqCst) != generation {
            break;
        }
        let child_alive = state.child.lock().unwrap().is_some();
        if !child_alive {
            break;
        }

        let mut healthy: Vec<String> = vec![];
        for (name, port) in endpoints {
            let url = format!("http://127.0.0.1:{port}/healthz");
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    healthy.push(name.to_string());
                }
            }
        }

        let new_health = if healthy.len() == 3 {
            // [START] Only reset auto-restart counter after 60s of continuous
            // healthy uptime. Prevents crash-restart-healthy-crash loops where
            // the sidecar briefly passes healthz then dies again.
            if healthy_since.is_none() {
                healthy_since = Some(Instant::now());
            }
            if let Some(since) = healthy_since {
                if since.elapsed() > Duration::from_secs(60) {
                    if let Some(st) = app.try_state::<SidecarState>() {
                        let prev = st.auto_restart_count.swap(0, Ordering::SeqCst);
                        if prev > 0 {
                            log::info!("sidecar stable for 60s — auto-restart counter reset");
                        }
                    }
                }
            }
            // [END]
            SidecarHealth::Healthy
        } else if started.elapsed() > startup_grace {
            healthy_since = None; // lost health — reset stability timer
            SidecarHealth::Failed
        } else {
            healthy_since = None;
            SidecarHealth::Starting
        };

        if new_health != last_health || healthy != last_healthy {
            let captured_health = new_health.clone();
            let captured_healthy = healthy.clone();
            update_status(&app, |s| {
                s.health = captured_health;
                s.healthy_apis = captured_healthy;
                if s.health != SidecarHealth::Failed {
                    s.message = None;
                } else {
                    s.message = Some(format!(
                        "only {}/3 APIs healthy after {}s",
                        healthy.len(),
                        startup_grace.as_secs()
                    ));
                }
            });
            last_health = new_health;
            last_healthy = healthy;
        }

        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}

fn resolve_command(app: &AppHandle) -> Option<SpawnMode> {
    let shell = app.shell();

    // 1. Installed runtime: user venv has the ovo-sidecar entry script.
    if let Some(bin) = user_venv_sidecar_bin(app) {
        if bin.exists() {
            log::info!("using installed sidecar at {}", bin.display());
            return Some(SpawnMode::Run(
                shell.command(bin.to_string_lossy().to_string()),
            ));
        }
    }

    // 2. Bundled source present but runtime not yet installed → bootstrap.
    if let (Some(uv), Some((venv, src))) = (bundled_uv_binary(app), resolve_venv_env(app)) {
        // Quarantine scrub — bundled uv ships inside a (potentially
        // quarantined) .app. Stripping com.apple.quarantine before the first
        // spawn avoids Gatekeeper blocking the subprocess on unsigned builds.
        let _ = std::process::Command::new("/usr/bin/xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&uv)
            .status();

        log::info!(
            "bootstrapping sidecar venv → {} (source: {}, uv: {})",
            venv.display(),
            src.display(),
            uv.display()
        );
        let cmd = shell
            .command(uv.to_string_lossy().to_string())
            .args([
                "sync",
                "--project",
                src.to_string_lossy().as_ref(),
                "--no-dev",
            ])
            .env("UV_PROJECT_ENVIRONMENT", venv.to_string_lossy().as_ref())
            // uv emits nicer progress when it can detect a TTY. We're reading
            // a pipe; force color off to keep log lines clean.
            .env("NO_COLOR", "1")
            // Pin the cache inside the runtime dir so uninstall is a single
            // directory removal and we never spill into the user's global
            // uv cache.
            .env(
                "UV_CACHE_DIR",
                user_runtime_dir(app)
                    .map(|d| d.join("uv-cache").to_string_lossy().into_owned())
                    .unwrap_or_default(),
            );
        return Some(SpawnMode::Bootstrap(cmd));
    }

    // 3. Dev fallback — running `npm run tauri dev` from the repo.
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(script) = find_dev_script(&cwd) {
            log::info!("using dev sidecar via {}", script.display());
            return Some(SpawnMode::Run(
                shell
                    .command("/usr/bin/env")
                    .args(["bash", script.to_string_lossy().as_ref()]),
            ));
        }
    }

    None
}

fn find_dev_script(start: &Path) -> Option<PathBuf> {
    let mut cur = start.to_path_buf();
    for _ in 0..6 {
        let candidate = cur.join("sidecar").join("scripts").join("dev.sh");
        if candidate.exists() {
            return Some(candidate);
        }
        cur = cur.parent()?.to_path_buf();
    }
    None
}
// [END]
