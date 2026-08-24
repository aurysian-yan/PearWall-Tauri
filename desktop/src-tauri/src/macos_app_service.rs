use serde::Serialize;
use std::ffi::{c_char, CStr};

#[link(name = "pearwall_macos_app_service", kind = "static")]
unsafe extern "C" {
    fn pearwall_main_service_status() -> isize;
    fn pearwall_main_service_set_enabled(enabled: i32) -> *mut c_char;
    fn pearwall_main_service_free_error(error: *mut c_char);
    fn pearwall_legacy_agent_service_remove();
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServiceStatus {
    pub status: &'static str,
    pub enabled: bool,
    pub requires_approval: bool,
}

pub fn status() -> AppServiceStatus {
    let value = unsafe { pearwall_main_service_status() };
    match value {
        1 => AppServiceStatus {
            status: "enabled",
            enabled: true,
            requires_approval: false,
        },
        2 => AppServiceStatus {
            status: "requiresApproval",
            enabled: false,
            requires_approval: true,
        },
        3 => AppServiceStatus {
            status: "notFound",
            enabled: false,
            requires_approval: false,
        },
        _ => AppServiceStatus {
            status: "notRegistered",
            enabled: false,
            requires_approval: false,
        },
    }
}

pub fn set_enabled(enabled: bool) -> Result<AppServiceStatus, String> {
    let error = unsafe { pearwall_main_service_set_enabled(if enabled { 1 } else { 0 }) };
    if error.is_null() {
        return Ok(status());
    }
    let message = unsafe { CStr::from_ptr(error) }
        .to_string_lossy()
        .into_owned();
    unsafe { pearwall_main_service_free_error(error) };
    Err(message)
}

pub fn ensure_enabled() -> Result<AppServiceStatus, String> {
    unsafe { pearwall_legacy_agent_service_remove() };
    let current = status();
    if current.enabled || current.requires_approval {
        return Ok(current);
    }
    set_enabled(true)
}
