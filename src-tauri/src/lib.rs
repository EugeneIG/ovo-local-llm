use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

mod sidecar;

use sidecar::{SidecarState, SidecarStatus};

// [START] Phase R — chats.sqlite migrations registered via tauri-plugin-sql.
// The DB lives in the Tauri app data dir ($APPDATA/com.ovoment.ovo/chats.sqlite)
// and is owned by the frontend (sessions/messages/model_context_overrides).
fn chats_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init: sessions + messages + model_context_overrides",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }]
}
// [END]

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

// [START] Phase 7 — pet window lifecycle commands
#[tauri::command]
fn pet_show(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("pet")
        .ok_or_else(|| "pet window not found".to_string())?
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pet_hide(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("pet")
        .ok_or_else(|| "pet window not found".to_string())?
        .hide()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn focus_main_window(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?
        .set_focus()
        .map_err(|e| e.to_string())
}
// [END]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chats.sqlite", chats_migrations())
                .build(),
        )
        .setup(|app| {
            sidecar::setup(&app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            sidecar_status,
            sidecar_restart,
            pet_show,
            pet_hide,
            focus_main_window
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
