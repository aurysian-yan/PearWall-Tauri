#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window};

#[cfg(windows)]
use tauri::Emitter;

#[cfg(windows)]
mod windows_installer;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
struct InstallOptions {
    desktop_shortcuts: bool,
    start_menu_shortcuts: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerState {
    mode: String,
    installed_version: Option<String>,
    target_version: String,
    desktop_shortcuts: bool,
    start_menu_shortcuts: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(windows)]
struct InstallerProgress {
    percent: u8,
    message: String,
}

#[cfg(windows)]
fn emit_progress(app: &AppHandle, percent: u8, message: &str) {
    let _ = app.emit(
        "installer-progress",
        InstallerProgress {
            percent,
            message: message.to_string(),
        },
    );
}

#[tauri::command]
fn get_installer_state() -> Result<InstallerState, String> {
    #[cfg(windows)]
    {
        return windows_installer::installer_state();
    }

    #[cfg(not(windows))]
    Ok(InstallerState {
        mode: "install".to_string(),
        installed_version: None,
        target_version: env!("CARGO_PKG_VERSION").to_string(),
        desktop_shortcuts: false,
        start_menu_shortcuts: true,
    })
}

#[tauri::command(async)]
async fn apply_installation(options: InstallOptions, app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            windows_installer::install(&app, options)
        })
        .await
        .map_err(|error| format!("安装任务异常：{error}"))?;
    }

    #[cfg(not(windows))]
    {
        let _ = (options, app);
        Err("安装器仅支持 Windows".to_string())
    }
}

#[tauri::command(async)]
async fn remove_installation(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || windows_installer::uninstall(&app))
            .await
            .map_err(|error| format!("卸载任务异常：{error}"))?;
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err("安装器仅支持 Windows".to_string())
    }
}

#[tauri::command]
fn minimize_installer_window(window: Window) -> Result<(), String> {
    window
        .minimize()
        .map_err(|error| format!("最小化安装程序失败：{error}"))
}

#[tauri::command]
fn close_installer_window(window: Window) -> Result<(), String> {
    window
        .destroy()
        .map_err(|error| format!("关闭安装程序失败：{error}"))
}

fn main() {
    #[cfg(windows)]
    if windows_installer::relaunch_uninstaller_if_needed() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                if let Some(window) = app.get_webview_window("installer") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_installer_state,
            apply_installation,
            remove_installation,
            minimize_installer_window,
            close_installer_window,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Pear Wall 安装程序失败");
}
