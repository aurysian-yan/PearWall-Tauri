use pearwall_core::SpectrumAnalyzer;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::Duration;
use std::time::Instant;
use tauri::{webview::PageLoadEvent, AppHandle, Manager, State};

mod desktop_wallpaper;
#[cfg(target_os = "macos")]
mod macos_app_service;
#[cfg(target_os = "macos")]
mod macos_audio;
#[cfg(target_os = "macos")]
mod macos_now_playing;
#[cfg(target_os = "macos")]
mod macos_runtime_state;
#[cfg(target_os = "macos")]
mod macos_status_item;
#[cfg(windows)]
mod windows_audio;
#[cfg(windows)]
mod windows_media;
#[cfg(windows)]
mod windows_tray;

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
    use windows::Win32::Foundation::{GetLastError, SetLastError, HWND, RECT, WIN32_ERROR};
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
        SetLastError(WIN32_ERROR(0));
        if SetParent(child, Some(parent)).is_err() && GetLastError().0 != 0 {
            return Err(tauri::Error::InvalidWindowHandle);
        }
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
            started_at: Instant::now(),
            #[cfg(target_os = "macos")]
            shared: Mutex::new(SharedAudioState {
                reader: None,
                next_open_attempt: Instant::now(),
            }),
        }
    }

    fn timestamp_seconds(&self, _requested: f64) -> f64 {
        self.started_at.elapsed().as_secs_f64()
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectedDisplay {
    id: String,
    name: String,
    width: u32,
    height: u32,
    position_x: f64,
    position_y: f64,
    physical_width_mm: Option<f64>,
    physical_height_mm: Option<f64>,
    scale_factor: f64,
    is_builtin: bool,
    is_primary: bool,
}

#[tauri::command]
fn get_connected_displays(app: tauri::AppHandle) -> Result<Vec<ConnectedDisplay>, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::{
            CGDirectDisplayID, CGDisplayBounds, CGDisplayIsBuiltin, CGDisplayPixelsHigh,
            CGDisplayPixelsWide, CGDisplayScreenSize, CGError, CGGetActiveDisplayList,
            CGMainDisplayID,
        };

        let monitors = app
            .available_monitors()
            .map_err(|error| format!("无法读取显示器信息：{error}"))?;
        let mut display_ids = [0 as CGDirectDisplayID; 32];
        let mut display_count = 0_u32;
        let error = unsafe {
            CGGetActiveDisplayList(
                display_ids.len() as u32,
                display_ids.as_mut_ptr(),
                &mut display_count,
            )
        };
        if error != CGError::Success {
            return Err("无法读取 macOS 显示器信息".to_string());
        }

        let primary_id = CGMainDisplayID();
        return Ok(display_ids[..display_count as usize]
            .iter()
            .enumerate()
            .map(|(index, display_id)| {
                let bounds = CGDisplayBounds(*display_id);
                let physical_size = CGDisplayScreenSize(*display_id);
                let monitor = monitors.get(index);
                let size = monitor.map(|value| value.size());
                ConnectedDisplay {
                    id: display_id.to_string(),
                    name: monitor
                        .and_then(|value| value.name().cloned())
                        .unwrap_or_else(|| format!("显示器 {}", index + 1)),
                    width: size
                        .map_or(CGDisplayPixelsWide(*display_id) as u32, |value| value.width),
                    height: size.map_or(CGDisplayPixelsHigh(*display_id) as u32, |value| {
                        value.height
                    }),
                    position_x: bounds.origin.x,
                    position_y: bounds.origin.y,
                    physical_width_mm: (physical_size.width > 0.0).then_some(physical_size.width),
                    physical_height_mm: (physical_size.height > 0.0)
                        .then_some(physical_size.height),
                    scale_factor: monitor.map_or(1.0, |value| value.scale_factor()),
                    is_builtin: CGDisplayIsBuiltin(*display_id),
                    is_primary: *display_id == primary_id,
                }
            })
            .collect());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let monitors = app
            .available_monitors()
            .map_err(|error| format!("无法读取显示器信息：{error}"))?;
        let primary = app
            .primary_monitor()
            .map_err(|error| format!("无法读取主显示器信息：{error}"))?;
        Ok(monitors
            .iter()
            .enumerate()
            .map(|(index, monitor)| {
                let position = monitor.position();
                let size = monitor.size();
                let is_primary = primary
                    .as_ref()
                    .is_some_and(|value| value.position() == position && value.size() == size);
                let name = monitor
                    .name()
                    .cloned()
                    .unwrap_or_else(|| format!("显示器 {}", index + 1));
                let id = monitor.name().cloned().unwrap_or_else(|| {
                    format!(
                        "{}:{}:{}:{}:{}",
                        position.x, position.y, size.width, size.height, index
                    )
                });
                ConnectedDisplay {
                    id,
                    name,
                    width: size.width,
                    height: size.height,
                    position_x: position.x as f64,
                    position_y: position.y as f64,
                    physical_width_mm: None,
                    physical_height_mm: None,
                    scale_factor: monitor.scale_factor(),
                    is_builtin: false,
                    is_primary,
                }
            })
            .collect())
    }
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

#[cfg(target_os = "macos")]
fn start_macos_background_runtime(
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
    started_at: Instant,
) -> Result<(), String> {
    macos_audio::start(analyzer.clone(), started_at);
    macos_runtime_state::start_publisher(analyzer, started_at)?;
    std::thread::Builder::new()
        .name("pearwall-media-artwork".to_string())
        .spawn(|| loop {
            let _ = macos_now_playing::get_media_artwork(None);
            std::thread::sleep(Duration::from_secs(1));
        })
        .map_err(|error| format!("无法启动媒体封面线程：{error}"))?;
    macos_status_item::install()
}

#[tauri::command]
fn get_macos_runtime_status() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        return serde_json::to_value(macos_app_service::status())
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    Err("当前平台不支持 macOS 后台运行时".to_string())
}

#[tauri::command]
fn set_macos_runtime_enabled(enabled: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = macos_app_service::set_enabled(enabled)?;
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("当前平台不支持 macOS 后台运行时".to_string())
    }
}

#[tauri::command]
fn get_macos_wallpaper_runtime_status(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = pearwall_wallpaper::wallpaper_status(&app);
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("当前平台不支持 macOS 动态壁纸".to_string())
    }
}

#[tauri::command]
fn start_macos_wallpaper_runtime(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = pearwall_wallpaper::start_wallpaper(&app)?;
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("当前平台不支持 macOS 动态壁纸".to_string())
    }
}

#[tauri::command]
fn stop_macos_wallpaper_runtime(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = pearwall_wallpaper::stop_wallpaper(&app)?;
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("当前平台不支持 macOS 动态壁纸".to_string())
    }
}

#[tauri::command]
fn get_desktop_wallpaper() -> Result<String, String> {
    desktop_wallpaper::data_url()
}

#[cfg(target_os = "macos")]
fn shared_settings_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "无法定位用户目录".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("PearWall")
        .join("settings.json"))
}

#[cfg(not(target_os = "macos"))]
fn shared_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| format!("无法定位应用设置目录：{error}"))
}

fn validate_settings_json(settings: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(settings).map_err(|_| "设置数据格式无效".to_string())?;
    if !value.is_object() {
        return Err("设置数据格式无效".to_string());
    }
    Ok(())
}

fn read_shared_settings(app: &AppHandle) -> Result<Option<String>, String> {
    let path = shared_settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let settings = std::fs::read_to_string(path).map_err(|_| "无法读取应用设置".to_string())?;
    validate_settings_json(&settings)?;
    Ok(Some(settings))
}

#[tauri::command]
fn load_shared_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_shared_settings(&app)
}

#[tauri::command]
fn save_shared_settings(app: AppHandle, settings: String) -> Result<(), String> {
    validate_settings_json(&settings)?;

    let path = shared_settings_path(&app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "无法定位应用设置目录".to_string())?;
    std::fs::create_dir_all(directory).map_err(|_| "无法创建应用设置目录".to_string())?;

    #[cfg(windows)]
    std::fs::write(path, settings).map_err(|_| "无法保存应用设置".to_string())?;

    #[cfg(not(windows))]
    {
        let temporary = directory.join(format!(".settings-{}.tmp", std::process::id()));
        std::fs::write(&temporary, settings).map_err(|_| "无法保存应用设置".to_string())?;
        std::fs::rename(&temporary, path).map_err(|_| "无法更新应用设置".to_string())?;
    }

    Ok(())
}

fn dynamic_wallpaper_enabled(app: &AppHandle) -> Result<bool, String> {
    let Some(settings) = read_shared_settings(app)? else {
        return Ok(false);
    };
    let value: serde_json::Value =
        serde_json::from_str(&settings).map_err(|_| "设置数据格式无效".to_string())?;
    Ok(value
        .get("dynamicWallpaperEnabled")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mode = launch_mode();
    let show_main_window_on_launch = Arc::new(AtomicBool::new(true));
    let audio_analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::default()));
    #[cfg(windows)]
    windows_audio::start(audio_analyzer.clone());
    let audio_state = AudioState::new(audio_analyzer.clone());
    #[cfg(target_os = "macos")]
    let macos_started_at = audio_state.started_at;
    let page_load_visibility = show_main_window_on_launch.clone();
    let _setup_visibility = show_main_window_on_launch.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(pearwall_wallpaper::init())
        .manage(audio_state)
        .manage(MediaArtworkState::default())
        .invoke_handler(tauri::generate_handler![
            push_audio_spectrum,
            get_audio_pulse,
            reset_audio,
            get_media_artwork,
            get_connected_displays,
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
            if webview.label() != "main" {
                return;
            }
            if page_matches_launch_mode(mode, payload.url().path())
                && page_load_visibility.load(Ordering::Acquire)
            {
                let _ = webview.window().show();
            }
        })
        .on_window_event(move |_window, _event| {
            #[cfg(any(target_os = "macos", windows))]
            if matches!(mode, LaunchMode::App | LaunchMode::Configure) && _window.label() == "main"
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                    api.prevent_close();
                    let _ = _window.hide();
                }
            }
        })
        .setup(move |app| {
            #[cfg(windows)]
            if matches!(
                mode,
                LaunchMode::App | LaunchMode::Configure | LaunchMode::Wallpaper
            ) {
                windows_tray::install(app.handle())?;
            }

            #[cfg(any(target_os = "macos", windows))]
            if matches!(mode, LaunchMode::Wallpaper) {
                pearwall_wallpaper::start_wallpaper(app.handle())?;
                return Ok(());
            }

            #[cfg(target_os = "macos")]
            {
                if matches!(mode, LaunchMode::App | LaunchMode::Configure) {
                    _setup_visibility.store(
                        cfg!(debug_assertions) || macos_status_item::application_is_active(),
                        Ordering::Release,
                    );
                    let _ = macos_app_service::ensure_enabled();
                    app.handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory)
                        .map_err(|error| error.to_string())?;
                    start_macos_background_runtime(audio_analyzer.clone(), macos_started_at)?;
                }
            }

            #[cfg(any(target_os = "macos", windows))]
            if matches!(mode, LaunchMode::App | LaunchMode::Configure)
                && dynamic_wallpaper_enabled(app.handle())?
            {
                if let Err(error) = pearwall_wallpaper::start_wallpaper(app.handle()) {
                    eprintln!("恢复动态壁纸失败：{error}");
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
        .build(tauri::generate_context!())
        .expect("创建 Pear Wall 失败");
    app.run(move |_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if matches!(mode, LaunchMode::App | LaunchMode::Configure)
            && matches!(_event, tauri::RunEvent::Reopen { .. })
        {
            if let Some(window) = _app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}
