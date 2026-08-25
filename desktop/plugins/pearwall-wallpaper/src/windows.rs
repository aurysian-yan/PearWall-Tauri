use crate::WallpaperStatus;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    webview::PageLoadEvent, AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{
    GetLastError, SetLastError, COLORREF, HWND, LPARAM, RECT, WIN32_ERROR, WPARAM,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetWindow, GetWindowLongPtrW, GetWindowRect, IsChild,
    IsWindowVisible, SendMessageTimeoutW, SetLayeredWindowAttributes, SetParent, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, GW_HWNDNEXT, HWND_BOTTOM, LWA_ALPHA,
    SMTO_NORMAL, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_SHOWNA, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_APPWINDOW,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_POPUP,
    WS_VISIBLE,
};

const WINDOW_LABEL_PREFIX: &str = "pearwall-wallpaper-";
const SPAWN_WORKER_MESSAGE: u32 = 0x052C;
static RUNNING: AtomicBool = AtomicBool::new(false);
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);
static OPERATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WallpaperSettings {
    dynamic_wallpaper_display_ids: Option<Vec<String>>,
}

#[derive(Clone)]
struct DisplayTarget {
    index: usize,
    position_x: i32,
    position_y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Default)]
struct DesktopHostSearch {
    icon_host: Option<HWND>,
    shell_view: Option<HWND>,
    wallpaper_host: Option<HWND>,
}

#[derive(Clone, Copy)]
struct DesktopHost {
    parent: HWND,
    insert_after: HWND,
    background: Option<HWND>,
    raised: bool,
}

pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    let _operation = lock_operation()?;
    ensure_watcher(app)?;
    RUNNING.store(true, Ordering::Release);
    if let Err(error) = reconcile_windows(app) {
        RUNNING.store(false, Ordering::Release);
        let _ = close_wallpaper_windows(app);
        return Err(error);
    }
    Ok(status(app))
}

pub fn stop<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    let _operation = lock_operation()?;
    RUNNING.store(false, Ordering::Release);
    close_wallpaper_windows(app)?;
    Ok(status(app))
}

fn close_wallpaper_windows<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    for window in wallpaper_windows(app) {
        window
            .close()
            .map_err(|error| format!("无法关闭 Windows 动态壁纸窗口：{error}"))?;
    }
    Ok(())
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> WallpaperStatus {
    WallpaperStatus {
        supported: true,
        running: RUNNING.load(Ordering::Acquire),
        display_count: wallpaper_windows(app).len() as u32,
    }
}

pub fn reconcile<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    let _operation = lock_operation()?;
    reconcile_windows(app)
}

fn reconcile_windows<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperStatus, String> {
    if !RUNNING.load(Ordering::Acquire) {
        return Ok(status(app));
    }

    let displays = selected_displays(app)?;
    let active_labels = displays
        .iter()
        .map(|display| window_label(display.index))
        .collect::<HashSet<_>>();
    for window in wallpaper_windows(app) {
        if !active_labels.contains(window.label()) {
            window
                .close()
                .map_err(|error| format!("无法更新 Windows 动态壁纸窗口：{error}"))?;
        }
    }
    if displays.is_empty() {
        return Ok(status(app));
    }

    let desktop_host = desktop_wallpaper_host()?;
    for display in displays {
        let label = window_label(display.index);
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => create_window(app, &label, &display)?,
        };
        if !is_attached_to_desktop(&window, desktop_host, &display) {
            attach_to_desktop(&window, desktop_host, &display)?;
        }
    }
    Ok(status(app))
}

fn lock_operation() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    OPERATION_LOCK
        .lock()
        .map_err(|_| "Windows 动态壁纸运行时状态异常".to_string())
}

fn ensure_watcher<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if WATCHER_STARTED.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("pearwall-windows-wallpaper".to_string())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if RUNNING.load(Ordering::Acquire) {
                let _ = reconcile(&app);
            }
        })
        .map(|_| ())
        .map_err(|error| {
            WATCHER_STARTED.store(false, Ordering::Release);
            format!("无法启动 Windows 动态壁纸监视线程：{error}")
        })
}

fn wallpaper_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .filter(|window| window.label().starts_with(WINDOW_LABEL_PREFIX))
        .collect()
}

fn selected_displays<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<DisplayTarget>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("无法读取 Windows 显示器信息：{error}"))?;
    let selected_ids = read_settings(app)?
        .dynamic_wallpaper_display_ids
        .map(|values| values.into_iter().collect::<HashSet<_>>());

    Ok(monitors
        .iter()
        .enumerate()
        .filter_map(|(index, monitor)| {
            let position = monitor.position();
            let size = monitor.size();
            let id = monitor.name().cloned().unwrap_or_else(|| {
                format!(
                    "{}:{}:{}:{}:{}",
                    position.x, position.y, size.width, size.height, index
                )
            });
            if selected_ids
                .as_ref()
                .is_some_and(|values| !values.contains(&id))
            {
                return None;
            }
            Some(DisplayTarget {
                index,
                position_x: position.x,
                position_y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
            })
        })
        .collect())
}

fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<WallpaperSettings, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位 Windows 应用设置目录：{error}"))?
        .join("settings.json");
    if !path.exists() {
        return Ok(WallpaperSettings::default());
    }
    let json = std::fs::read_to_string(path)
        .map_err(|error| format!("无法读取 Windows 动态壁纸设置：{error}"))?;
    serde_json::from_str(&json).map_err(|_| "Windows 动态壁纸设置格式无效".to_string())
}

fn window_label(index: usize) -> String {
    format!("{WINDOW_LABEL_PREFIX}{index}")
}

fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    display: &DisplayTarget,
) -> Result<WebviewWindow<R>, String> {
    let logical_width = display.width as f64 / display.scale_factor;
    let logical_height = display.height as f64 / display.scale_factor;
    let loaded_display = display.clone();
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Pear Wall")
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .inner_size(logical_width, logical_height)
        .visible(false)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if let Ok(desktop_host) = desktop_wallpaper_host() {
                if !is_attached_to_desktop(&window, desktop_host, &loaded_display) {
                    let _ = attach_to_desktop(&window, desktop_host, &loaded_display);
                }
            }
        })
        .build()
        .map_err(|error| format!("无法创建 Windows WebGL 动态壁纸窗口：{error}"))
}

fn is_attached_to_desktop<R: Runtime>(
    window: &WebviewWindow<R>,
    desktop_host: DesktopHost,
    display: &DisplayTarget,
) -> bool {
    unsafe {
        let Ok(child) = window.hwnd() else {
            return false;
        };
        if !IsChild(desktop_host.parent, child).as_bool()
            || !IsWindowVisible(desktop_host.parent).as_bool()
            || !IsWindowVisible(child).as_bool()
        {
            return false;
        }
        if desktop_host.raised
            && GetWindowLongPtrW(child, GWL_EXSTYLE) as u32 & WS_EX_LAYERED.0 == 0
        {
            return false;
        }
        let mut bounds = RECT::default();
        if GetWindowRect(child, &mut bounds).is_err()
            || bounds.left != display.position_x
            || bounds.top != display.position_y
            || bounds.right - bounds.left != display.width as i32
            || bounds.bottom - bounds.top != display.height as i32
        {
            return false;
        }
        !desktop_host.raised || verify_raised_z_order(desktop_host, child).is_ok()
    }
}

fn attach_to_desktop<R: Runtime>(
    window: &WebviewWindow<R>,
    desktop_host: DesktopHost,
    display: &DisplayTarget,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| format!("无法设置 Windows 动态壁纸鼠标透传：{error}"))?;
    unsafe {
        let child = window
            .hwnd()
            .map_err(|error| format!("无法获取 Windows 动态壁纸窗口：{error}"))?;
        let style = GetWindowLongPtrW(child, GWL_STYLE) as u32;
        SetWindowLongPtrW(
            child,
            GWL_STYLE,
            ((style | WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPCHILDREN.0 | WS_CLIPSIBLINGS.0)
                & !WS_POPUP.0) as isize,
        );
        let extended_style = GetWindowLongPtrW(child, GWL_EXSTYLE) as u32;
        SetWindowLongPtrW(
            child,
            GWL_EXSTYLE,
            ((extended_style
                | WS_EX_TOOLWINDOW.0
                | WS_EX_NOACTIVATE.0
                | if desktop_host.raised {
                    WS_EX_LAYERED.0
                } else {
                    0
                })
                & !WS_EX_APPWINDOW.0) as isize,
        );
        if desktop_host.raised {
            SetLayeredWindowAttributes(child, COLORREF(0), u8::MAX, LWA_ALPHA)
                .map_err(|error| format!("无法启用 Windows 动态壁纸合成：{error}"))?;
        }
        if !IsChild(desktop_host.parent, child).as_bool() {
            SetLastError(WIN32_ERROR(0));
            if let Err(error) = SetParent(child, Some(desktop_host.parent)) {
                if GetLastError().0 != 0 {
                    return Err(format!("无法将 Windows 动态壁纸挂载到桌面：{error}"));
                }
            }
        }
        if !IsChild(desktop_host.parent, child).as_bool() {
            return Err("Windows 动态壁纸未能进入桌面窗口层级".to_string());
        }

        let mut host_bounds = RECT::default();
        GetWindowRect(desktop_host.parent, &mut host_bounds)
            .map_err(|error| format!("无法读取 Windows 桌面范围：{error}"))?;
        SetWindowPos(
            child,
            Some(desktop_host.insert_after),
            display.position_x - host_bounds.left,
            display.position_y - host_bounds.top,
            display.width as i32,
            display.height as i32,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
        )
        .map_err(|error| format!("无法更新 Windows 动态壁纸层级：{error}"))?;
        if let Some(background) = desktop_host.background {
            SetWindowPos(
                background,
                Some(HWND_BOTTOM),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            )
            .map_err(|error| format!("无法更新 Windows 静态壁纸层级：{error}"))?;
        }
        let _ = ShowWindow(desktop_host.parent, SW_SHOWNA);
        let _ = ShowWindow(child, SW_SHOWNA);
        if !IsWindowVisible(desktop_host.parent).as_bool() {
            return Err("Windows 桌面 WorkerW 窗口不可见".to_string());
        }
        if !IsWindowVisible(child).as_bool() {
            return Err("Windows 动态壁纸窗口不可见".to_string());
        }
        let mut child_bounds = RECT::default();
        GetWindowRect(child, &mut child_bounds)
            .map_err(|error| format!("无法读取 Windows 动态壁纸范围：{error}"))?;
        if child_bounds.right <= child_bounds.left || child_bounds.bottom <= child_bounds.top {
            return Err("Windows 动态壁纸窗口尺寸无效".to_string());
        }
        if desktop_host.raised {
            verify_raised_z_order(desktop_host, child)?;
        }
    }
    Ok(())
}

unsafe fn verify_raised_z_order(desktop_host: DesktopHost, child: HWND) -> Result<(), String> {
    let mut current = desktop_host.insert_after;
    let mut wallpaper_found = false;
    for _ in 0..256 {
        let Ok(next) = GetWindow(current, GW_HWNDNEXT) else {
            break;
        };
        if next == child {
            wallpaper_found = true;
        }
        if desktop_host
            .background
            .is_some_and(|background| next == background)
        {
            return wallpaper_found
                .then_some(())
                .ok_or_else(|| "Windows 动态壁纸仍被系统静态壁纸遮挡".to_string());
        }
        current = next;
    }
    wallpaper_found
        .then_some(())
        .ok_or_else(|| "Windows 动态壁纸未进入桌面图标下方".to_string())
}

fn desktop_wallpaper_host() -> Result<DesktopHost, String> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), PCWSTR::null())
            .map_err(|_| "无法找到 Windows 桌面窗口".to_string())?;
        let raised =
            GetWindowLongPtrW(progman, GWL_EXSTYLE) as u32 & WS_EX_NOREDIRECTIONBITMAP.0 != 0;

        if let Some(host) = existing_desktop_wallpaper_host(progman, raised)? {
            return Ok(host);
        }

        for (wparam, lparam) in [(0xD, 0x1), (0xD, 0x0), (0x0, 0x0)] {
            let mut message_result = 0_usize;
            SendMessageTimeoutW(
                progman,
                SPAWN_WORKER_MESSAGE,
                WPARAM(wparam),
                LPARAM(lparam),
                SMTO_NORMAL,
                1000,
                Some(&mut message_result),
            );
            std::thread::sleep(std::time::Duration::from_millis(50));

            if let Some(host) = existing_desktop_wallpaper_host(progman, raised)? {
                return Ok(host);
            }
        }

        let search = search_desktop_hosts()?;
        if raised {
            let shell_view = search
                .shell_view
                .ok_or_else(|| "无法找到 Windows 桌面图标层".to_string())?;
            return Ok(DesktopHost {
                parent: progman,
                insert_after: shell_view,
                background: None,
                raised: true,
            });
        }
        Ok(DesktopHost {
            parent: search.icon_host.unwrap_or(progman),
            insert_after: HWND_BOTTOM,
            background: None,
            raised: false,
        })
    }
}

fn existing_desktop_wallpaper_host(
    progman: HWND,
    raised: bool,
) -> Result<Option<DesktopHost>, String> {
    unsafe {
        if raised {
            let shell_view =
                FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), PCWSTR::null()).ok();
            let background = FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null()).ok();
            return Ok(match (shell_view, background) {
                (Some(shell_view), Some(background)) => Some(DesktopHost {
                    parent: progman,
                    insert_after: shell_view,
                    background: Some(background),
                    raised: true,
                }),
                _ => None,
            });
        }

        Ok(search_desktop_hosts()?
            .wallpaper_host
            .map(|parent| DesktopHost {
                parent,
                insert_after: HWND_BOTTOM,
                background: None,
                raised: false,
            }))
    }
}

fn search_desktop_hosts() -> Result<DesktopHostSearch, String> {
    let mut search = DesktopHostSearch::default();
    unsafe {
        EnumWindows(
            Some(find_desktop_host),
            LPARAM((&mut search as *mut DesktopHostSearch) as isize),
        )
        .map_err(|error| format!("无法枚举 Windows 桌面窗口：{error}"))?;
    }
    Ok(search)
}

unsafe extern "system" fn find_desktop_host(window: HWND, parameter: LPARAM) -> BOOL {
    let search = unsafe { &mut *(parameter.0 as *mut DesktopHostSearch) };
    let Ok(shell_view) = FindWindowExW(Some(window), None, w!("SHELLDLL_DefView"), PCWSTR::null())
    else {
        return BOOL(1);
    };
    if search.icon_host.is_some() {
        return BOOL(1);
    }
    search.icon_host = Some(window);
    search.shell_view = Some(shell_view);
    search.wallpaper_host = FindWindowExW(None, Some(window), w!("WorkerW"), PCWSTR::null()).ok();
    BOOL(1)
}
