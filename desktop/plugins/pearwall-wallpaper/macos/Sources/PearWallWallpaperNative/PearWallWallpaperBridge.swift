import Foundation

private func pearWallOnMain<T>(_ operation: @escaping () -> T) -> T {
    if Thread.isMainThread {
        return operation()
    }
    return DispatchQueue.main.sync(execute: operation)
}

@_cdecl("pearwall_wallpaper_start")
public func pearWallWallpaperStart() -> Int32 {
    pearWallOnMain {
        PearWallWallpaperController.shared.start()
    }
}

@_cdecl("pearwall_wallpaper_stop")
public func pearWallWallpaperStop() -> Int32 {
    pearWallOnMain {
        PearWallWallpaperController.shared.stop()
        return 0
    }
}

@_cdecl("pearwall_wallpaper_reconcile")
public func pearWallWallpaperReconcile() -> Int32 {
    pearWallOnMain {
        PearWallWallpaperController.shared.reconcileDisplays()
        return 0
    }
}

@_cdecl("pearwall_wallpaper_is_running")
public func pearWallWallpaperIsRunning() -> Int32 {
    pearWallOnMain {
        PearWallWallpaperController.shared.running ? 1 : 0
    }
}

@_cdecl("pearwall_wallpaper_display_count")
public func pearWallWallpaperDisplayCount() -> Int32 {
    pearWallOnMain {
        Int32(PearWallWallpaperController.shared.displayCount)
    }
}

@_cdecl("pearwall_show_settings_window")
public func pearwallShowSettingsWindow() {
    pearWallOnMain {
        PearWallSettingsWindowController.shared.show()
    }
}
