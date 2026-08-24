#[link(name = "pearwall_macos_status_item", kind = "static")]
unsafe extern "C" {
    fn pearwall_main_install_status_item() -> i32;
    fn pearwall_main_application_is_active() -> i32;
}

pub fn install() -> Result<(), String> {
    match unsafe { pearwall_main_install_status_item() } {
        0 => Ok(()),
        _ => Err("无法创建菜单栏状态图标".to_string()),
    }
}

pub fn application_is_active() -> bool {
    unsafe { pearwall_main_application_is_active() != 0 }
}
