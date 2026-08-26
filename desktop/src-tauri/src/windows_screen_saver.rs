use serde::Deserialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::utils::config::Color;
use tauri::{
    AppHandle, Monitor, PhysicalPosition, Position, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

const WINDOW_LABEL_PREFIX: &str = "pearwall-screensaver-";
const EXIT_GRACE_PERIOD: Duration = Duration::from_millis(700);
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(40);
const EXIT_MOUSE_DISTANCE: i32 = 6;

static EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ScreenSaverSettings {
    hide_cursor: bool,
    screen_saver_display: String,
    screen_saver_display_ids: Option<Vec<String>>,
}

impl Default for ScreenSaverSettings {
    fn default() -> Self {
        Self {
            hide_cursor: true,
            screen_saver_display: "PRIMARY".to_string(),
            screen_saver_display_ids: None,
        }
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    EXIT_REQUESTED.store(false, Ordering::Release);
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("无法读取屏保显示器：{error}"))?;
    if monitors.is_empty() {
        return Err("没有可用的屏保显示器".to_string());
    }
    start_input_monitor(app.clone())?;

    let primary = app
        .primary_monitor()
        .map_err(|error| format!("无法读取主显示器：{error}"))?;
    let settings = load_settings(app);
    let selected_ids = selected_display_ids(&monitors, primary.as_ref(), &settings);
    let mut focus_window = None;

    for (index, monitor) in monitors.iter().enumerate() {
        let display_id = crate::monitor_identifier(monitor, index);
        let should_render = selected_ids.contains(&display_id);
        let url = if should_render {
            WebviewUrl::App("index.html".into())
        } else {
            WebviewUrl::App("screensaver-black.html".into())
        };
        let window = WebviewWindowBuilder::new(app, format!("{WINDOW_LABEL_PREFIX}{index}"), url)
            .title("Pear Wall")
            .visible(false)
            .focused(false)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .background_color(Color(0, 0, 0, 255))
            .build()
            .map_err(|error| format!("无法创建屏保窗口：{error}"))?;

        configure_window(&window, monitor, settings.hide_cursor)?;
        window
            .show()
            .map_err(|error| format!("无法显示屏保窗口：{error}"))?;

        let is_primary = primary
            .as_ref()
            .is_some_and(|value| same_monitor(value, monitor));
        if focus_window.is_none() || is_primary {
            focus_window = Some(window);
        }
    }

    if let Some(window) = focus_window {
        let _ = window.set_focus();
    }
    Ok(())
}

fn load_settings(app: &AppHandle) -> ScreenSaverSettings {
    crate::read_shared_settings(app)
        .ok()
        .flatten()
        .and_then(|settings| serde_json::from_str(&settings).ok())
        .unwrap_or_default()
}

fn selected_display_ids(
    monitors: &[Monitor],
    primary: Option<&Monitor>,
    settings: &ScreenSaverSettings,
) -> HashSet<String> {
    if let Some(selected_ids) = &settings.screen_saver_display_ids {
        return selected_ids.iter().cloned().collect();
    }

    let primary_index = monitors
        .iter()
        .position(|monitor| primary.is_some_and(|value| same_monitor(value, monitor)))
        .unwrap_or(0);
    let target_index = if settings
        .screen_saver_display
        .eq_ignore_ascii_case("SECONDARY")
    {
        monitors
            .iter()
            .enumerate()
            .find_map(|(index, _)| (index != primary_index).then_some(index))
            .unwrap_or(primary_index)
    } else {
        primary_index
    };
    HashSet::from([crate::monitor_identifier(
        &monitors[target_index],
        target_index,
    )])
}

fn same_monitor(left: &Monitor, right: &Monitor) -> bool {
    left.position() == right.position() && left.size() == right.size()
}

fn configure_window(
    window: &WebviewWindow,
    monitor: &Monitor,
    hide_cursor: bool,
) -> Result<(), String> {
    let position = monitor.position();
    let size = monitor.size();
    window
        .set_background_color(Some(Color(0, 0, 0, 255)))
        .map_err(|error| format!("无法设置屏保背景：{error}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            position.x, position.y,
        )))
        .map_err(|error| format!("无法定位屏保窗口：{error}"))?;
    window
        .set_size(Size::Physical(*size))
        .map_err(|error| format!("无法调整屏保窗口：{error}"))?;
    window
        .set_cursor_visible(!hide_cursor)
        .map_err(|error| format!("无法设置屏保鼠标指针：{error}"))?;
    Ok(())
}

fn start_input_monitor(app: AppHandle) -> Result<(), String> {
    std::thread::Builder::new()
        .name("pearwall-screen-saver-input".to_string())
        .spawn(move || {
            let started_at = Instant::now();
            let mut input_time = last_input_time();
            let mut initial_cursor = cursor_position();
            let mut previous_cursor = initial_cursor;
            loop {
                std::thread::sleep(EXIT_POLL_INTERVAL);
                if EXIT_REQUESTED.load(Ordering::Acquire) {
                    return;
                }

                let current_input_time = last_input_time();
                let current_cursor = cursor_position();
                if started_at.elapsed() < EXIT_GRACE_PERIOD {
                    input_time = current_input_time;
                    initial_cursor = current_cursor;
                    previous_cursor = current_cursor;
                    continue;
                }

                if input_time.is_none() {
                    input_time = current_input_time;
                    previous_cursor = current_cursor;
                    continue;
                }

                let input_changed =
                    current_input_time.is_some() && current_input_time != input_time;
                if !input_changed {
                    continue;
                }
                input_time = current_input_time;

                let pointer_changed = current_cursor.is_some() && current_cursor != previous_cursor;
                previous_cursor = current_cursor;
                let pointer_moved_far = match (initial_cursor, current_cursor) {
                    (Some(initial), Some(current)) => {
                        (current.x - initial.x).abs() >= EXIT_MOUSE_DISTANCE
                            || (current.y - initial.y).abs() >= EXIT_MOUSE_DISTANCE
                    }
                    _ => false,
                };
                if !pointer_changed || pointer_moved_far {
                    EXIT_REQUESTED.store(true, Ordering::Release);
                    app.exit(0);
                    return;
                }
            }
        })
        .map(|_| ())
        .map_err(|error| format!("无法启动屏保输入监控：{error}"))
}

fn last_input_time() -> Option<u32> {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe { GetLastInputInfo(&mut info) }
        .as_bool()
        .then_some(info.dwTime)
}

fn cursor_position() -> Option<POINT> {
    let mut cursor = POINT::default();
    unsafe { GetCursorPos(&mut cursor) }.ok().map(|_| cursor)
}
