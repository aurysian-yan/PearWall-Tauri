// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearWallWallpaperNative",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(
            name: "PearWallWallpaperNative",
            type: .static,
            targets: ["PearWallWallpaperNative"]
        ),
    ],
    targets: [
        .target(
            name: "PearWallWallpaperNative",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("WebKit"),
            ]
        ),
    ],
    swiftLanguageVersions: [.v5]
)
