use crate::WallpaperStatus;

extern "C" {
    fn pearwall_wallpaper_start() -> i32;
    fn pearwall_wallpaper_stop() -> i32;
    fn pearwall_wallpaper_reconcile() -> i32;
    fn pearwall_wallpaper_is_running() -> i32;
    fn pearwall_wallpaper_display_count() -> i32;
    fn pearwall_show_settings_window();
}

pub fn start() -> Result<(), String> {
    match unsafe { pearwall_wallpaper_start() } {
        0 => Ok(()),
        2 => Err("无法创建 Metal 动态壁纸窗口".to_string()),
        _ => Err("无法启动 macOS 动态壁纸".to_string()),
    }
}

pub fn stop() -> Result<(), String> {
    match unsafe { pearwall_wallpaper_stop() } {
        0 => Ok(()),
        _ => Err("无法停止 macOS 动态壁纸".to_string()),
    }
}

pub fn reconcile() -> Result<(), String> {
    match unsafe { pearwall_wallpaper_reconcile() } {
        0 => Ok(()),
        _ => Err("无法更新 macOS 动态壁纸显示器".to_string()),
    }
}

pub fn status() -> WallpaperStatus {
    let running = unsafe { pearwall_wallpaper_is_running() } != 0;
    let display_count = unsafe { pearwall_wallpaper_display_count() }.max(0) as u32;
    WallpaperStatus {
        supported: true,
        running,
        display_count,
    }
}

pub fn show_settings_window() {
    unsafe { pearwall_show_settings_window() }
}
