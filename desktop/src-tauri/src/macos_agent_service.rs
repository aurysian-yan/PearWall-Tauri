use serde::Serialize;
use std::ffi::{c_char, CStr};

#[link(name = "pearwall_macos_agent_service", kind = "static")]
unsafe extern "C" {
    fn pearwall_agent_service_status() -> isize;
    fn pearwall_agent_service_set_enabled(enabled: i32) -> *mut c_char;
    fn pearwall_agent_service_free_error(error: *mut c_char);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentServiceStatus {
    pub status: &'static str,
    pub enabled: bool,
    pub requires_approval: bool,
}

pub fn status() -> AgentServiceStatus {
    let value = unsafe { pearwall_agent_service_status() };
    match value {
        1 => AgentServiceStatus {
            status: "enabled",
            enabled: true,
            requires_approval: false,
        },
        2 => AgentServiceStatus {
            status: "requiresApproval",
            enabled: false,
            requires_approval: true,
        },
        3 => AgentServiceStatus {
            status: "notFound",
            enabled: false,
            requires_approval: false,
        },
        _ => AgentServiceStatus {
            status: "notRegistered",
            enabled: false,
            requires_approval: false,
        },
    }
}

pub fn set_enabled(enabled: bool) -> Result<AgentServiceStatus, String> {
    let error = unsafe { pearwall_agent_service_set_enabled(if enabled { 1 } else { 0 }) };
    if error.is_null() {
        return Ok(status());
    }
    let message = unsafe { CStr::from_ptr(error) }
        .to_string_lossy()
        .into_owned();
    unsafe { pearwall_agent_service_free_error(error) };
    Err(message)
}

pub fn ensure_enabled() -> Result<AgentServiceStatus, String> {
    let current = status();
    if current.enabled || current.requires_approval {
        return Ok(current);
    }
    set_enabled(true)
}

pub fn launch_bundled_agent() -> bool {
    let Ok(executable) = std::env::current_exe() else {
        return false;
    };
    let Some(contents) = executable.parent().and_then(|path| path.parent()) else {
        return false;
    };
    let agent = contents
        .join("Library")
        .join("LoginItems")
        .join("Pear Wall Agent.app");
    if !agent.is_dir() {
        return false;
    }
    let executable = agent.join("Contents").join("MacOS").join("PearWallAgent");
    std::process::Command::new(executable)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}
