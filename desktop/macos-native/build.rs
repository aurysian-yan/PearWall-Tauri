use std::path::PathBuf;

fn main() {
    let desktop_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let native_root = desktop_root.join("src-tauri/native");

    cc::Build::new()
        .file(native_root.join("macos_now_playing.m"))
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-mmacosx-version-min=15.0")
        .compile("pearwall_macos_now_playing");
    cc::Build::new()
        .file(native_root.join("macos_audio_tap.m"))
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-mmacosx-version-min=15.0")
        .compile("pearwall_macos_audio_tap");

    if std::env::var_os("PEARWALL_XCODE_BUILD").is_none() {
        swift_rs::SwiftLinker::new("15.0")
            .with_package(
                "PearWallWallpaperNative",
                "../plugins/pearwall-wallpaper/macos",
            )
            .link();
    }

    for framework in [
        "AppKit",
        "CoreAudio",
        "Foundation",
        "Metal",
        "MetalKit",
        "QuartzCore",
        "SwiftUI",
        "WebKit",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=../plugins/pearwall-wallpaper/macos/Package.swift");
    println!("cargo:rerun-if-changed=../plugins/pearwall-wallpaper/macos/Sources");
}
