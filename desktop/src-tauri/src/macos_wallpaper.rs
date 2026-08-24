use fs2::FileExt;
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use objc2_core_graphics::kCGDesktopWindowLevel;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::utils::config::{BackgroundThrottlingPolicy, WebviewUrl};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder,
};

const WALLPAPER_WINDOW_PREFIX: &str = "wallpaper-";
const CONTROL_SOCKET_FILE_NAME: &str = "wallpaper-runtime-v1.sock";
const RUNTIME_LOCK_FILE_NAME: &str = "wallpaper-runtime-v1.lock";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperRuntimeStatus {
    pub running: bool,
}

pub enum ServerPreparation {
    AlreadyRunning,
    Ready {
        listener: UnixListener,
        instance: WallpaperInstance,
    },
}

pub struct WallpaperInstance {
    _file: File,
}

pub struct WallpaperRuntimeLifetime {
    stop: Arc<AtomicBool>,
    socket_path: PathBuf,
    _instance: WallpaperInstance,
}

impl Drop for WallpaperRuntimeLifetime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = fs::remove_file(&self.socket_path);
    }
}

pub fn prepare_server() -> Result<ServerPreparation, String> {
    let Some(instance) = WallpaperInstance::acquire()? else {
        return Ok(ServerPreparation::AlreadyRunning);
    };
    if runtime_is_running() {
        return Ok(ServerPreparation::AlreadyRunning);
    }
    let socket_path = control_socket_path()?;
    if socket_path.exists() {
        fs::remove_file(&socket_path)
            .map_err(|error| format!("无法清理动态壁纸控制通道：{error}"))?;
    }
    let listener = UnixListener::bind(&socket_path)
        .map_err(|error| format!("无法创建动态壁纸控制通道：{error}"))?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("无法保护动态壁纸控制通道：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法配置动态壁纸控制通道：{error}"))?;
    Ok(ServerPreparation::Ready { listener, instance })
}

pub fn setup(
    app: &AppHandle,
    listener: UnixListener,
    instance: WallpaperInstance,
) -> Result<(), String> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|error| error.to_string())?;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let lifetime = WallpaperRuntimeLifetime {
        stop: stop.clone(),
        socket_path: control_socket_path()?,
        _instance: instance,
    };
    start_control_server(
        app.clone(),
        listener,
        stop.clone(),
        lifetime.socket_path.clone(),
    )?;
    reconcile_windows(app)?;
    start_monitor_reconciliation(app.clone(), stop)?;
    app.manage(lifetime);
    Ok(())
}

pub fn is_wallpaper_window(label: &str) -> bool {
    label.starts_with(WALLPAPER_WINDOW_PREFIX)
}

pub fn show_window(window: &WebviewWindow) {
    let _ = configure_native_window(window);
    let _ = window.show();
}

pub fn get_macos_wallpaper_runtime_status() -> WallpaperRuntimeStatus {
    WallpaperRuntimeStatus {
        running: runtime_is_running(),
    }
}

pub fn start_macos_wallpaper_runtime() -> Result<WallpaperRuntimeStatus, String> {
    if runtime_is_running() {
        return Ok(WallpaperRuntimeStatus { running: true });
    }
    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位动态壁纸运行程序：{error}"))?;
    let mut child = Command::new(executable)
        .arg("--wallpaper")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动动态壁纸：{error}"))?;

    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        if runtime_is_running() {
            return Ok(WallpaperRuntimeStatus { running: true });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("动态壁纸运行时未能在预期时间内启动".to_string())
}

impl WallpaperInstance {
    fn acquire() -> Result<Option<Self>, String> {
        let directory = super::macos_runtime_state::application_support_directory()
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
        let path = directory.join(RUNTIME_LOCK_FILE_NAME);
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .map_err(|error| error.to_string())?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(Self { _file: file })),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub fn stop_macos_wallpaper_runtime() -> Result<WallpaperRuntimeStatus, String> {
    if !runtime_is_running() {
        return Ok(WallpaperRuntimeStatus { running: false });
    }
    send_control_command("shutdown")?;
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        if !runtime_is_running() {
            return Ok(WallpaperRuntimeStatus { running: false });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("动态壁纸运行时未能在预期时间内停止".to_string())
}

fn start_control_server(
    app: AppHandle,
    listener: UnixListener,
    stop: Arc<AtomicBool>,
    socket_path: PathBuf,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("pearwall-wallpaper-control".to_string())
        .spawn(move || {
            while !stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                        let mut request = [0_u8; 32];
                        let count = stream.read(&mut request).unwrap_or(0);
                        match std::str::from_utf8(&request[..count])
                            .unwrap_or_default()
                            .trim()
                        {
                            "ping" => {
                                let _ = stream.write_all(b"pong\n");
                            }
                            "shutdown" => {
                                let _ = stream.write_all(b"ok\n");
                                stop.store(true, Ordering::Release);
                                let _ = fs::remove_file(&socket_path);
                                app.exit(0);
                            }
                            _ => {
                                let _ = stream.write_all(b"error\n");
                            }
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => break,
                }
            }
            let _ = fs::remove_file(socket_path);
        })
        .map(|_| ())
        .map_err(|error| format!("无法启动动态壁纸控制线程：{error}"))
}

fn start_monitor_reconciliation(app: AppHandle, stop: Arc<AtomicBool>) -> Result<(), String> {
    std::thread::Builder::new()
        .name("pearwall-wallpaper-monitors".to_string())
        .spawn(move || {
            while !stop.load(Ordering::Acquire) {
                for _ in 0..20 {
                    if stop.load(Ordering::Acquire) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = reconcile_windows(&handle);
                });
            }
        })
        .map(|_| ())
        .map_err(|error| format!("无法启动显示器监听线程：{error}"))
}

fn reconcile_windows(app: &AppHandle) -> Result<(), String> {
    let mut monitors = app
        .available_monitors()
        .map_err(|error| format!("无法读取显示器信息：{error}"))?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));

    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("{WALLPAPER_WINDOW_PREFIX}{index}");
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
                .title("Pear Wall")
                .decorations(false)
                .resizable(false)
                .shadow(false)
                .always_on_bottom(true)
                .visible_on_all_workspaces(true)
                .focused(false)
                .focusable(false)
                .visible(false)
                .skip_taskbar(true)
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                .build()
                .map_err(|error| format!("无法创建动态壁纸窗口：{error}"))?,
        };
        window
            .set_position(PhysicalPosition::new(
                monitor.position().x,
                monitor.position().y,
            ))
            .map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(
                monitor.size().width,
                monitor.size().height,
            ))
            .map_err(|error| error.to_string())?;
        configure_native_window(&window)?;
    }

    for (label, window) in app.webview_windows() {
        let Some(index) = label
            .strip_prefix(WALLPAPER_WINDOW_PREFIX)
            .and_then(|value| value.parse::<usize>().ok())
        else {
            continue;
        };
        if index >= monitors.len() {
            let _ = window.close();
        }
    }
    Ok(())
}

fn configure_native_window(window: &WebviewWindow) -> Result<(), String> {
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("动态壁纸原生窗口不可用".to_string());
    }
    let native_window = unsafe { &*pointer.cast::<NSWindow>() };
    let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    native_window.setLevel(kCGDesktopWindowLevel as isize + 1);
    native_window.setCollectionBehavior(behavior);
    native_window.setIgnoresMouseEvents(true);
    Ok(())
}

fn runtime_is_running() -> bool {
    send_control_command("ping")
        .map(|response| response.trim() == "pong")
        .unwrap_or(false)
}

fn send_control_command(command: &str) -> Result<String, String> {
    let path = control_socket_path()?;
    let mut stream =
        UnixStream::connect(path).map_err(|error| format!("无法连接动态壁纸运行时：{error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(format!("{command}\n").as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    Ok(response)
}

fn control_socket_path() -> Result<PathBuf, String> {
    let directory = super::macos_runtime_state::application_support_directory()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    Ok(directory.join(CONTROL_SOCKET_FILE_NAME))
}
