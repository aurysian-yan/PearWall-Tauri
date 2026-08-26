#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
fn run_screen_saver_host() -> bool {
    let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let Some(mode) = arguments.first().and_then(|value| value.to_str()) else {
        return false;
    };
    if !matches!(mode.to_ascii_lowercase().as_str(), "/s" | "-s") {
        return false;
    }

    let Ok(current_executable) = std::env::current_exe() else {
        return false;
    };
    if !current_executable
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("scr"))
    {
        return false;
    }

    let host_executable = current_executable.with_file_name("PearWall.exe");
    if !host_executable.is_file() {
        return false;
    }

    let mut command = std::process::Command::new(host_executable);
    command.args(arguments);
    if let Some(install_directory) = current_executable.parent() {
        command.current_dir(install_directory);
    }
    command.status().is_ok()
}

fn main() {
    #[cfg(windows)]
    if run_screen_saver_host() {
        return;
    }

    pearwall_desktop_lib::run();
}
