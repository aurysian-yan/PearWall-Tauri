use serde::Serialize;
use tauri::{plugin::TauriPlugin, AppHandle, Runtime};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperStatus {
    pub supported: bool,
    pub running: bool,
    pub display_count: u32,
}

pub fn wallpaper_status<R: Runtime>(app: &AppHandle<R>) -> WallpaperStatus {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return macos::status();
    }

    #[cfg(windows)]
    {
        return windows::status(app);
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    WallpaperStatus {
        supported: false,
        running: false,
        display_count: 0,
    }
}

pub fn start_wallpaper<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::start()?;
        return Ok(macos::status());
    }

    #[cfg(windows)]
    {
        return windows::start(app);
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    Err("当前平台暂不支持动态壁纸".to_string())
}

pub fn stop_wallpaper<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::stop()?;
        return Ok(macos::status());
    }

    #[cfg(windows)]
    {
        return windows::stop(app);
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    Err("当前平台暂不支持动态壁纸".to_string())
}

pub fn reconcile_wallpaper<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::reconcile()?;
        return Ok(macos::status());
    }

    #[cfg(windows)]
    {
        return windows::reconcile(app);
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    Err("当前平台暂不支持动态壁纸".to_string())
}

#[tauri::command]
async fn start<R: Runtime>(app: AppHandle<R>) -> Result<WallpaperStatus, String> {
    start_wallpaper(&app)
}

#[tauri::command]
async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<WallpaperStatus, String> {
    stop_wallpaper(&app)
}

#[tauri::command]
fn status<R: Runtime>(app: AppHandle<R>) -> WallpaperStatus {
    wallpaper_status(&app)
}

#[tauri::command]
async fn reconcile<R: Runtime>(app: AppHandle<R>) -> Result<WallpaperStatus, String> {
    reconcile_wallpaper(&app)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("pearwall-wallpaper")
        .invoke_handler(tauri::generate_handler![start, stop, status, reconcile])
        .build()
}
