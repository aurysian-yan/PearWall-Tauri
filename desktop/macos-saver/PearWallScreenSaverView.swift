import AppKit
import Darwin
import Foundation
import MetalKit
import ScreenSaver

func pearWallApplicationSupportDirectory() -> URL? {
    guard let user = getpwuid(getuid()),
          let homeDirectory = user.pointee.pw_dir else {
        return nil
    }
    return URL(fileURLWithPath: String(cString: homeDirectory), isDirectory: true)
        .appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("Application Support", isDirectory: true)
        .appendingPathComponent("PearWall", isDirectory: true)
}

private enum PearWallScreenSaverDisplay: String {
    case primary = "PRIMARY"
    case secondary = "SECONDARY"
}

private enum PearWallArtworkFallback: String {
    case defaultArtwork = "DEFAULT"
    case custom = "CUSTOM"
    case desktop = "DESKTOP"
}

private struct PearWallSettings {
    var audioVisualization = true
    var pauseFlow = true
    var hideCursor = true
    var screenSaverDisplay = PearWallScreenSaverDisplay.primary
    var renderScale = 0.75
    var blurEnabled = true
    var blurMultiplier = 1.0
    var scrimAlpha = 0.4
    var flowSpeed = "NORMAL"
    var moruStyle = "OFF"
    var portraitPreset = 0
    var landscapePreset = 0
    var randomPreset = false
    var artworkFallback = PearWallArtworkFallback.defaultArtwork
    var customArtwork = ""

    init(json: String = "{}") {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        audioVisualization = Self.boolean(object, key: "audioVisualization", fallback: audioVisualization)
        pauseFlow = Self.boolean(object, key: "pauseFlow", fallback: pauseFlow)
        hideCursor = Self.boolean(object, key: "hideCursor", fallback: hideCursor)
        renderScale = Self.number(object, key: "renderScale", fallback: renderScale)
        blurEnabled = Self.boolean(object, key: "blurEnabled", fallback: blurEnabled)
        blurMultiplier = Self.number(object, key: "blurMultiplier", fallback: blurMultiplier)
        scrimAlpha = Self.number(object, key: "scrimAlpha", fallback: scrimAlpha)
        flowSpeed = Self.string(object, key: "flowSpeed", fallback: flowSpeed)
        moruStyle = Self.string(object, key: "moruStyle", fallback: moruStyle)
        portraitPreset = Self.integer(object, key: "portraitPreset", fallback: portraitPreset)
        landscapePreset = Self.integer(object, key: "landscapePreset", fallback: landscapePreset)
        randomPreset = Self.boolean(object, key: "randomPreset", fallback: randomPreset)
        customArtwork = Self.string(object, key: "customArtwork", fallback: customArtwork)
        if let value = PearWallScreenSaverDisplay(
            rawValue: Self.string(object, key: "screenSaverDisplay", fallback: "PRIMARY")
        ) {
            screenSaverDisplay = value
        }
        if let value = PearWallArtworkFallback(
            rawValue: Self.string(object, key: "artworkFallback", fallback: "DEFAULT")
        ) {
            artworkFallback = value
        } else if !customArtwork.isEmpty {
            artworkFallback = .custom
        }
    }

    private static func boolean(
        _ object: [String: Any],
        key: String,
        fallback: Bool
    ) -> Bool {
        (object[key] as? NSNumber)?.boolValue ?? fallback
    }

    private static func number(
        _ object: [String: Any],
        key: String,
        fallback: Double
    ) -> Double {
        (object[key] as? NSNumber)?.doubleValue ?? fallback
    }

    private static func integer(
        _ object: [String: Any],
        key: String,
        fallback: Int
    ) -> Int {
        (object[key] as? NSNumber)?.intValue ?? fallback
    }

    private static func string(
        _ object: [String: Any],
        key: String,
        fallback: String
    ) -> String {
        object[key] as? String ?? fallback
    }
}

private struct PearWallMediaArtwork {
    let key: String
    let source: String
    let playing: Bool
}

private enum PearWallMediaArtworkCache {
    private static let maximumAgeMilliseconds: UInt64 = 10_000

    static func current() -> PearWallMediaArtwork? {
        guard let url = pearWallApplicationSupportDirectory()?
            .appendingPathComponent("media-artwork.json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = object["key"] as? String,
              !key.isEmpty,
              let updatedAt = object["updated_at_milliseconds"] as? NSNumber else {
            return nil
        }
        let now = UInt64(max(0, Date().timeIntervalSince1970 * 1_000))
        let updatedAtMilliseconds = updatedAt.uint64Value
        guard now >= updatedAtMilliseconds,
              now - updatedAtMilliseconds <= maximumAgeMilliseconds else {
            return nil
        }
        return PearWallMediaArtwork(
            key: key,
            source: object["data_url"] as? String ?? "",
            playing: (object["playing"] as? NSNumber)?.boolValue ?? true,
        )
    }
}

@objc(PearWallScreenSaverView)
final class PearWallScreenSaverView: ScreenSaverView {
    private static let settingsKey = "pearwall.settings"
    private static let sharedSettingsFileName = "settings.json"
    private static let companionAppBundleIdentifier = "com.nevoit.pearwall.desktop"
    private var metalView: MTKView?
    private var metalRenderer: PearWallMetalRenderer?
    private var configurationWindow: NSWindow?
    private var refreshTimer: Timer?
    private var settings = PearWallSettings()
    private var lastSettingsModificationDate: Date?
    private var lastArtworkKey = ""
    private var previewMode = false
    private var renderingActive = false
    private var renderTargetActive = false
    private var cursorHidden = false
    private var playbackPlaying = true
    private let runtimeStateReader = PearWallRuntimeStateReader()
    private lazy var screenSaverDefaults = ScreenSaverDefaults(
        forModuleWithName: "com.nevoit.pearwall.screensaver",
    )

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        previewMode = isPreview
        configureView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        previewMode = isPreview
        configureView()
    }

    private func configureView() {
        animationTimeInterval = 1.0 / 60.0
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        settings = PearWallSettings(json: loadSettingsJSON())
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard renderingActive else { return }
        reconcileRenderTarget()
    }

    override func startAnimation() {
        super.startAnimation()
        renderingActive = true
        startRefreshTimer()
        refreshSharedSettings()
        reconcileRenderTarget()
        applyCursorVisibility()
    }

    override func animateOneFrame() {
        super.animateOneFrame()
        guard renderingActive, renderTargetActive else { return }
        let snapshot = runtimeStateReader.currentSnapshot()
        metalRenderer?.audioPulse = settings.audioVisualization ? snapshot?.pulse ?? 0 : 0
        metalRenderer?.playbackPlaying = playbackPlaying
        metalView?.draw()
    }

    override func stopAnimation() {
        renderingActive = false
        renderTargetActive = false
        refreshTimer?.invalidate()
        refreshTimer = nil
        restoreCursorVisibility()
        super.stopAnimation()
    }

    private func createMetalViewIfNeeded() {
        guard metalView == nil,
              let device = MTLCreateSystemDefaultDevice() else {
            return
        }
        let view = MTKView(frame: bounds, device: device)
        view.autoresizingMask = [.width, .height]
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.isPaused = true
        view.enableSetNeedsDisplay = false
        view.clearColor = MTLClearColorMake(0, 0, 0, 1)
        guard let renderer = try? PearWallMetalRenderer(view: view) else {
            return
        }
        addSubview(view)
        metalView = view
        metalRenderer = renderer
        lastArtworkKey = ""
    }

    private func destroyMetalView() {
        metalView?.removeFromSuperview()
        metalView = nil
        metalRenderer = nil
        lastArtworkKey = ""
    }

    private func reconcileRenderTarget() {
        let shouldRender = previewMode || isCurrentScreenSelected()
        guard shouldRender != renderTargetActive || (shouldRender && metalView == nil) else {
            return
        }
        renderTargetActive = shouldRender
        if shouldRender {
            createMetalViewIfNeeded()
            refreshArtwork()
        } else {
            destroyMetalView()
        }
    }

    private func isCurrentScreenSelected() -> Bool {
        let screens = NSScreen.screens
        guard !screens.isEmpty,
              let currentScreen = window?.screen,
              let currentDisplayID = Self.displayID(for: currentScreen) else {
            return false
        }
        let targetScreen: NSScreen?
        switch settings.screenSaverDisplay {
        case .primary:
            targetScreen = screens.first
        case .secondary:
            targetScreen = screens.dropFirst().first
        }
        guard let targetDisplayID = Self.displayID(for: targetScreen) else {
            return false
        }
        return currentDisplayID == targetDisplayID
    }

    private static func displayID(for screen: NSScreen?) -> NSNumber? {
        screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    }

    private func startRefreshTimer() {
        guard refreshTimer == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            self?.refreshSharedSettings()
            self?.refreshArtwork()
        }
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    private static var sharedSettingsURL: URL? {
        pearWallApplicationSupportDirectory()?
            .appendingPathComponent(sharedSettingsFileName)
    }

    private func loadSettingsJSON() -> String {
        if let url = Self.sharedSettingsURL,
           let data = try? Data(contentsOf: url),
           let json = String(data: data, encoding: .utf8),
           Self.isSettingsJSON(json) {
            lastSettingsModificationDate = Self.modificationDate(for: url)
            return json
        }
        if let legacy = screenSaverDefaults?.string(forKey: Self.settingsKey),
           Self.isSettingsJSON(legacy) {
            return legacy
        }
        return "{}"
    }

    private func refreshSharedSettings() {
        guard let url = Self.sharedSettingsURL,
              let modificationDate = Self.modificationDate(for: url),
              modificationDate != lastSettingsModificationDate else {
            return
        }
        lastSettingsModificationDate = modificationDate
        guard let data = try? Data(contentsOf: url),
              let json = String(data: data, encoding: .utf8),
              Self.isSettingsJSON(json) else {
            return
        }
        settings = PearWallSettings(json: json)
        lastArtworkKey = ""
        reconcileRenderTarget()
        applyCursorVisibility()
        refreshArtwork()
    }

    private static func modificationDate(for url: URL) -> Date? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }

    private static func isSettingsJSON(_ value: String) -> Bool {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) else {
            return false
        }
        return object is [String: Any]
    }

    private func refreshArtwork() {
        guard renderTargetActive, let metalRenderer else { return }
        if let artwork = PearWallMediaArtworkCache.current() {
            playbackPlaying = artwork.playing
            if !artwork.source.isEmpty,
               applyArtwork(source: artwork.source, key: "media:\(artwork.key)", to: metalRenderer) {
                return
            }
        }
        playbackPlaying = false
        switch settings.artworkFallback {
        case .custom where !settings.customArtwork.isEmpty:
            if applyArtwork(
                source: settings.customArtwork,
                key: "custom",
                to: metalRenderer
            ) {
                return
            }
        case .desktop:
            if let screen = window?.screen ?? NSScreen.screens.first,
               let url = NSWorkspace.shared.desktopImageURL(for: screen),
               applyArtwork(source: url.absoluteString, key: "desktop:\(url.path)", to: metalRenderer) {
                return
            }
        default:
            break
        }
        guard let url = Bundle(for: type(of: self)).url(
            forResource: "default_artwork",
            withExtension: "svg",
            subdirectory: "assets"
        ) else {
            return
        }
        _ = applyArtwork(source: url.absoluteString, key: "default", to: metalRenderer)
    }

    private func applyArtwork(
        source: String,
        key: String,
        to renderer: PearWallMetalRenderer
    ) -> Bool {
        if key == lastArtworkKey {
            return true
        }
        guard let image = Self.image(from: source), renderer.setArtwork(image) else {
            return false
        }
        lastArtworkKey = key
        return true
    }

    private static func image(from source: String) -> NSImage? {
        if source.hasPrefix("data:") {
            guard let separator = source.firstIndex(of: ",") else { return nil }
            let metadata = source[..<separator]
            let payload = String(source[source.index(after: separator)...])
            let data: Data?
            if metadata.contains(";base64") {
                data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
            } else {
                data = payload.removingPercentEncoding?.data(using: .utf8)
            }
            return data.flatMap(NSImage.init(data:))
        }
        if let url = URL(string: source), url.isFileURL {
            return NSImage(contentsOf: url)
        }
        if let data = Data(base64Encoded: source, options: .ignoreUnknownCharacters),
           let image = NSImage(data: data) {
            return image
        }
        return NSImage(contentsOfFile: source)
    }

    private func applyCursorVisibility() {
        guard renderingActive, !previewMode else { return }
        if settings.hideCursor, !cursorHidden {
            NSCursor.hide()
            cursorHidden = true
        } else if !settings.hideCursor {
            restoreCursorVisibility()
        }
    }

    private func restoreCursorVisibility() {
        guard cursorHidden else { return }
        NSCursor.unhide()
        cursorHidden = false
    }

    override var hasConfigureSheet: Bool {
        true
    }

    override var configureSheet: NSWindow? {
        if let configurationWindow {
            return configurationWindow
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 180),
            styleMask: [.titled, .fullSizeContentView],
            backing: .buffered,
            defer: false,
        )
        window.title = ""
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
        window.isReleasedWhenClosed = false

        let contentView = NSView()
        let titleLabel = NSTextField(labelWithString: "在 Pear Wall App 中配置")
        titleLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        let descriptionLabel = NSTextField(
            wrappingLabelWithString: "封面、画面效果和屏保选项会自动同步到系统屏幕保护程序。",
        )
        descriptionLabel.textColor = .secondaryLabelColor
        let openButton = NSButton(
            title: "打开 Pear Wall",
            target: self,
            action: #selector(openCompanionApp(_:)),
        )
        openButton.bezelStyle = .rounded
        openButton.keyEquivalent = "\r"
        let doneButton = NSButton(
            title: "完成",
            target: self,
            action: #selector(closeConfigurationSheet(_:)),
        )
        doneButton.bezelStyle = .rounded
        doneButton.keyEquivalent = "\u{1b}"

        for view in [titleLabel, descriptionLabel, openButton, doneButton] {
            view.translatesAutoresizingMaskIntoConstraints = false
            contentView.addSubview(view)
        }
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 30),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 28),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -28),
            descriptionLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 10),
            descriptionLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            descriptionLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            openButton.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            openButton.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -24),
            doneButton.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            doneButton.centerYAnchor.constraint(equalTo: openButton.centerYAnchor),
        ])

        window.contentView = contentView
        configurationWindow = window
        return window
    }

    @objc private func openCompanionApp(_ sender: Any?) {
        let workspace = NSWorkspace.shared
        let installedURL = URL(fileURLWithPath: "/Applications/Pear Wall.app")
        let appURL = workspace.urlForApplication(
            withBundleIdentifier: Self.companionAppBundleIdentifier,
        ) ?? (FileManager.default.fileExists(atPath: installedURL.path) ? installedURL : nil)
        guard let appURL else {
            NSSound.beep()
            return
        }
        workspace.openApplication(
            at: appURL,
            configuration: NSWorkspace.OpenConfiguration(),
        ) { [weak self] _, error in
            guard error == nil else { return }
            DispatchQueue.main.async {
                self?.closeConfigurationSheet(nil)
            }
        }
    }

    @objc private func closeConfigurationSheet(_ sender: Any?) {
        guard let configurationWindow else { return }
        if let sheetParent = configurationWindow.sheetParent {
            sheetParent.endSheet(configurationWindow)
        } else {
            configurationWindow.orderOut(nil)
        }
    }
}
