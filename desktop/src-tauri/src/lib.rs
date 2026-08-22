use pearwall_core::SpectrumAnalyzer;
use serde::Serialize;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{Manager, State};

#[cfg(target_os = "macos")]
mod macos_audio;
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
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW, WS_CHILD, WS_POPUP,
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
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .map_err(|_| tauri::Error::InvalidWindowHandle)?;
    }
    Ok(())
}

struct AudioState(Arc<Mutex<SpectrumAnalyzer>>);

#[derive(Clone, Default, Serialize)]
struct MediaArtwork {
    key: String,
    data_url: Option<String>,
    playing: bool,
}

#[cfg(windows)]
struct MediaArtworkState {
    current: Arc<Mutex<MediaArtwork>>,
    delivered: Mutex<(String, bool)>,
}

#[cfg(windows)]
impl Default for MediaArtworkState {
    fn default() -> Self {
        let current = Arc::new(Mutex::new(MediaArtwork::default()));
        windows_media::start(current.clone());
        Self {
            current,
            delivered: Mutex::new((String::new(), false)),
        }
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
fn get_media_artwork(state: State<'_, MediaArtworkState>) -> Result<MediaArtwork, String> {
    #[cfg(windows)]
    {
        return windows_media::get_media_artwork(&state);
    }

    #[cfg(not(windows))]
    {
        let _ = state;
        Ok(MediaArtwork::default())
    }
}

#[tauri::command]
fn is_screen_saver_mode() -> bool {
    matches!(launch_mode(), LaunchMode::ScreenSaver)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mode = launch_mode();
    let audio_analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::default()));
    tauri::Builder::default()
        .manage(AudioState(audio_analyzer.clone()))
        .manage(MediaArtworkState::default())
        .invoke_handler(tauri::generate_handler![
            push_audio_spectrum,
            get_audio_pulse,
            reset_audio,
            get_media_artwork,
            is_screen_saver_mode,
        ])
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
                    let _ = window.show();
                }
                LaunchMode::Configure | LaunchMode::App => {
                    let _ = window.set_fullscreen(false);
                    let _ = window.show();
                }
                LaunchMode::Preview(parent) => {
                    let _ = window.set_decorations(false);
                    let _ = window.set_always_on_top(false);
                    let _ = window.set_fullscreen(false);
                    #[cfg(windows)]
                    set_preview_parent(&window, parent)?;
                    #[cfg(not(windows))]
                    let _ = parent;
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Pear Wall 失败");
}
