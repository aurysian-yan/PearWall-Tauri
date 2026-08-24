use pearwall_core::SpectrumAnalyzer;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use tauri::{webview::PageLoadEvent, Manager, State};

mod desktop_wallpaper;
#[cfg(target_os = "macos")]
mod macos_agent_service;
#[cfg(target_os = "macos")]
mod macos_audio;
#[cfg(target_os = "macos")]
mod macos_now_playing;
#[cfg(target_os = "macos")]
mod macos_runtime_state;
#[cfg(target_os = "macos")]
mod macos_wallpaper;
#[cfg(windows)]
mod windows_media;

#[derive(Clone, Copy)]
enum LaunchMode {
    App,
    ScreenSaver,
    Preview(isize),
    Configure,
    Wallpaper,
}

fn launch_mode() -> LaunchMode {
    let mut args = std::env::args().skip(1);
    let Some(argument) = args.next() else {
        return LaunchMode::App;
    };
    match argument.to_ascii_lowercase().as_str() {
        "/s" | "-s" => LaunchMode::ScreenSaver,
        "/c" | "-c" => LaunchMode::Configure,
        "--wallpaper" => LaunchMode::Wallpaper,
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

struct AudioState {
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
    #[cfg(target_os = "macos")]
    started_at: Instant,
    #[cfg(target_os = "macos")]
    shared: Mutex<SharedAudioState>,
}

#[cfg(target_os = "macos")]
struct SharedAudioState {
    reader: Option<macos_runtime_state::RuntimeStateReader>,
    next_open_attempt: Instant,
}

impl AudioState {
    fn new(analyzer: Arc<Mutex<SpectrumAnalyzer>>) -> Self {
        Self {
            analyzer,
            #[cfg(target_os = "macos")]
            started_at: Instant::now(),
            #[cfg(target_os = "macos")]
            shared: Mutex::new(SharedAudioState {
                reader: None,
                next_open_attempt: Instant::now(),
            }),
        }
    }

    #[cfg(target_os = "macos")]
    fn timestamp_seconds(&self, _requested: f64) -> f64 {
        self.started_at.elapsed().as_secs_f64()
    }

    #[cfg(not(target_os = "macos"))]
    fn timestamp_seconds(&self, requested: f64) -> f64 {
        requested
    }

    #[cfg(target_os = "macos")]
    fn shared_pulse(&self) -> Option<f32> {
        let mut shared = self.shared.lock().ok()?;
        if shared.reader.is_none() && Instant::now() >= shared.next_open_attempt {
            shared.reader = macos_runtime_state::RuntimeStateReader::open().ok();
            shared.next_open_attempt = Instant::now() + Duration::from_secs(1);
        }
        shared
            .reader
            .as_ref()
            .and_then(|reader| reader.current_pulse(Duration::from_secs(1)))
    }
}

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
    let timestamp_seconds = state.timestamp_seconds(timestamp_seconds);
    let mut analyzer = state
        .analyzer
        .lock()
        .map_err(|_| "音频分析器状态不可用".to_string())?;
    analyzer.push(&audio, timestamp_seconds);
    Ok(analyzer.get_interpolated(timestamp_seconds))
}

#[tauri::command]
fn get_audio_pulse(timestamp_seconds: f64, state: State<'_, AudioState>) -> Result<f32, String> {
    #[cfg(target_os = "macos")]
    if let Some(pulse) = state.shared_pulse() {
        return Ok(pulse);
    }

    let timestamp_seconds = state.timestamp_seconds(timestamp_seconds);
    let mut analyzer = state
        .analyzer
        .lock()
        .map_err(|_| "音频分析器状态不可用".to_string())?;
    Ok(analyzer.get_interpolated(timestamp_seconds))
}

#[tauri::command]
fn reset_audio(state: State<'_, AudioState>) -> Result<(), String> {
    let mut analyzer = state
        .analyzer
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
        LaunchMode::Wallpaper => page.is_empty() || page == "index.html",
    }
}

#[tauri::command]
fn get_macos_runtime_status() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        return serde_json::to_value(macos_agent_service::status())
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台不支持 macOS 后台运行时".to_string())
}

#[tauri::command]
fn set_macos_runtime_enabled(enabled: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = macos_agent_service::set_enabled(enabled)?;
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("当前平台不支持 macOS 后台运行时".to_string())
    }
}

#[tauri::command]
fn get_macos_wallpaper_runtime_status() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = macos_wallpaper::get_macos_wallpaper_runtime_status();
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台不支持 macOS 动态壁纸".to_string())
}

#[tauri::command]
fn start_macos_wallpaper_runtime() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = macos_wallpaper::start_macos_wallpaper_runtime()?;
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台不支持 macOS 动态壁纸".to_string())
}

#[tauri::command]
fn stop_macos_wallpaper_runtime() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = macos_wallpaper::stop_macos_wallpaper_runtime()?;
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台不支持 macOS 动态壁纸".to_string())
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
    #[cfg(target_os = "macos")]
    let wallpaper_listener = if matches!(mode, LaunchMode::Wallpaper) {
        match macos_wallpaper::prepare_server() {
            Ok(macos_wallpaper::ServerPreparation::AlreadyRunning) => return,
            Ok(macos_wallpaper::ServerPreparation::Ready { listener, instance }) => {
                Some((listener, instance))
            }
            Err(error) => {
                eprintln!("启动动态壁纸运行时失败：{error}");
                return;
            }
        }
    } else {
        None
    };
    let audio_analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::default()));
    let audio_state = AudioState::new(audio_analyzer.clone());
    #[cfg(target_os = "macos")]
    let audio_started_at = audio_state.started_at;
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(audio_state)
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
            get_macos_runtime_status,
            set_macos_runtime_enabled,
            get_macos_wallpaper_runtime_status,
            start_macos_wallpaper_runtime,
            stop_macos_wallpaper_runtime,
        ])
        .on_page_load(move |webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            #[cfg(target_os = "macos")]
            if matches!(mode, LaunchMode::Wallpaper)
                && macos_wallpaper::is_wallpaper_window(webview.label())
            {
                if let Ok(Some(settings)) = load_shared_settings() {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&settings) {
                        let source = format!(
                            "window.PearWallScreenSaverSettings={value};window.PearWallReloadSettings?.();"
                        );
                        let _ = webview.eval(source);
                    }
                }
                if let Some(window) = webview
                    .app_handle()
                    .get_webview_window(webview.label())
                {
                    macos_wallpaper::show_window(&window);
                }
                return;
            }
            if webview.label() != "main" {
                return;
            }
            if page_matches_launch_mode(mode, payload.url().path()) {
                let _ = webview.window().show();
            }
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            {
                if matches!(mode, LaunchMode::Wallpaper) {
                    let (listener, instance) = wallpaper_listener
                        .ok_or_else(|| "动态壁纸控制通道不可用".to_string())?;
                    macos_wallpaper::setup(app.handle(), listener, instance)?;
                    return Ok(());
                }
                let uses_agent = matches!(mode, LaunchMode::App | LaunchMode::Configure)
                    && {
                        let registered = macos_agent_service::ensure_enabled()
                            .map(|status| status.enabled)
                            .unwrap_or(false);
                        macos_agent_service::launch_bundled_agent() || registered
                    };
                if !uses_agent {
                    macos_audio::start(audio_analyzer.clone(), audio_started_at);
                }
            }

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
                LaunchMode::Wallpaper => {}
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Pear Wall 失败");
}
