use crate::{emit_progress, InstallOptions, InstallerState};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_DELAY_UNTIL_REBOOT};
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETSCREENSAVEACTIVE,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const APP_DIRECTORY_NAME: &str = "Pear Wall";
const MAIN_EXECUTABLE_NAME: &str = "PearWall.exe";
const SCREEN_SAVER_NAME: &str = "PearWall.scr";
const UNINSTALLER_NAME: &str = "PearWallInstaller.exe";
const INSTALL_STATE_NAME: &str = "install-state.json";
const UNINSTALL_REGISTRY_KEY: &str =
    r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Pear Wall";
const DESKTOP_REGISTRY_KEY: &str = r"HKCU\Control Panel\Desktop";
const AUTOSTART_REGISTRY_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE_NAME: &str = "Pear Wall";
const SCREEN_SAVER_SELECTED_EXIT_CODE: i32 = 42;
const START_SHORTCUT_NAME: &str = "启动 Pear Wall 屏幕保护程序.lnk";
const SETTINGS_SHORTCUT_NAME: &str = "Pear Wall 设置.lnk";
const EMBEDDED_PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/PearWall.exe"));

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallRecord {
    version: String,
    desktop_shortcuts: bool,
    start_menu_shortcuts: bool,
}

struct InstallPaths {
    install_dir: PathBuf,
    main_executable: PathBuf,
    screen_saver: PathBuf,
    uninstaller: PathBuf,
    state_file: PathBuf,
    desktop_dir: PathBuf,
    start_menu_dir: PathBuf,
}

impl InstallPaths {
    fn resolve() -> Self {
        let program_files = env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
        let public_dir = env::var_os("PUBLIC")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Users\Public"));
        let program_data = env::var_os("PROGRAMDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
        let install_dir = program_files.join(APP_DIRECTORY_NAME);

        Self {
            main_executable: install_dir.join(MAIN_EXECUTABLE_NAME),
            screen_saver: install_dir.join(SCREEN_SAVER_NAME),
            uninstaller: install_dir.join(UNINSTALLER_NAME),
            state_file: install_dir.join(INSTALL_STATE_NAME),
            desktop_dir: public_dir.join("Desktop"),
            start_menu_dir: program_data
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join(APP_DIRECTORY_NAME),
            install_dir,
        }
    }
}

pub fn installer_state() -> Result<InstallerState, String> {
    let paths = InstallPaths::resolve();
    let record = read_record(&paths.state_file);
    let uninstall_mode = env::args().any(|argument| argument == "--uninstall");
    let mut installed_version = record
        .as_ref()
        .map(|value| value.version.clone())
        .filter(|value| !value.is_empty());
    if installed_version.is_none() && paths.main_executable.exists() {
        installed_version = Some("未知版本".to_string());
    }
    let mode = if uninstall_mode {
        "uninstall"
    } else if installed_version.as_deref() == Some(env!("CARGO_PKG_VERSION")) {
        "repair"
    } else if installed_version.is_some() || paths.main_executable.exists() {
        "update"
    } else {
        "install"
    };

    Ok(InstallerState {
        mode: mode.to_string(),
        installed_version,
        target_version: env!("CARGO_PKG_VERSION").to_string(),
        desktop_shortcuts: record
            .as_ref()
            .map(|value| value.desktop_shortcuts)
            .unwrap_or(false),
        start_menu_shortcuts: record
            .as_ref()
            .map(|value| value.start_menu_shortcuts)
            .unwrap_or(true),
    })
}

pub fn install(app: &AppHandle, options: InstallOptions) -> Result<(), String> {
    if EMBEDDED_PAYLOAD.is_empty() {
        return Err("安装器未包含 Pear Wall 运行程序".to_string());
    }

    let paths = InstallPaths::resolve();
    emit_progress(app, 5, "正在关闭 Pear Wall…");
    stop_running_components()?;

    emit_progress(app, 12, "正在准备安装目录…");
    fs::create_dir_all(&paths.install_dir).map_err(|error| path_error("创建安装目录", &error))?;

    emit_progress(app, 22, "正在安装 Pear Wall…");
    replace_bytes(&paths.main_executable, EMBEDDED_PAYLOAD)
        .map_err(|error| locked_file_error("Pear Wall", &error))?;

    emit_progress(app, 44, "正在安装屏幕保护程序…");
    replace_bytes(&paths.screen_saver, EMBEDDED_PAYLOAD)
        .map_err(|error| locked_file_error("屏幕保护程序", &error))?;
    register_screen_saver(&paths.screen_saver)?;

    emit_progress(app, 62, "正在配置卸载程序…");
    install_uninstaller(&paths)?;

    emit_progress(app, 74, "正在创建快捷方式…");
    sync_shortcuts(&paths, &options)?;

    emit_progress(app, 88, "正在写入安装信息…");
    write_record(
        &paths.state_file,
        &InstallRecord {
            version: env!("CARGO_PKG_VERSION").to_string(),
            desktop_shortcuts: options.desktop_shortcuts,
            start_menu_shortcuts: options.start_menu_shortcuts,
        },
    )?;
    register_uninstaller(&paths)?;

    emit_progress(app, 100, "安装完成");
    Ok(())
}

pub fn uninstall(app: &AppHandle) -> Result<(), String> {
    let paths = InstallPaths::resolve();
    emit_progress(app, 8, "正在关闭 Pear Wall…");
    stop_running_components()?;

    emit_progress(app, 18, "正在清理登录启动项…");
    remove_autostart()?;

    emit_progress(app, 28, "正在移除快捷方式…");
    remove_all_shortcuts(&paths)?;

    emit_progress(app, 48, "正在移除屏幕保护程序…");
    clear_selected_screen_saver(&paths.screen_saver)?;
    remove_file_if_exists(&paths.screen_saver)
        .map_err(|error| locked_file_error("屏幕保护程序", &error))?;

    emit_progress(app, 68, "正在移除 Pear Wall…");
    remove_file_if_exists(&paths.main_executable)
        .map_err(|error| locked_file_error("Pear Wall", &error))?;
    remove_file_if_exists(&paths.state_file).map_err(|error| path_error("删除安装状态", &error))?;

    emit_progress(app, 86, "正在清理安装信息…");
    unregister_uninstaller()?;
    let _ = remove_file_if_exists(&paths.uninstaller);
    let _ = fs::remove_dir_all(&paths.install_dir);
    schedule_uninstall_cleanup(&paths)?;

    emit_progress(app, 100, "卸载完成");
    Ok(())
}

pub fn relaunch_uninstaller_if_needed() -> bool {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let uninstall = arguments.iter().any(|argument| argument == "--uninstall");
    let temporary = arguments.iter().any(|argument| argument == "--temporary");
    if !uninstall {
        return false;
    }

    if temporary {
        schedule_current_executable_deletion();
        return false;
    }

    let Ok(current_executable) = env::current_exe() else {
        return false;
    };
    let temporary_executable =
        env::temp_dir().join(format!("PearWall-Uninstaller-{}.exe", std::process::id()));
    if fs::copy(&current_executable, &temporary_executable).is_err() {
        return false;
    }

    Command::new(&temporary_executable)
        .args(["--uninstall", "--temporary"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
}

fn read_record(path: &Path) -> Option<InstallRecord> {
    let value = fs::read_to_string(path).ok()?;
    serde_json::from_str(&value).ok()
}

fn write_record(path: &Path, record: &InstallRecord) -> Result<(), String> {
    let data = serde_json::to_vec(record).map_err(|error| format!("无法生成安装状态：{error}"))?;
    replace_bytes(path, &data).map_err(|error| path_error("保存安装状态", &error))
}

fn replace_bytes(path: &Path, contents: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("pearwall-new");
    let _ = fs::remove_file(&temporary);
    fs::write(&temporary, contents)?;

    let mut last_error = None;
    for attempt in 0..20 {
        if path.exists() {
            if let Err(error) = fs::remove_file(path) {
                if !is_retryable_file_error(&error) || attempt == 19 {
                    let _ = fs::remove_file(&temporary);
                    return Err(error);
                }
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
        }
        match fs::rename(&temporary, path) {
            Ok(()) => return Ok(()),
            Err(error) if is_retryable_file_error(&error) && attempt < 19 => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(error);
            }
        }
    }

    let _ = fs::remove_file(&temporary);
    Err(last_error.unwrap_or_else(|| io::Error::other("无法替换安装文件")))
}

fn is_retryable_file_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::WouldBlock
    )
}

fn stop_running_components() -> Result<(), String> {
    for image_name in [MAIN_EXECUTABLE_NAME, SCREEN_SAVER_NAME] {
        let output = Command::new("taskkill.exe")
            .args(["/IM", image_name, "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("关闭 {image_name} 失败：{error}"))?;
        if output.status.success() || output.status.code() == Some(128) {
            continue;
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            format!("关闭 {image_name} 失败")
        } else {
            format!("关闭 {image_name} 失败：{detail}")
        });
    }
    Ok(())
}

fn remove_autostart() -> Result<(), String> {
    let output = Command::new("reg.exe")
        .args(["query", AUTOSTART_REGISTRY_KEY, "/v", AUTOSTART_VALUE_NAME])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("检查 Windows 登录启动项失败：{error}"))?;
    if !output.status.success() {
        return Ok(());
    }
    run_hidden(
        "reg.exe",
        [
            "delete".to_string(),
            AUTOSTART_REGISTRY_KEY.to_string(),
            "/v".to_string(),
            AUTOSTART_VALUE_NAME.to_string(),
            "/f".to_string(),
        ],
        "删除 Windows 登录启动项",
    )
}

fn install_uninstaller(paths: &InstallPaths) -> Result<(), String> {
    let current_executable =
        env::current_exe().map_err(|error| path_error("定位安装器", &error))?;
    if same_path(&current_executable, &paths.uninstaller) {
        return Ok(());
    }
    let data = fs::read(current_executable).map_err(|error| path_error("读取安装器", &error))?;
    replace_bytes(&paths.uninstaller, &data).map_err(|error| path_error("安装卸载程序", &error))
}

fn sync_shortcuts(paths: &InstallPaths, options: &InstallOptions) -> Result<(), String> {
    sync_shortcut_pair(
        &paths.desktop_dir,
        options.desktop_shortcuts,
        &paths.main_executable,
    )?;
    sync_shortcut_pair(
        &paths.start_menu_dir,
        options.start_menu_shortcuts,
        &paths.main_executable,
    )?;
    Ok(())
}

fn sync_shortcut_pair(directory: &Path, enabled: bool, target: &Path) -> Result<(), String> {
    let screen_saver_shortcut = directory.join(START_SHORTCUT_NAME);
    let settings_shortcut = directory.join(SETTINGS_SHORTCUT_NAME);
    if !enabled {
        remove_file_if_exists(&screen_saver_shortcut)
            .map_err(|error| path_error("删除屏保快捷方式", &error))?;
        remove_file_if_exists(&settings_shortcut)
            .map_err(|error| path_error("删除设置快捷方式", &error))?;
        remove_empty_dir(directory);
        return Ok(());
    }

    fs::create_dir_all(directory).map_err(|error| path_error("创建快捷方式目录", &error))?;
    create_shortcut(&screen_saver_shortcut, target, "/s")?;
    create_shortcut(&settings_shortcut, target, "/c")?;
    Ok(())
}

fn create_shortcut(path: &Path, target: &Path, arguments: &str) -> Result<(), String> {
    let working_directory = target.parent().unwrap_or_else(|| Path::new("."));
    let script = format!(
        "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('{}'); $shortcut.TargetPath = '{}'; $shortcut.Arguments = '{}'; $shortcut.WorkingDirectory = '{}'; $shortcut.IconLocation = '{},0'; $shortcut.Save()",
        powershell_literal(path),
        powershell_literal(target),
        powershell_text(arguments),
        powershell_literal(working_directory),
        powershell_literal(target),
    );
    run_powershell(&script, "创建快捷方式")
}

fn remove_all_shortcuts(paths: &InstallPaths) -> Result<(), String> {
    for directory in [&paths.desktop_dir, &paths.start_menu_dir] {
        for name in [START_SHORTCUT_NAME, SETTINGS_SHORTCUT_NAME] {
            remove_file_if_exists(&directory.join(name))
                .map_err(|error| path_error("删除快捷方式", &error))?;
        }
        remove_empty_dir(directory);
    }
    Ok(())
}

fn register_uninstaller(paths: &InstallPaths) -> Result<(), String> {
    let uninstall_command = format!("\"{}\" --uninstall", paths.uninstaller.display());
    let values = [
        ("DisplayName", "REG_SZ", "Pear Wall".to_string()),
        (
            "DisplayVersion",
            "REG_SZ",
            env!("CARGO_PKG_VERSION").to_string(),
        ),
        ("Publisher", "REG_SZ", "Pear Wall".to_string()),
        (
            "InstallLocation",
            "REG_SZ",
            paths.install_dir.display().to_string(),
        ),
        (
            "DisplayIcon",
            "REG_SZ",
            format!("{},0", paths.main_executable.display()),
        ),
        ("UninstallString", "REG_SZ", uninstall_command),
        ("NoModify", "REG_DWORD", "1".to_string()),
        ("NoRepair", "REG_DWORD", "1".to_string()),
    ];

    for (name, value_type, value) in values {
        run_hidden(
            "reg.exe",
            [
                "add".to_string(),
                UNINSTALL_REGISTRY_KEY.to_string(),
                "/v".to_string(),
                name.to_string(),
                "/t".to_string(),
                value_type.to_string(),
                "/d".to_string(),
                value,
                "/f".to_string(),
            ],
            "写入卸载信息",
        )?;
    }
    Ok(())
}

fn register_screen_saver(screen_saver: &Path) -> Result<(), String> {
    run_hidden(
        "reg.exe",
        [
            "add".to_string(),
            DESKTOP_REGISTRY_KEY.to_string(),
            "/v".to_string(),
            "SCRNSAVE.EXE".to_string(),
            "/t".to_string(),
            "REG_SZ".to_string(),
            "/d".to_string(),
            screen_saver.display().to_string(),
            "/f".to_string(),
        ],
        "注册屏幕保护程序",
    )?;
    set_screen_saver_active(true)
}

fn unregister_uninstaller() -> Result<(), String> {
    let output = Command::new("reg.exe")
        .args(["query", UNINSTALL_REGISTRY_KEY])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("检查卸载信息失败：{error}"))?;
    if !output.status.success() {
        return Ok(());
    }

    run_hidden(
        "reg.exe",
        [
            "delete".to_string(),
            UNINSTALL_REGISTRY_KEY.to_string(),
            "/f".to_string(),
        ],
        "删除卸载信息",
    )
}

fn clear_selected_screen_saver(screen_saver: &Path) -> Result<(), String> {
    let script = format!(
        "$key = 'HKCU:\\Control Panel\\Desktop'; $current = (Get-ItemProperty -LiteralPath $key -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue).'SCRNSAVE.EXE'; if ($current -and [string]::Equals($current, '{}', [System.StringComparison]::OrdinalIgnoreCase)) {{ Remove-ItemProperty -LiteralPath $key -Name 'SCRNSAVE.EXE' -ErrorAction Stop; exit {} }}",
        powershell_literal(screen_saver),
        SCREEN_SAVER_SELECTED_EXIT_CODE,
    );
    if run_powershell_flag(
        &script,
        SCREEN_SAVER_SELECTED_EXIT_CODE,
        "清理屏幕保护程序设置",
    )? {
        set_screen_saver_active(false)?;
    }
    Ok(())
}

fn set_screen_saver_active(active: bool) -> Result<(), String> {
    unsafe {
        SystemParametersInfoW(
            SPI_SETSCREENSAVEACTIVE,
            u32::from(active),
            None,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|error| {
            if active {
                format!("启用屏幕保护程序失败：{error}")
            } else {
                format!("停用屏幕保护程序失败：{error}")
            }
        })
    }
}

fn run_powershell(script: &str, action: &str) -> Result<(), String> {
    let encoded = encode_powershell(script);
    run_hidden(
        "powershell.exe",
        [
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-EncodedCommand".to_string(),
            encoded,
        ],
        action,
    )
}

fn run_powershell_flag(script: &str, true_exit_code: i32, action: &str) -> Result<bool, String> {
    let encoded = encode_powershell(script);
    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("{action}失败：{error}"))?;
    match output.status.code() {
        Some(0) => Ok(false),
        Some(code) if code == true_exit_code => Ok(true),
        _ => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if detail.is_empty() {
                format!("{action}失败")
            } else {
                format!("{action}失败：{detail}")
            })
        }
    }
}

fn encode_powershell(script: &str) -> String {
    let encoded_bytes: Vec<u8> = script
        .encode_utf16()
        .flat_map(|value| value.to_le_bytes())
        .collect();
    STANDARD.encode(encoded_bytes)
}

fn run_hidden<I>(program: &str, arguments: I, action: &str) -> Result<(), String>
where
    I: IntoIterator<Item = String>,
{
    let output = Command::new(program)
        .args(arguments)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("{action}失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        format!("{action}失败")
    } else {
        format!("{action}失败：{detail}")
    })
}

fn powershell_literal(path: &Path) -> String {
    powershell_text(&path.display().to_string())
}

fn powershell_text(value: &str) -> String {
    value.replace('\'', "''")
}

fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn remove_empty_dir(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir(path);
    }
}

fn same_path(first: &Path, second: &Path) -> bool {
    first
        .to_string_lossy()
        .eq_ignore_ascii_case(&second.to_string_lossy())
}

fn path_error(action: &str, error: &io::Error) -> String {
    format!("{action}失败：{error}")
}

fn locked_file_error(name: &str, error: &io::Error) -> String {
    if error.kind() == io::ErrorKind::PermissionDenied {
        format!("无法更新{name}，请先关闭正在运行的 Pear Wall 后重试")
    } else {
        format!("无法更新{name}：{error}")
    }
}

fn schedule_uninstall_cleanup(paths: &InstallPaths) -> Result<(), String> {
    let current_executable =
        env::current_exe().map_err(|error| path_error("定位卸载程序", &error))?;
    let delete_current = env::args().any(|argument| argument == "--temporary");
    let current_cleanup = if delete_current {
        format!(
            "Remove-Item -LiteralPath '{}' -Force -ErrorAction SilentlyContinue; ",
            powershell_literal(&current_executable),
        )
    } else {
        String::new()
    };
    let current_removed = if delete_current {
        format!(
            "-not (Test-Path -LiteralPath '{}')",
            powershell_literal(&current_executable),
        )
    } else {
        "$true".to_string()
    };
    let script = format!(
        "$process = Get-Process -Id {} -ErrorAction SilentlyContinue; if ($process) {{ $process.WaitForExit() }}; for ($attempt = 0; $attempt -lt 80; $attempt++) {{ Remove-Item -LiteralPath '{}' -Recurse -Force -ErrorAction SilentlyContinue; {}if ((-not (Test-Path -LiteralPath '{}')) -and ({})) {{ exit 0 }}; Start-Sleep -Milliseconds 250 }}; exit 1",
        std::process::id(),
        powershell_literal(&paths.install_dir),
        current_cleanup,
        powershell_literal(&paths.install_dir),
        current_removed,
    );
    let encoded = encode_powershell(&script);
    if Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_err()
    {
        schedule_path_deletion(&paths.uninstaller);
        schedule_path_deletion(&paths.install_dir);
        if delete_current {
            schedule_path_deletion(&current_executable);
        }
    }
    Ok(())
}

fn schedule_current_executable_deletion() {
    let Ok(path) = env::current_exe() else {
        return;
    };
    schedule_path_deletion(&path);
}

fn schedule_path_deletion(path: &Path) {
    let wide: Vec<u16> = OsStr::new(path.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let _ = MoveFileExW(
            PCWSTR(wide.as_ptr()),
            PCWSTR::null(),
            MOVEFILE_DELAY_UNTIL_REBOOT,
        );
    }
}
