use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let output_dir = PathBuf::from(env::var_os("OUT_DIR").expect("缺少 OUT_DIR"));
    let embedded_payload = output_dir.join("PearWall.exe");

    println!("cargo:rerun-if-env-changed=PEARWALL_PAYLOAD_PATH");
    if let Some(payload_path) = env::var_os("PEARWALL_PAYLOAD_PATH") {
        println!(
            "cargo:rerun-if-changed={}",
            PathBuf::from(&payload_path).display()
        );
        fs::copy(payload_path, &embedded_payload).expect("无法嵌入 Pear Wall 运行程序");
    } else {
        fs::write(&embedded_payload, []).expect("无法创建安装器占位载荷");
    }

    let windows = tauri_build::WindowsAttributes::new()
        .window_icon_path("../../src-tauri/icons/icon.ico")
        .app_manifest(include_str!("installer.manifest.xml"));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("无法生成 Pear Wall 安装器资源");
}
