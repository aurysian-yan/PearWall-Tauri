import AppKit
import Darwin

@_silgen_name("pearwall_runtime_start")
private func pearWallRuntimeStart() -> Int32

@main
struct PearWallMacOSApp {
    static func main() {
        let startStatus = pearWallRuntimeStart()
        if startStatus != 0 {
            Darwin.exit(startStatus)
        }

        let application = NSApplication.shared
        let delegate = PearWallNativeApplicationDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
