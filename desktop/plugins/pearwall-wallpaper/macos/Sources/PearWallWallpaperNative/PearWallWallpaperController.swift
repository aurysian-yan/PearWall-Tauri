import AppKit
import CoreGraphics
import Foundation

private final class PearWallWallpaperWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class PearWallWallpaperTarget {
    let displayID: String
    let window: PearWallWallpaperWindow
    let session: PearWallRenderSession
    var screen: NSScreen

    init(
        displayID: String,
        window: PearWallWallpaperWindow,
        session: PearWallRenderSession,
        screen: NSScreen
    ) {
        self.displayID = displayID
        self.window = window
        self.session = session
        self.screen = screen
    }
}

final class PearWallWallpaperController {
    static let shared = PearWallWallpaperController()

    private var targets = [String: PearWallWallpaperTarget]()
    private var frameTimer: Timer?
    private var refreshTimer: Timer?
    private var screenObserver: NSObjectProtocol?
    private var spaceObserver: NSObjectProtocol?
    private var settings = PearWallSettings()
    private var lastSettingsSignature: PearWallFileSignature?
    private let renderState = PearWallRenderState()
    private(set) var running = false

    var displayCount: Int {
        targets.count
    }

    func start() -> Int32 {
        if running {
            reconcileDisplays()
            return targets.isEmpty ? 2 : 0
        }
        running = true
        refreshSettings(force: true)
        reconcileDisplays()
        guard !targets.isEmpty else {
            stop()
            return 2
        }
        renderState.lastFrameUptime = ProcessInfo.processInfo.systemUptime
        installObservers()
        startTimers()
        refreshArtwork()
        drawFrame()
        return 0
    }

    func stop() {
        running = false
        frameTimer?.invalidate()
        frameTimer = nil
        refreshTimer?.invalidate()
        refreshTimer = nil
        removeObservers()
        for target in targets.values {
            target.window.orderOut(nil)
            target.window.close()
        }
        targets.removeAll()
        renderState.lastFrameUptime = nil
    }

    func reconcileDisplays() {
        guard running else { return }
        let screens = selectedScreens(from: NSScreen.screens)
        let activeIDs = Set(screens.compactMap(Self.displayID))
        for displayID in targets.keys where !activeIDs.contains(displayID) {
            guard let target = targets.removeValue(forKey: displayID) else { continue }
            target.window.orderOut(nil)
            target.window.close()
        }
        for screen in screens {
            guard let displayID = Self.displayID(screen) else { continue }
            if let target = targets[displayID] {
                target.screen = screen
                target.window.setFrame(screen.frame, display: true)
                target.window.orderFrontRegardless()
                continue
            }
            guard let target = makeTarget(displayID: displayID, screen: screen) else {
                continue
            }
            targets[displayID] = target
            target.session.refreshArtwork(screen: screen)
            target.window.orderFrontRegardless()
        }
    }

    private func makeTarget(
        displayID: String,
        screen: NSScreen
    ) -> PearWallWallpaperTarget? {
        let contentRect = NSRect(origin: .zero, size: screen.frame.size)
        guard let session = PearWallRenderSession(
            frame: contentRect,
            settings: settings,
            state: renderState,
            resourceBundle: .main,
            displayID: displayID
        ) else {
            return nil
        }
        let window = PearWallWallpaperWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false,
            screen: screen
        )
        window.animationBehavior = .none
        window.backgroundColor = .black
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isOpaque = true
        window.isReleasedWhenClosed = false
        window.level = NSWindow.Level(
            rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1
        )
        window.contentView = session.view
        window.setFrame(screen.frame, display: true)
        return PearWallWallpaperTarget(
            displayID: displayID,
            window: window,
            session: session,
            screen: screen
        )
    }

    private func startTimers() {
        let frameTimer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            self?.drawFrame()
        }
        RunLoop.main.add(frameTimer, forMode: .common)
        self.frameTimer = frameTimer

        let refreshTimer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            self?.refreshSettings(force: false)
            self?.refreshPerformance()
            self?.reconcileDisplays()
            self?.refreshArtwork()
        }
        RunLoop.main.add(refreshTimer, forMode: .common)
        self.refreshTimer = refreshTimer
    }

    private func installObservers() {
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.reconcileDisplays()
            self?.refreshArtwork()
        }
        spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.reconcileDisplays()
        }
    }

    private func removeObservers() {
        if let screenObserver {
            NotificationCenter.default.removeObserver(screenObserver)
            self.screenObserver = nil
        }
        if let spaceObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(spaceObserver)
            self.spaceObserver = nil
        }
    }

    private func drawFrame() {
        guard running else { return }
        for target in targets.values {
            target.session.drawFrame()
        }
    }

    private func refreshPerformance() {
        guard running else { return }
        for target in targets.values {
            target.session.refreshPerformance()
        }
    }

    private func refreshArtwork() {
        guard running else { return }
        for target in targets.values {
            target.session.refreshArtwork(screen: target.screen)
        }
    }

    private func refreshSettings(force: Bool) {
        guard let shared = PearWallSettingsStore.readShared() else {
            if force {
                settings = PearWallSettings()
                for target in targets.values {
                    target.session.updateSettings(settings)
                }
            }
            return
        }
        guard force || shared.signature != lastSettingsSignature else { return }
        lastSettingsSignature = shared.signature
        settings = PearWallSettings(json: shared.json)
        for target in targets.values {
            target.session.updateSettings(settings)
        }
    }

    private func selectedScreens(from screens: [NSScreen]) -> [NSScreen] {
        guard let selectedIDs = settings.dynamicWallpaperDisplayIds else {
            return screens
        }
        let selectedIDSet = Set(selectedIDs)
        return screens.filter { screen in
            guard let displayID = Self.displayID(screen) else { return false }
            return selectedIDSet.contains(displayID)
        }
    }

    private static func displayID(_ screen: NSScreen) -> String? {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        guard let value = screen.deviceDescription[key] as? NSNumber else {
            return nil
        }
        return pearWallDisplayIdentifier(CGDirectDisplayID(value.uint32Value))
    }
}
