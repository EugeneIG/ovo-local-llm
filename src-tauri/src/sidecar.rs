use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

pub fn spawn(app: AppHandle) {
    let shell = app.shell();

    let resource_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("sidecar"))
        .filter(|p| p.exists());

    let cmd = match resource_dir {
        Some(dir) => shell.command(dir.join("ovo-sidecar").to_string_lossy().to_string()),
        None => {
            log::warn!("sidecar bundle not found — falling back to `uv run` in dev mode");
            shell
                .command("uv")
                .args(["run", "--directory", "sidecar", "ovo-sidecar"])
        }
    };

    if let Err(e) = cmd.spawn() {
        log::error!("failed to spawn sidecar: {e}");
    }
}
