fn main() {
    tauri_plugin::Builder::new(&["start", "stop", "status", "reconcile"]).build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    link_swift_package();

    for framework in [
        "AppKit",
        "CoreGraphics",
        "Foundation",
        "Metal",
        "MetalKit",
        "QuartzCore",
        "WebKit",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rerun-if-changed=macos/Package.swift");
    println!("cargo:rerun-if-changed=macos/Sources");
}

#[cfg(feature = "macos-native")]
fn link_swift_package() {
    swift_rs::SwiftLinker::new("15.0")
        .with_package("PearWallWallpaperNative", "macos")
        .link();
}

#[cfg(not(feature = "macos-native"))]
fn link_swift_package() {
    panic!("macOS 构建必须启用 macos-native feature");
}
