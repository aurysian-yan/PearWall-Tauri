use serde::Serialize;
use tauri::{plugin::TauriPlugin, Runtime};

#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperStatus {
    pub supported: bool,
    pub running: bool,
    pub display_count: u32,
}

pub fn wallpaper_status() -> WallpaperStatus {
    #[cfg(target_os = "macos")]
    {
        return macos::status();
    }

    #[cfg(not(target_os = "macos"))]
    WallpaperStatus {
        supported: false,
        running: false,
        display_count: 0,
    }
}

pub fn start_wallpaper() -> Result<WallpaperStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos::start()?;
        return Ok(macos::status());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台暂不支持动态壁纸".to_string())
}

pub fn stop_wallpaper() -> Result<WallpaperStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos::stop()?;
        return Ok(macos::status());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台暂不支持动态壁纸".to_string())
}

pub fn reconcile_wallpaper() -> Result<WallpaperStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos::reconcile()?;
        return Ok(macos::status());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台暂不支持动态壁纸".to_string())
}

#[tauri::command]
fn start() -> Result<WallpaperStatus, String> {
    start_wallpaper()
}

#[tauri::command]
fn stop() -> Result<WallpaperStatus, String> {
    stop_wallpaper()
}

#[tauri::command]
fn status() -> WallpaperStatus {
    wallpaper_status()
}

#[tauri::command]
fn reconcile() -> Result<WallpaperStatus, String> {
    reconcile_wallpaper()
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("pearwall-wallpaper")
        .invoke_handler(tauri::generate_handler![start, stop, status, reconcile])
        .build()
}
