// [START] Phase 8.2 — PTY terminal management.
// Spawns real shell processes (bash/zsh) with pseudo-terminals so the
// frontend xterm.js instance gets proper ANSI escape handling, job control,
// and interactive programs (vim, top, etc.).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

pub const PTY_OUTPUT_EVENT: &str = "pty://output";

// ── Per-PTY state ────────────────────────────────────────────────────────────

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    pair: portable_pty::PtyPair,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtyState {
    instances: Mutex<HashMap<String, PtyInstance>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }
}

// ── Output event payload ─────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
struct PtyOutputEvent {
    pty_id: String,
    data: String,
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Spawn a new PTY shell in the given project directory.
/// Returns a pty_id that the frontend uses for all subsequent operations.
#[tauri::command]
pub fn pty_spawn(
    project_root: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyState>,
    app: AppHandle,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    // Detect user's shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&project_root);
    // Inherit environment so PATH, LANG, etc. are available
    for (key, val) in std::env::vars() {
        cmd.env(key, val);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;

    let pty_id = uuid::Uuid::new_v4().to_string();

    // [START] Stdout reader thread — reads PTY output and emits Tauri events.
    let event_id = pty_id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — shell exited
                Ok(n) => {
                    // Send as UTF-8 lossy (terminal output is mostly ASCII/UTF-8)
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        PTY_OUTPUT_EVENT,
                        PtyOutputEvent {
                            pty_id: event_id.clone(),
                            data: text,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });
    // [END]

    let instance = PtyInstance {
        writer,
        pair,
        child,
    };

    state
        .instances
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(pty_id.clone(), instance);

    Ok(pty_id)
}

/// Write data (keystrokes) to the PTY.
#[tauri::command]
pub fn pty_write(
    pty_id: String,
    data: String,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap_or_else(|e| e.into_inner());
    let instance = instances
        .get_mut(&pty_id)
        .ok_or_else(|| format!("pty not found: {pty_id}"))?;
    instance
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    instance
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

/// Resize the PTY (e.g., when the terminal panel resizes).
#[tauri::command]
pub fn pty_resize(
    pty_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let instances = state.instances.lock().unwrap_or_else(|e| e.into_inner());
    let instance = instances
        .get(&pty_id)
        .ok_or_else(|| format!("pty not found: {pty_id}"))?;
    instance
        .pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}

/// Kill the PTY process and clean up.
#[tauri::command]
pub fn pty_kill(
    pty_id: String,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut instance) = instances.remove(&pty_id) {
        let _ = instance.child.kill();
        log::info!("pty killed: {pty_id}");
    }
    Ok(())
}
// [END] Phase 8.2
