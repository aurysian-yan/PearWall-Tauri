use std::env;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const RUN_REGISTRY_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE_NAME: &str = "Pear Wall";

pub fn sync(enabled: bool) -> Result<(), String> {
    if enabled {
        enable()
    } else {
        disable()
    }
}

fn enable() -> Result<(), String> {
    let executable = application_executable()?;
    let command = format!("\"{}\" --wallpaper", executable.display());
    run_registry(
        [
            "add".to_string(),
            RUN_REGISTRY_KEY.to_string(),
            "/v".to_string(),
            RUN_VALUE_NAME.to_string(),
            "/t".to_string(),
            "REG_SZ".to_string(),
            "/d".to_string(),
            command,
            "/f".to_string(),
        ],
        "注册 Windows 登录启动项",
    )
}

fn disable() -> Result<(), String> {
    let output = Command::new("reg.exe")
        .args(["query", RUN_REGISTRY_KEY, "/v", RUN_VALUE_NAME])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("检查 Windows 登录启动项失败：{error}"))?;
    if !output.status.success() {
        return Ok(());
    }
    run_registry(
        [
            "delete".to_string(),
            RUN_REGISTRY_KEY.to_string(),
            "/v".to_string(),
            RUN_VALUE_NAME.to_string(),
            "/f".to_string(),
        ],
        "删除 Windows 登录启动项",
    )
}

fn application_executable() -> Result<PathBuf, String> {
    let executable =
        env::current_exe().map_err(|error| format!("无法定位 Pear Wall 运行程序：{error}"))?;
    if executable
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("scr"))
    {
        return Ok(executable.with_file_name("PearWall.exe"));
    }
    Ok(executable)
}

fn run_registry<I>(arguments: I, action: &str) -> Result<(), String>
where
    I: IntoIterator<Item = String>,
{
    let output = Command::new("reg.exe")
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
