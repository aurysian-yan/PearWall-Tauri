#[repr(C)]
struct MacPowerStatus {
    battery_percent: i32,
    on_battery: i32,
    low_power_mode: i32,
}

#[link(name = "pearwall_macos_power", kind = "static")]
unsafe extern "C" {
    fn pearwall_macos_power_status(status: *mut MacPowerStatus) -> i32;
}

pub fn read() -> Option<(Option<u8>, Option<bool>, bool)> {
    let mut status = MacPowerStatus {
        battery_percent: -1,
        on_battery: -1,
        low_power_mode: 0,
    };
    let result = unsafe { pearwall_macos_power_status(&mut status) };
    if result != 0 {
        return None;
    }
    let battery_percent = (0..=100)
        .contains(&status.battery_percent)
        .then_some(status.battery_percent as u8);
    let on_battery = match status.on_battery {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };
    Some((battery_percent, on_battery, status.low_power_mode != 0))
}
