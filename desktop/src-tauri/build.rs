use std::process::Command;

fn main() {
    add_macos_swift_runtime_paths();
    tauri_build::build()
}

fn add_macos_swift_runtime_paths() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    println!("cargo:rustc-link-arg-bin=pearwall-desktop=-Wl,-rpath,/usr/lib/swift");
    let Ok(output) = Command::new("xcode-select").arg("-p").output() else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let developer_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if developer_dir.is_empty() {
        return;
    }
    for path in [
        format!(
            "{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx"
        ),
        format!("{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"),
    ] {
        println!("cargo:rustc-link-arg-bin=pearwall-desktop=-Wl,-rpath,{path}");
    }
}
