use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent};

mod sidecar;

use sidecar::{SidecarState, SidecarStatus};

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "OVO",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn sidecar_status(app: AppHandle) -> SidecarStatus {
    app.state::<SidecarState>().snapshot()
}

#[tauri::command]
async fn sidecar_restart(app: AppHandle) -> Result<(), String> {
    sidecar::restart(app).await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            sidecar::setup(&app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            sidecar_status,
            sidecar_restart
        ])
        .build(tauri::generate_context!())
        .expect("error while building OVO");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            sidecar::kill(app_handle);
        }
        _ => {}
    });
}
