import AppKit
import Foundation

@_cdecl("pearwall_native_application_run")
public func pearwallNativeApplicationRun() -> Int32 {
    let application = NSApplication.shared
    let delegate = PearWallNativeApplicationDelegate()
    application.delegate = delegate
    application.setActivationPolicy(.accessory)
    application.run()
    return 0
}

final class PearWallNativeApplicationDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installStatusItem()
        startConfiguredWallpaper()
        PearWallSettingsWindowController.shared.show()
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = NSImage(
                systemSymbolName: "waveform",
                accessibilityDescription: "Pear Wall"
            )
            button.image?.isTemplate = true
            button.toolTip = "Pear Wall"
        }

        let menu = NSMenu(title: "Pear Wall")
        let openItem = NSMenuItem(
            title: "打开 Pear Wall",
            action: #selector(openSettings),
            keyEquivalent: ""
        )
        openItem.target = self
        menu.addItem(openItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(
            title: "退出 Pear Wall",
            action: #selector(quitApplication),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)
        item.menu = menu
        statusItem = item
    }

    private func startConfiguredWallpaper() {
        guard let shared = PearWallSettingsStore.readShared(),
              PearWallSettings(json: shared.json).dynamicWallpaperEnabled else {
            return
        }
        _ = PearWallWallpaperController.shared.start()
    }

    @objc private func openSettings() {
        PearWallSettingsWindowController.shared.show()
    }

    @objc private func quitApplication() {
        NSApp.terminate(nil)
    }
}
