unsafe extern "C" {
    fn pearwall_native_application_run() -> i32;
}

fn main() {
    let start_status = pearwall_macos_native::pearwall_runtime_start();
    if start_status != 0 {
        std::process::exit(start_status);
    }
    let status = unsafe { pearwall_native_application_run() };
    if status != 0 {
        std::process::exit(status);
    }
}
