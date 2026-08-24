import AppKit
import Darwin
import Foundation
import ScreenSaver
import WebKit

@_silgen_name("pearwall_runtime_state_open")
private func pearwallRuntimeStateOpen(_ path: UnsafePointer<CChar>) -> UnsafeMutableRawPointer?

@_silgen_name("pearwall_runtime_state_read")
private func pearwallRuntimeStateRead(
    _ handle: UnsafeMutableRawPointer,
    _ pulse: UnsafeMutablePointer<Float>,
    _ updatedAtMilliseconds: UnsafeMutablePointer<UInt64>
) -> Int32

@_silgen_name("pearwall_runtime_state_close")
private func pearwallRuntimeStateClose(_ handle: UnsafeMutableRawPointer)

private func pearWallApplicationSupportDirectory() -> URL? {
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

@objc(PearWallScreenSaverView)
final class PearWallScreenSaverView: ScreenSaverView, WKNavigationDelegate {
    private static let settingsKey = "pearwall.settings"
    private static let sharedSettingsFileName = "settings.json"
    private static let companionAppBundleIdentifier = "com.nevoit.pearwall.desktop"
    private var webView: WKWebView?
    private var configurationWindow: NSWindow?
    private var artworkTimer: Timer?
    private var lastSentArtworkKey = ""
    private var lastSentDesktopWallpaperPath = ""
    private var lastAppliedSettingsJSON = "{}"
    private var lastSettingsModificationDate: Date?
    private var previewMode = false
    private var pageReady = false
    private var renderingActive = false
    private var renderTargetActive = false
    private var selectedDisplay = PearWallScreenSaverDisplay.primary
    private var pulseTimer: Timer?
    private var pulseEvaluationPending = false
    private var pulseEvaluationStartedAt: TimeInterval = 0
    private var pulseEvaluationID: UInt64 = 0
    private var pulseGeneration: UInt64 = 0
    private var pageReloadRequired = false
    private let mediaRemote = MediaRemoteBridge()
    private let runtimePulseReader = RuntimePulseReader()
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
        let json = loadSettingsJSON()
        lastAppliedSettingsJSON = json
        selectedDisplay = Self.screenSaverDisplay(from: json)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard renderingActive else { return }
        reconcileRenderTarget()
    }

    private func createWebViewIfNeeded() {
        guard webView == nil else { return }
        let configuration = makeWebViewConfiguration()
        let view = WKWebView(frame: bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        addSubview(view)
        webView = view

        guard let indexURL = Bundle(for: type(of: self)).url(
            forResource: "index",
            withExtension: "html",
            subdirectory: "web",
        ) else {
            return
        }
        view.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    private func destroyWebView() {
        pageReady = false
        pageReloadRequired = false
        pulseGeneration &+= 1
        pulseEvaluationPending = false
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
    }

    private func startRefreshTimer() {
        guard artworkTimer == nil else { return }
        artworkTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.refreshArtwork()
            self?.refreshDesktopWallpaper()
            self?.refreshSharedSettings()
        }
    }

    override func startAnimation() {
        super.startAnimation()
        renderingActive = true
        pulseGeneration &+= 1
        pulseEvaluationPending = false
        startRefreshTimer()
        refreshSharedSettings()
        reconcileRenderTarget()
    }

    override func animateOneFrame() {
        super.animateOneFrame()
    }

    override func stopAnimation() {
        renderingActive = false
        renderTargetActive = false
        pulseGeneration &+= 1
        pulseEvaluationPending = false
        artworkTimer?.invalidate()
        artworkTimer = nil
        pulseTimer?.invalidate()
        pulseTimer = nil
        super.stopAnimation()
    }

    private func startPulseTimer() {
        guard pulseTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            self?.publishPulseIfNeeded()
        }
        RunLoop.main.add(timer, forMode: .common)
        pulseTimer = timer
    }

    private func reconcileRenderTarget() {
        let shouldRender = previewMode || isCurrentScreenSelected()
        guard shouldRender != renderTargetActive || (shouldRender && webView == nil) else {
            return
        }
        renderTargetActive = shouldRender
        pulseGeneration &+= 1
        pulseEvaluationPending = false
        if shouldRender {
            createWebViewIfNeeded()
            startPulseTimer()
            if pageReloadRequired {
                pageReloadRequired = false
                webView?.reload()
            }
            refreshArtwork()
            refreshDesktopWallpaper()
            publishPulseIfNeeded()
            return
        }
        pulseTimer?.invalidate()
        pulseTimer = nil
        destroyWebView()
    }

    private func isCurrentScreenSelected() -> Bool {
        let screens = NSScreen.screens
        guard !screens.isEmpty,
              let currentScreen = window?.screen,
              let currentDisplayID = Self.displayID(for: currentScreen) else {
            return false
        }
        let targetScreen: NSScreen?
        switch selectedDisplay {
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

    private func publishPulseIfNeeded() {
        guard renderingActive,
              renderTargetActive,
              pageReady,
              let webView else {
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if pulseEvaluationPending,
           now - pulseEvaluationStartedAt < 0.25 {
            return
        }
        pulseEvaluationPending = true
        pulseEvaluationStartedAt = now
        pulseEvaluationID &+= 1
        let evaluationID = pulseEvaluationID
        let generation = pulseGeneration
        let pulse = runtimePulseReader.currentPulse()
        let timestamp = now * 1_000
        let script = "window.PearWallRenderFrame && window.PearWallRenderFrame(\(timestamp), \(pulse));"
        webView.evaluateJavaScript(script) { [weak self] _, _ in
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      self.pulseGeneration == generation,
                      self.pulseEvaluationID == evaluationID else {
                    return
                }
                self.pulseEvaluationPending = false
            }
        }
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
        webView?.evaluateJavaScript(
            "window.PearWallReloadSettings && window.PearWallReloadSettings();",
        )
    }

    private func makeWebViewConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        let json = lastAppliedSettingsJSON
        let jsonString = Self.javascriptString(json)
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "window.PearWallNativeFrameDriver = true;" +
                    "window.PearWallScreenSaverSettings = JSON.parse(\(jsonString));",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false,
            ),
        )
        return configuration
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
              Self.isSettingsJSON(json),
              json != lastAppliedSettingsJSON else {
            return
        }
        lastAppliedSettingsJSON = json
        selectedDisplay = Self.screenSaverDisplay(from: json)
        reconcileRenderTarget()
        guard renderTargetActive else { return }
        applySettingsJSON(json)
    }

    private func applySettingsJSON(_ json: String) {
        let jsonString = Self.javascriptString(json)
        webView?.evaluateJavaScript(
            "window.PearWallScreenSaverSettings = JSON.parse(\(jsonString));" +
            "window.PearWallReloadSettings && window.PearWallReloadSettings();",
        )
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

    private static func screenSaverDisplay(from json: String) -> PearWallScreenSaverDisplay {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["screenSaverDisplay"] as? String,
              let display = PearWallScreenSaverDisplay(rawValue: value) else {
            return .primary
        }
        return display
    }

    private func refreshArtwork() {
        guard renderTargetActive, pageReady else { return }
        mediaRemote.fetchNowPlaying { [weak self] artwork in
            guard let self, self.renderTargetActive else { return }
            let key = artwork?.key ?? ""
            let dataURL = artwork?.dataURL ?? ""
            guard key != self.lastSentArtworkKey else { return }
            guard let webView = self.webView else { return }
            let keyJSON = Self.javascriptString(key)
            let dataJSON = Self.javascriptString(dataURL)
            webView.evaluateJavaScript(
                "(() => {" +
                    "if (typeof window.PearWallSetArtwork !== 'function') return false;" +
                    "window.PearWallSetArtwork(\(keyJSON), \(dataJSON));" +
                    "return true;" +
                    "})()",
            ) { [weak self] value, error in
                if error == nil, value as? Bool == true {
                    self?.lastSentArtworkKey = key
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard renderTargetActive, webView === self.webView else { return }
        pageReady = true
        pageReloadRequired = false
        lastSentArtworkKey = ""
        lastSentDesktopWallpaperPath = ""
        pulseGeneration &+= 1
        pulseEvaluationPending = false
        if !previewMode {
            webView.evaluateJavaScript(
                "window.PearWallSetScreenSaverMode && window.PearWallSetScreenSaverMode(true);",
            )
        }
        refreshArtwork()
        refreshDesktopWallpaper()
        publishPulseIfNeeded()
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        pageReady = false
        pulseGeneration &+= 1
        pulseEvaluationPending = false
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        pageReady = false
        pulseGeneration &+= 1
        pulseEvaluationPending = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        pageReloadRequired = true
        pulseGeneration &+= 1
        pulseEvaluationPending = false
        guard renderingActive else { return }
        pageReloadRequired = false
        webView.reload()
    }

    private func refreshDesktopWallpaper() {
        guard renderTargetActive,
              pageReady,
              let screen = window?.screen ?? NSScreen.screens.first,
              let url = NSWorkspace.shared.desktopImageURL(for: screen) else {
            return
        }
        let path = url.path
        guard path != lastSentDesktopWallpaperPath,
              let data = try? Data(contentsOf: url),
              !data.isEmpty,
              data.count <= 64 * 1024 * 1024,
              let webView else {
            return
        }
        let mimeType = Self.wallpaperMimeType(url: url, data: data)
        let dataURL = "data:\(mimeType);base64,\(data.base64EncodedString())"
        let dataJSON = Self.javascriptString(dataURL)
        webView.evaluateJavaScript(
            "(() => {" +
                "if (typeof window.PearWallSetDesktopArtwork !== 'function') return false;" +
                "window.PearWallSetDesktopArtwork(\(dataJSON));" +
                "return true;" +
                "})()",
        ) { [weak self] value, error in
            if error == nil, value as? Bool == true {
                self?.lastSentDesktopWallpaperPath = path
            }
        }
    }

    private static func wallpaperMimeType(url: URL, data: Data) -> String {
        switch url.pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "bmp": return "image/bmp"
        case "tif", "tiff": return "image/tiff"
        case "avif": return "image/avif"
        case "heic", "heif": return "image/heic"
        case "svg": return "image/svg+xml"
        default: return MediaRemoteBridge.sniffMimeType(data)
        }
    }

    private static func javascriptString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let array = String(data: data, encoding: .utf8),
              array.count >= 2 else {
            return "\"\""
        }
        return String(array.dropFirst().dropLast())
    }
}

private final class RuntimePulseReader {
    private static let maximumAgeMilliseconds: UInt64 = 1_000
    private var handle: UnsafeMutableRawPointer?
    private var nextOpenAttempt = Date.distantPast

    deinit {
        if let handle {
            pearwallRuntimeStateClose(handle)
        }
    }

    func currentPulse() -> Float {
        openIfNeeded()
        guard let handle else { return 0 }
        var pulse: Float = 0
        var updatedAtMilliseconds: UInt64 = 0
        guard pearwallRuntimeStateRead(handle, &pulse, &updatedAtMilliseconds) == 1,
              pulse.isFinite else {
            return 0
        }
        let now = UInt64(max(0, Date().timeIntervalSince1970 * 1_000))
        guard now >= updatedAtMilliseconds,
              now - updatedAtMilliseconds <= Self.maximumAgeMilliseconds else {
            return 0
        }
        return min(1, max(0, pulse))
    }

    private func openIfNeeded() {
        guard handle == nil,
              Date() >= nextOpenAttempt else {
            return
        }
        nextOpenAttempt = Date().addingTimeInterval(1)
        guard let url = Self.runtimeStateURL else { return }
        handle = url.path.withCString { pearwallRuntimeStateOpen($0) }
    }

    private static var runtimeStateURL: URL? {
        pearWallApplicationSupportDirectory()?
            .appendingPathComponent("runtime-state-v1.bin")
    }
}

private struct MediaArtwork {
    let key: String
    let dataURL: String
}

private final class MediaRemoteBridge {
    private typealias NowPlayingCallback = @convention(block) (NSDictionary?) -> Void
    private typealias GetNowPlayingInfo = @convention(c) (DispatchQueue, @escaping NowPlayingCallback) -> Void
    private typealias RegisterForNowPlayingNotifications = @convention(c) (DispatchQueue) -> Void

    private static let perlLoader = """
    use strict;
    use warnings;
    use DynaLoader;
    my $library = shift @ARGV or die "missing library";
    my $symbol_name = shift @ARGV or die "missing symbol";
    my $handle = DynaLoader::dl_load_file($library, 0) or die DynaLoader::dl_error();
    my $symbol = DynaLoader::dl_find_symbol($handle, $symbol_name) or die "missing symbol";
    my $function = DynaLoader::dl_install_xsub("main::$symbol_name", $symbol);
    &$function();
    """

    private let handle: UnsafeMutableRawPointer?
    private let getNowPlayingInfo: GetNowPlayingInfo?
    private let helperQueue = DispatchQueue(label: "com.nevoit.pearwall.mediaremote")
    private var fetchPending = false

    init() {
        handle = dlopen(
            "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
            RTLD_LAZY,
        )
        if let symbol = handle.flatMap({ dlsym($0, "MRMediaRemoteGetNowPlayingInfo") }) {
            getNowPlayingInfo = unsafeBitCast(symbol, to: GetNowPlayingInfo.self)
        } else {
            getNowPlayingInfo = nil
        }
        if let symbol = handle.flatMap({
            dlsym($0, "MRMediaRemoteRegisterForNowPlayingNotifications")
        }) {
            let register = unsafeBitCast(symbol, to: RegisterForNowPlayingNotifications.self)
            register(.global(qos: .userInitiated))
        }
    }

    deinit {
        if let handle {
            dlclose(handle)
        }
    }

    func fetchNowPlaying(completion: @escaping (MediaArtwork?) -> Void) {
        guard !fetchPending else { return }
        fetchPending = true
        helperQueue.async { [weak self] in
            guard let self else { return }
            if let artwork = Self.readViaSharedCache() {
                self.finishFetch(artwork, completion: completion)
                return
            }
            if let artwork = Self.readViaSystemHost() {
                self.finishFetch(artwork, completion: completion)
                return
            }
            DispatchQueue.main.async {
                self.fetchLegacy(completion: completion)
            }
        }
    }

    private static func readViaSharedCache() -> MediaArtwork? {
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
              now - updatedAtMilliseconds <= 10_000 else {
            return nil
        }
        return MediaArtwork(
            key: key,
            dataURL: object["data_url"] as? String ?? "",
        )
    }

    private func fetchLegacy(completion: @escaping (MediaArtwork?) -> Void) {
        guard let getNowPlayingInfo else {
            finishFetch(nil, completion: completion)
            return
        }
        getNowPlayingInfo(.main) { [weak self] info in
            DispatchQueue.main.async { [weak self] in
                self?.finishFetch(Self.artwork(from: info), completion: completion)
            }
        }
    }

    private func finishFetch(
        _ artwork: MediaArtwork?,
        completion: @escaping (MediaArtwork?) -> Void
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.fetchPending = false
            completion(artwork)
        }
    }

    private static func readViaSystemHost() -> MediaArtwork? {
        guard let library = mediaRemoteLibraryURL() else { return nil }
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
        process.arguments = [
            "-e",
            perlLoader,
            library.path,
            "pearwall_print_now_playing_json",
        ]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return nil
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let object = try? JSONSerialization.jsonObject(with: data),
              let json = object as? [String: Any],
              let key = json["key"] as? String,
              !key.isEmpty else {
            return nil
        }
        return MediaArtwork(key: key, dataURL: json["data_url"] as? String ?? "")
    }

    private static func mediaRemoteLibraryURL() -> URL? {
        var candidates: [URL] = []
        if let resourceURL = Bundle(for: MediaRemoteBridge.self).resourceURL {
            candidates.append(
                resourceURL
                    .appendingPathComponent("mediaremote", isDirectory: true)
                    .appendingPathComponent("PearWallMediaRemote.dylib")
            )
        }
        if let appURL = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: "com.nevoit.pearwall.desktop"
        ) {
            candidates.append(
                appURL
                    .appendingPathComponent("Contents/Resources/mediaremote", isDirectory: true)
                    .appendingPathComponent("PearWallMediaRemote.dylib")
            )
        }
        return candidates.first { FileManager.default.isReadableFile(atPath: $0.path) }
    }

    private static func artwork(from info: NSDictionary?) -> MediaArtwork? {
        guard let info else { return nil }
        let title = stringValue(info["kMRMediaRemoteNowPlayingInfoTitle"])
        let artist = stringValue(info["kMRMediaRemoteNowPlayingInfoArtist"])
        let album = stringValue(info["kMRMediaRemoteNowPlayingInfoAlbum"])
        let artworkData = dataValue(info["kMRMediaRemoteNowPlayingInfoArtworkData"])
        guard !title.isEmpty || !artist.isEmpty || !album.isEmpty || artworkData != nil else {
            return nil
        }

        let keyPrefix = [title, artist, album].joined(separator: "\u{1f}")
        guard let artworkData, !artworkData.isEmpty else {
            return MediaArtwork(key: "\(keyPrefix)\u{1e}false", dataURL: "")
        }
        let reportedMimeType = stringValue(info["kMRMediaRemoteNowPlayingInfoArtworkMIMEType"])
        let mimeType = normalizedMimeType(reportedMimeType) ?? sniffMimeType(artworkData)
        return MediaArtwork(
            key: "\(keyPrefix)\u{1e}true",
            dataURL: "data:\(mimeType);base64,\(artworkData.base64EncodedString())",
        )
    }

    private static func stringValue(_ value: Any?) -> String {
        if let value = value as? String { return value }
        if let value = value as? NSString { return value as String }
        return ""
    }

    private static func dataValue(_ value: Any?) -> Data? {
        if let value = value as? Data { return value }
        if let value = value as? NSData { return value as Data }
        return nil
    }

    private static func normalizedMimeType(_ value: String) -> String? {
        let normalized = value
            .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: true)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard let normalized,
              ["image/jpeg", "image/png", "image/webp", "image/gif"].contains(normalized) else {
            return nil
        }
        return normalized
    }

    fileprivate static func sniffMimeType(_ data: Data) -> String {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xff, 0xd8, 0xff]) { return "image/jpeg" }
        if bytes.starts(with: [0x47, 0x49, 0x46, 0x38]) { return "image/gif" }
        if bytes.count >= 12 && bytes.starts(with: [0x52, 0x49, 0x46, 0x46]) && bytes[8..<12].elementsEqual([0x57, 0x45, 0x42, 0x50]) {
            return "image/webp"
        }
        return "image/png"
    }
}
