fn main() {
    tauri_plugin::Builder::new(&["start", "stop", "status", "reconcile"]).build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    swift_rs::SwiftLinker::new("15.0")
        .with_package("PearWallWallpaperNative", "macos")
        .link();

    for framework in [
        "AppKit",
        "CoreGraphics",
        "Foundation",
        "Metal",
        "MetalKit",
        "QuartzCore",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rerun-if-changed=macos/Package.swift");
    println!("cargo:rerun-if-changed=macos/Sources");
}
