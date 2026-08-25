import AppKit
import Foundation
import ScreenSaver

@objc(PearWallScreenSaverView)
final class PearWallScreenSaverView: ScreenSaverView {
    private static let settingsKey = "pearwall.settings"
    private static let companionAppBundleIdentifier = "com.nevoit.pearwall.desktop"
    private var renderSession: PearWallRenderSession?
    private let renderState = PearWallRenderState()
    private var configurationDetailsLabel: NSTextField?
    private var configurationWindow: NSWindow?
    private var refreshTimer: Timer?
    private var screenParametersObserver: NSObjectProtocol?
    private var settings = PearWallSettings()
    private var lastSettingsSignature: PearWallFileSignature?
    private var previewMode = false
    private var renderingActive = false
    private var renderTargetActive = false
    private var cursorHidden = false
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

    deinit {
        refreshTimer?.invalidate()
        if let screenParametersObserver {
            NotificationCenter.default.removeObserver(screenParametersObserver)
        }
        restoreCursorVisibility()
    }

    private func configureView() {
        animationTimeInterval = 1.0 / 60.0
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        settings = PearWallSettings(json: loadSettingsJSON())
        configureConfigurationDetailsLabel()
        screenParametersObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.renderingActive else { return }
            self.reconcileRenderTarget()
            self.refreshArtwork()
            self.updateConfigurationDetails()
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateConfigurationDetails()
        guard renderingActive else { return }
        reconcileRenderTarget()
        refreshArtwork()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateConfigurationDetails()
    }

    override func startAnimation() {
        super.startAnimation()
        renderingActive = true
        renderState.lastFrameUptime = ProcessInfo.processInfo.systemUptime
        startRefreshTimer()
        refreshSharedSettings()
        reconcileRenderTarget()
        applyCursorVisibility()
    }

    override func animateOneFrame() {
        super.animateOneFrame()
        guard renderingActive, renderTargetActive else { return }
        renderSession?.drawFrame()
    }

    override func stopAnimation() {
        renderingActive = false
        renderTargetActive = false
        renderState.lastFrameUptime = nil
        refreshTimer?.invalidate()
        refreshTimer = nil
        restoreCursorVisibility()
        super.stopAnimation()
    }

    private func createMetalViewIfNeeded() {
        guard renderSession == nil,
              let session = PearWallRenderSession(
                  frame: bounds,
                  settings: settings,
                  state: renderState,
                  resourceBundle: Bundle(for: PearWallScreenSaverView.self)
              ) else {
            return
        }
        if let configurationDetailsLabel {
            addSubview(session.view, positioned: .below, relativeTo: configurationDetailsLabel)
        } else {
            addSubview(session.view)
        }
        renderSession = session
    }

    private func destroyMetalView() {
        renderSession?.view.removeFromSuperview()
        renderSession = nil
    }

    private func reconcileRenderTarget() {
        let shouldRender = previewMode || isCurrentScreenSelected()
        configurationDetailsLabel?.isHidden = !shouldRender || !settings.showConfigurationDetails
        guard shouldRender != renderTargetActive || (shouldRender && renderSession == nil) else {
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
        guard !screens.isEmpty else {
            return false
        }
        guard let currentScreen = window?.screen,
              let currentDisplayID = Self.displayID(for: currentScreen) else {
            return screens.count == 1
        }
        if let selectedDisplayIDs = settings.screenSaverDisplayIds {
            return selectedDisplayIDs.contains(currentDisplayID.stringValue)
        }
        let primaryScreen = screens.first(where: {
            $0.frame.origin == .zero
        }) ?? screens[0]
        let primaryDisplayID = Self.displayID(for: primaryScreen)
        let secondaryScreen = screens.first(where: {
            Self.displayID(for: $0) != primaryDisplayID
        })
        let targetScreen: NSScreen
        switch settings.screenSaverDisplay {
        case .primary:
            targetScreen = primaryScreen
        case .secondary:
            targetScreen = secondaryScreen ?? primaryScreen
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
            self?.reconcileRenderTarget()
            self?.refreshArtwork()
        }
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    private func loadSettingsJSON() -> String {
        if let shared = PearWallSettingsStore.readShared() {
            lastSettingsSignature = shared.signature
            return shared.json
        }
        if let legacy = screenSaverDefaults?.string(forKey: Self.settingsKey),
           PearWallSettingsStore.isSettingsJSON(legacy) {
            return legacy
        }
        return "{}"
    }

    private func refreshSharedSettings() {
        guard let url = PearWallSettingsStore.sharedURL,
              let signature = PearWallSettingsStore.fileSignature(for: url),
              signature != lastSettingsSignature else {
            return
        }
        guard let data = try? Data(contentsOf: url),
              let json = String(data: data, encoding: .utf8),
              PearWallSettingsStore.isSettingsJSON(json) else {
            return
        }
        lastSettingsSignature = signature
        settings = PearWallSettings(json: json)
        renderSession?.updateSettings(settings)
        reconcileRenderTarget()
        applyCursorVisibility()
        updateConfigurationDetails()
        refreshArtwork()
    }

    private func refreshArtwork() {
        guard renderTargetActive, let renderSession else { return }
        defer { updateConfigurationDetails() }
        renderSession.refreshArtwork(screen: window?.screen)
    }

    private func configureConfigurationDetailsLabel() {
        let label = NSTextField(wrappingLabelWithString: "")
        label.isEditable = false
        label.isSelectable = false
        label.isBordered = true
        label.drawsBackground = true
        label.backgroundColor = .controlBackgroundColor
        label.textColor = .labelColor
        label.font = .monospacedSystemFont(
            ofSize: NSFont.smallSystemFontSize,
            weight: .regular
        )
        label.maximumNumberOfLines = 0
        label.setContentHuggingPriority(.required, for: .vertical)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        let minimumHeight = ceil(
            (label.font?.boundingRectForFont.height ?? NSFont.smallSystemFontSize) * 8
        )
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: topAnchor, constant: 16),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            label.heightAnchor.constraint(greaterThanOrEqualToConstant: minimumHeight),
        ])
        label.isHidden = !settings.showConfigurationDetails
        configurationDetailsLabel = label
        updateConfigurationDetails()
    }

    private func updateConfigurationDetails() {
        let portrait = bounds.height >= bounds.width
        let preset = portrait ? settings.portraitPreset : settings.landscapePreset
        let presetCount = portrait ? 4 : 5
        let speed: String
        switch settings.flowSpeed.uppercased() {
        case "SLOW":
            speed = "舒缓"
        case "FAST":
            speed = "活跃"
        default:
            speed = "标准"
        }
        let moruStyle: String
        switch settings.moruStyle.uppercased() {
        case "NARROW":
            moruStyle = "窄纹"
        case "WIDE":
            moruStyle = "宽纹"
        case "SMOOTH":
            moruStyle = "平滑"
        default:
            moruStyle = "关闭"
        }
        let blur = settings.blurEnabled
            ? String(format: "开启 · %.1f×", settings.blurMultiplier)
            : "关闭"
        let presetValue = settings.randomPreset
            ? "随机"
            : "\(preset + 1)/\(presetCount)"
        configurationDetailsLabel?.stringValue = """
        当前配置
        画面：\(portrait ? "竖屏" : "横屏") · 预设 \(presetValue)
        渲染比例：\(Int((settings.renderScale * 100).rounded()))%
        模糊：\(blur)
        遮罩：\(Int((settings.scrimAlpha * 100).rounded()))%
        流动：\(speed) · \(renderState.playbackPlaying ? "运行中" : "已暂停")
        音频响应：\(settings.audioVisualization ? String(format: "开启 · %.1f×", settings.audioIntensity) : "关闭")
        光栅玻璃：\(moruStyle)
        """
        configurationDetailsLabel?.invalidateIntrinsicContentSize()
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
