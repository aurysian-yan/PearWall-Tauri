use pearwall_core::SpectrumAnalyzer;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{webview::PageLoadEvent, Manager, State};

mod desktop_wallpaper;
#[cfg(target_os = "macos")]
mod macos_audio;
#[cfg(target_os = "macos")]
mod macos_now_playing;
#[cfg(windows)]
mod windows_media;

#[derive(Clone, Copy)]
enum LaunchMode {
    App,
    ScreenSaver,
    Preview(isize),
    Configure,
}

fn launch_mode() -> LaunchMode {
    let mut args = std::env::args().skip(1);
    let Some(argument) = args.next() else {
        return LaunchMode::App;
    };
    match argument.to_ascii_lowercase().as_str() {
        "/s" | "-s" => LaunchMode::ScreenSaver,
        "/c" | "-c" => LaunchMode::Configure,
        "/p" | "-p" => args
            .next()
            .and_then(|value| value.parse::<isize>().ok())
            .filter(|value| *value != 0)
            .map_or(LaunchMode::App, LaunchMode::Preview),
        _ => LaunchMode::App,
    }
}

#[cfg(windows)]
fn set_preview_parent(window: &tauri::WebviewWindow, parent: isize) -> tauri::Result<()> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongPtrW, SetParent, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, WS_CHILD, WS_POPUP,
    };

    unsafe {
        let child = window.hwnd()?;
        let parent = HWND(parent as *mut _);
        let style = GetWindowLongPtrW(child, GWL_STYLE) as u32;
        SetWindowLongPtrW(
            child,
            GWL_STYLE,
            ((style | WS_CHILD.0) & !WS_POPUP.0) as isize,
        );
        SetParent(child, Some(parent)).map_err(|_| tauri::Error::InvalidWindowHandle)?;
        let mut bounds = RECT::default();
        GetClientRect(parent, &mut bounds).map_err(|_| tauri::Error::InvalidWindowHandle)?;
        SetWindowPos(
            child,
            None,
            0,
            0,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top,
            SWP_FRAMECHANGED | SWP_NOACTIVATE,
        )
        .map_err(|_| tauri::Error::InvalidWindowHandle)?;
    }
    Ok(())
}

struct AudioState(Arc<Mutex<SpectrumAnalyzer>>);

#[derive(Clone, Default, Deserialize, Serialize)]
struct MediaArtwork {
    key: String,
    data_url: Option<String>,
    playing: bool,
}

#[cfg(windows)]
struct MediaArtworkState {
    current: Arc<Mutex<MediaArtwork>>,
}

#[cfg(windows)]
impl Default for MediaArtworkState {
    fn default() -> Self {
        let current = Arc::new(Mutex::new(MediaArtwork::default()));
        windows_media::start(current.clone());
        Self { current }
    }
}

#[cfg(not(windows))]
#[derive(Default)]
struct MediaArtworkState;

#[tauri::command]
fn push_audio_spectrum(
    audio: Vec<f32>,
    timestamp_seconds: f64,
    state: State<'_, AudioState>,
) -> Result<f32, String> {
    let mut analyzer = state
        .0
        .lock()
        .map_err(|_| "音频分析器状态不可用".to_string())?;
    analyzer.push(&audio, timestamp_seconds);
    Ok(analyzer.get_interpolated(timestamp_seconds))
}

#[tauri::command]
fn get_audio_pulse(timestamp_seconds: f64, state: State<'_, AudioState>) -> Result<f32, String> {
    let mut analyzer = state
        .0
        .lock()
        .map_err(|_| "音频分析器状态不可用".to_string())?;
    Ok(analyzer.get_interpolated(timestamp_seconds))
}

#[tauri::command]
fn reset_audio(state: State<'_, AudioState>) -> Result<(), String> {
    let mut analyzer = state
        .0
        .lock()
        .map_err(|_| "音频分析器状态不可用".to_string())?;
    analyzer.reset();
    Ok(())
}

#[tauri::command(async)]
fn get_media_artwork(
    current_key: Option<String>,
    state: State<'_, MediaArtworkState>,
) -> Result<MediaArtwork, String> {
    #[cfg(windows)]
    {
        return windows_media::get_media_artwork(&state, current_key.as_deref());
    }

    #[cfg(target_os = "macos")]
    {
        let _ = state;
        return macos_now_playing::get_media_artwork(current_key.as_deref());
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = current_key;
        let _ = state;
        Ok(MediaArtwork::default())
    }
}

#[tauri::command]
fn is_screen_saver_mode() -> bool {
    matches!(launch_mode(), LaunchMode::ScreenSaver)
}

fn page_matches_launch_mode(mode: LaunchMode, path: &str) -> bool {
    let page = path.rsplit('/').next().unwrap_or_default();
    match mode {
        LaunchMode::App | LaunchMode::Configure => page == "settings.html",
        LaunchMode::ScreenSaver | LaunchMode::Preview(_) => page.is_empty() || page == "index.html",
    }
}

#[tauri::command]
fn get_desktop_wallpaper() -> Result<String, String> {
    desktop_wallpaper::data_url()
}

#[cfg(target_os = "macos")]
fn shared_settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "无法定位用户目录".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("PearWall")
        .join("settings.json"))
}

fn validate_settings_json(settings: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(settings).map_err(|_| "设置数据格式无效".to_string())?;
    if !value.is_object() {
        return Err("设置数据格式无效".to_string());
    }
    Ok(())
}

#[tauri::command]
fn load_shared_settings() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let path = shared_settings_path()?;
        if !path.exists() {
            return Ok(None);
        }
        let settings = std::fs::read_to_string(path).map_err(|_| "无法读取屏保设置".to_string())?;
        validate_settings_json(&settings)?;
        return Ok(Some(settings));
    }

    #[cfg(not(target_os = "macos"))]
    Ok(None)
}

#[tauri::command]
fn save_shared_settings(settings: String) -> Result<(), String> {
    validate_settings_json(&settings)?;

    #[cfg(target_os = "macos")]
    {
        let path = shared_settings_path()?;
        let directory = path
            .parent()
            .ok_or_else(|| "无法定位屏保设置目录".to_string())?;
        std::fs::create_dir_all(directory).map_err(|_| "无法创建屏保设置目录".to_string())?;
        let temporary = directory.join(format!(".settings-{}.tmp", std::process::id()));
        std::fs::write(&temporary, settings).map_err(|_| "无法保存屏保设置".to_string())?;
        std::fs::rename(&temporary, path).map_err(|_| "无法更新屏保设置".to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mode = launch_mode();
    let audio_analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::default()));
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AudioState(audio_analyzer.clone()))
        .manage(MediaArtworkState::default())
        .invoke_handler(tauri::generate_handler![
            push_audio_spectrum,
            get_audio_pulse,
            reset_audio,
            get_media_artwork,
            get_desktop_wallpaper,
            is_screen_saver_mode,
            load_shared_settings,
            save_shared_settings,
        ])
        .on_page_load(move |webview, payload| {
            if webview.label() != "main" || payload.event() != PageLoadEvent::Finished {
                return;
            }
            if page_matches_launch_mode(mode, payload.url().path()) {
                let _ = webview.window().show();
            }
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            macos_audio::start(audio_analyzer.clone());

            let Some(window) = app.get_webview_window("main") else {
                return Ok(());
            };
            match mode {
                LaunchMode::ScreenSaver => {
                    let _ = window.set_decorations(false);
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_fullscreen(true);
                    let _ = window.eval("window.location.replace('index.html')");
                }
                LaunchMode::Configure | LaunchMode::App => {
                    #[cfg(windows)]
                    let _ = window.set_decorations(false);
                    let _ = window.set_fullscreen(false);
                }
                LaunchMode::Preview(parent) => {
                    let _ = window.set_decorations(false);
                    let _ = window.set_always_on_top(false);
                    let _ = window.set_fullscreen(false);
                    #[cfg(windows)]
                    set_preview_parent(&window, parent)?;
                    #[cfg(not(windows))]
                    let _ = parent;
                    let _ = window.eval("window.location.replace('index.html')");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Pear Wall 失败");
}
