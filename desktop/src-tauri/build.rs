use std::process::Command;

fn main() {
    build_macos_native();
    add_macos_swift_runtime_paths();
    tauri_build::build()
}

fn build_macos_native() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    cc::Build::new()
        .file("native/macos_now_playing.m")
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-mmacosx-version-min=13.0")
        .compile("pearwall_macos_now_playing");
    cc::Build::new()
        .file("native/macos_agent_service.m")
        .flag("-fobjc-arc")
        .flag("-mmacosx-version-min=13.0")
        .compile("pearwall_macos_agent_service");
    cc::Build::new()
        .file("native/macos_agent_status_item.m")
        .flag("-fobjc-arc")
        .flag("-mmacosx-version-min=13.0")
        .compile("pearwall_macos_agent_status_item");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=ServiceManagement");
    println!("cargo:rerun-if-changed=native/macos_now_playing.m");
    println!("cargo:rerun-if-changed=native/macos_agent_service.m");
    println!("cargo:rerun-if-changed=native/macos_agent_status_item.m");
}

fn add_macos_swift_runtime_paths() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    for binary in ["pearwall-desktop", "pearwall-agent"] {
        println!("cargo:rustc-link-arg-bin={binary}=-Wl,-rpath,/usr/lib/swift");
    }
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
        format!("{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx"),
        format!("{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"),
    ] {
        for binary in ["pearwall-desktop", "pearwall-agent"] {
            println!("cargo:rustc-link-arg-bin={binary}=-Wl,-rpath,{path}");
        }
    }
}
