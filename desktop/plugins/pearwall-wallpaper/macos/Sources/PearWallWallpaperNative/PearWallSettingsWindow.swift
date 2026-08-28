import AppKit
import Combine
import CoreGraphics
import Foundation
import SwiftUI
import UniformTypeIdentifiers
import WebKit

private struct PearWallLegacyGlassView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .withinWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

private struct PearWallGlassCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        if #available(macOS 26.0, *) {
            content
                .clipShape(shape)
                .glassEffect(
                    .regular.tint(.black.opacity(0.16)),
                    in: shape
                )
        } else {
            content
                .background(PearWallLegacyGlassView())
                .clipShape(shape)
                .overlay {
                    shape.stroke(.white.opacity(0.14), lineWidth: 1)
                }
        }
    }
}

private struct PearWallSettingsCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        PearWallGlassCard {
            VStack(spacing: 0) {
                content
            }
        }
    }
}

private struct PearWallDivider: View {
    var body: some View {
        Divider()
            .overlay(.white.opacity(0.15))
            .padding(.leading, 48)
            .padding(.trailing, 8)
    }
}

private struct PearWallSettingRow<Accessory: View>: View {
    let icon: String
    let title: String
    let description: String?
    let badge: String?
    private let accessory: Accessory

    init(
        icon: String,
        title: String,
        description: String? = nil,
        badge: String? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.icon = icon
        self.title = title
        self.description = description
        self.badge = badge
        self.accessory = accessory()
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(.white.opacity(0.9))
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    if let badge {
                        Text(badge)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.white.opacity(0.15), in: Capsule())
                    }
                }
                if let description {
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.65))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            accessory
                .fixedSize()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 72)
    }
}

private struct PearWallSectionTitle: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 16)
    }
}

private struct PearWallToggle: View {
    @Binding var value: Bool
    var disabled = false

    var body: some View {
        Toggle("", isOn: $value)
            .labelsHidden()
            .toggleStyle(.switch)
            .controlSize(.large)
            .tint(.green)
            .disabled(disabled)
    }
}

private struct PearWallRangeSetting: View {
    let icon: String
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(width: 20)
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                Text("\(Int((value * 100).rounded()))%")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
            }
            Slider(value: $value, in: range, step: step)
                .tint(.white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }
}

private struct PearWallChoiceTabs<Value: Hashable>: View {
    let icon: String
    let title: String
    @Binding var value: Value
    let options: [(Value, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(width: 20)
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
            }
            Picker(title, selection: $value) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    Text(option.1).tag(option.0)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .tint(.white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }
}

struct PearWallDisplayInfo: Identifiable, Hashable {
    let id: String
    let name: String
    let width: Int
    let height: Int
    let positionX: CGFloat
    let positionY: CGFloat
    let physicalWidthMm: CGFloat?
    let physicalHeightMm: CGFloat?
    let scaleFactor: CGFloat
    let isBuiltin: Bool
    let isPrimary: Bool

    var displayName: String {
        name.hasPrefix("Monitor #") ? "显示器 \(id)" : name
    }

    var aspectRatio: String {
        let ratio = Double(width) / Double(max(height, 1))
        let common: [(Int, Int)] = [(16, 9), (16, 10), (3, 2), (4, 3), (21, 9), (32, 9)]
        if let value = common.first(where: { abs(ratio - Double($0.0) / Double($0.1)) < 0.015 }) {
            return "\(value.0):\(value.1)"
        }
        return String(format: "%.2f:1", ratio)
    }

    var physicalSize: String? {
        guard let width = physicalWidthMm, let height = physicalHeightMm,
              width > 0, height > 0 else { return nil }
        return String(format: "%.1f 英寸", hypot(width, height) / 25.4)
    }

    var density: String {
        if scaleFactor > 1 {
            return "\(isBuiltin ? "Retina" : "HiDPI") \(String(format: "%.1f", scaleFactor))×"
        }
        return "标准分辨率 1×"
    }

    static func all() -> [PearWallDisplayInfo] {
        let primaryID = CGMainDisplayID()
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        return NSScreen.screens.compactMap { screen in
            guard let number = screen.deviceDescription[key] as? NSNumber else { return nil }
            let displayID = number.uint32Value
            let size = CGDisplayScreenSize(displayID)
            return PearWallDisplayInfo(
                id: number.stringValue,
                name: screen.localizedName,
                width: CGDisplayPixelsWide(displayID),
                height: CGDisplayPixelsHigh(displayID),
                positionX: screen.frame.origin.x,
                positionY: screen.frame.origin.y,
                physicalWidthMm: size.width > 0 ? size.width : nil,
                physicalHeightMm: size.height > 0 ? size.height : nil,
                scaleFactor: screen.backingScaleFactor,
                isBuiltin: CGDisplayIsBuiltin(displayID) != 0,
                isPrimary: displayID == primaryID
            )
        }
    }
}

private enum PearWallExportError: LocalizedError {
    case unavailable
    case invalidImage
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "实时画面尚未准备好，请稍后重试"
        case .invalidImage:
            return "无法生成 PNG 图片"
        case .saveFailed:
            return "无法保存导出图片"
        }
    }
}

private final class PearWallExportEngine: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private var ready = false

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        let url = Bundle.main.url(
            forResource: "index",
            withExtension: "html",
            subdirectory: "frontend"
        ) ?? Bundle.main.url(forResource: "index", withExtension: "html")
        if let url {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    func render(
        settings: PearWallSettings,
        options: [String: Any],
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.render(settings: settings, options: options, completion: completion)
            }
            return
        }
        guard ready,
              let settingsMessage = Self.javascriptLiteral([
                  "type": "pearwall:settings",
                  "settings": settings.jsonObject,
              ]),
              let optionsMessage = Self.javascriptLiteral(options) else {
            completion(.failure(PearWallExportError.unavailable))
            return
        }

        webView.evaluateJavaScript(
            "window.postMessage(\(settingsMessage), '*');"
        ) { [weak self] _, error in
            guard let self else { return }
            guard error == nil else {
                completion(.failure(error!))
                return
            }
            self.webView.evaluateJavaScript(
                "typeof window.PearWallExportImage === 'function' ? window.PearWallExportImage(\(optionsMessage)) : null;"
            ) { result, error in
                if let error {
                    completion(.failure(error))
                    return
                }
                guard let dataURL = result as? String else {
                    completion(.failure(PearWallExportError.invalidImage))
                    return
                }
                completion(.success(dataURL))
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
    }

    private static func javascriptLiteral(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }
}

final class PearWallSettingsModel: ObservableObject {
    @Published var settings: PearWallSettings
    @Published private(set) var displays: [PearWallDisplayInfo] = []
    @Published private(set) var displayLoading = true
    @Published private(set) var displayDiscoveryFailed = false
    @Published private(set) var wallpaperRunning = false
    @Published private(set) var wallpaperDisplayCount = 0
    @Published var errorMessage = ""
    private let exportEngine = PearWallExportEngine()

    init() {
        if let shared = PearWallSettingsStore.readShared() {
            settings = PearWallSettings(json: shared.json)
        } else {
            settings = PearWallSettings()
        }
        refreshDisplays()
        refreshWallpaperStatus()
    }

    var selectedDynamicDisplayIDs: [String] {
        settings.dynamicWallpaperDisplayIds ?? displays.map(\.id)
    }

    var selectedScreenSaverDisplayIDs: [String] {
        if let selected = settings.screenSaverDisplayIds {
            return selected
        }
        return displays.first(where: \.isPrimary).map { [$0.id] } ?? []
    }

    var customArtworkImage: NSImage? {
        guard settings.artworkFallback == .custom,
              !settings.customArtwork.isEmpty else { return nil }
        return PearWallArtworkLoader.image(from: settings.customArtwork)
    }

    func update(_ change: (inout PearWallSettings) -> Void) {
        var next = settings
        change(&next)
        settings = next
        persist()
    }

    func refreshDisplays() {
        displayLoading = true
        let nextDisplays = PearWallDisplayInfo.all()
        displays = nextDisplays
        displayDiscoveryFailed = nextDisplays.isEmpty
            && !NSScreen.screens.isEmpty
        displayLoading = false
    }

    func refreshWallpaperStatus() {
        let controller = PearWallWallpaperController.shared
        wallpaperRunning = controller.running
        wallpaperDisplayCount = controller.displayCount
    }

    func setDynamicWallpaperEnabled(_ enabled: Bool) {
        update { $0.dynamicWallpaperEnabled = enabled }
        if enabled {
            let result = PearWallWallpaperController.shared.start()
            if result != 0 {
                update { $0.dynamicWallpaperEnabled = false }
                errorMessage = "无法启动动态壁纸"
            }
        } else {
            PearWallWallpaperController.shared.stop()
            errorMessage = ""
        }
        refreshWallpaperStatus()
    }

    func toggleDynamicDisplay(_ id: String, enabled: Bool) {
        var selected = selectedDynamicDisplayIDs
        if enabled {
            selected.append(id)
        } else {
            selected.removeAll { $0 == id }
        }
        selected = Array(NSOrderedSet(array: selected)) as? [String] ?? selected
        guard !selected.isEmpty else { return }
        update { $0.dynamicWallpaperDisplayIds = selected }
        if wallpaperRunning {
            _ = PearWallWallpaperController.shared.start()
            refreshWallpaperStatus()
        }
    }

    func toggleScreenSaverDisplay(_ id: String, enabled: Bool) {
        var selected = selectedScreenSaverDisplayIDs
        if enabled {
            selected.append(id)
        } else {
            selected.removeAll { $0 == id }
        }
        selected = Array(NSOrderedSet(array: selected)) as? [String] ?? selected
        update { $0.screenSaverDisplayIds = selected }
    }

    func chooseArtwork() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url,
              let data = try? Data(contentsOf: url) else { return }
        let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
            ?? "image/png"
        update {
            $0.artworkFallback = .custom
            $0.customArtwork = "data:\(mimeType);base64,\(data.base64EncodedString())"
            $0.customArtworkName = url.lastPathComponent
        }
    }

    func restoreArtwork() {
        update {
            $0.artworkFallback = .defaultArtwork
            $0.customArtwork = ""
            $0.customArtworkName = ""
        }
    }

    func restoreDefaults() {
        if wallpaperRunning {
            PearWallWallpaperController.shared.stop()
        }
        settings = PearWallSettings()
        persist()
        refreshWallpaperStatus()
    }

    func exportImage(
        width: Int,
        height: Int,
        distortionPreset: Int,
        distortionStrength: Double,
        distortionProgress: Double,
        blurMultiplier: Double,
        scrimAlpha: Double,
        watermark: Bool,
        watermarkBackground: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        var options: [String: Any] = [
            "width": width,
            "height": height,
            "distortionPreset": distortionPreset,
            "distortionStrength": distortionStrength,
            "distortionProgress": distortionProgress,
            "blurMultiplier": blurMultiplier,
            "scrimAlpha": scrimAlpha,
            "watermark": watermark,
            "watermarkBackground": watermarkBackground,
        ]
        if let artwork = PearWallMediaArtworkCache.current() {
            options["songArtwork"] = artwork.source
        }
        exportEngine.render(settings: settings, options: options) { result in
            switch result {
            case .failure:
                completion(.failure(PearWallExportError.invalidImage))
            case .success(let dataURL):
                guard let separator = dataURL.firstIndex(of: ","),
                      let data = Data(
                          base64Encoded: String(dataURL[dataURL.index(after: separator)...]),
                          options: .ignoreUnknownCharacters
                      ) else {
                    completion(.failure(PearWallExportError.invalidImage))
                    return
                }
                do {
                    let picturesDirectory = FileManager.default.urls(
                        for: .picturesDirectory,
                        in: .userDomainMask
                    ).first ?? FileManager.default.homeDirectoryForCurrentUser
                        .appendingPathComponent("Pictures", isDirectory: true)
                    let directory = picturesDirectory.appendingPathComponent(
                        "Pear Wall",
                        isDirectory: true
                    )
                    try FileManager.default.createDirectory(
                        at: directory,
                        withIntermediateDirectories: true
                    )
                    let fileURL = directory.appendingPathComponent(
                        "Pear-Wall-\(width)x\(height)-\(Int(Date().timeIntervalSince1970)).png"
                    )
                    try data.write(to: fileURL, options: .atomic)
                    completion(.success("图片已保存至 \(fileURL.path)"))
                } catch {
                    completion(.failure(PearWallExportError.saveFailed))
                }
            }
        }
    }

    private func persist() {
        switch PearWallSettingsStore.writeShared(settings) {
        case .success:
            if errorMessage == "设置保存失败" {
                errorMessage = ""
            }
        case .failure:
            errorMessage = "设置保存失败"
        }
    }
}

private struct PearWallPreviewView: NSViewRepresentable {
    @ObservedObject var model: PearWallSettingsModel

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        let container = NSView(frame: .zero)
        guard let session = PearWallRenderSession(
            frame: .zero,
            settings: model.settings,
            state: context.coordinator.state,
            resourceBundle: .main
        ) else {
            return container
        }
        session.view.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(session.view)
        NSLayoutConstraint.activate([
            session.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            session.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            session.view.topAnchor.constraint(equalTo: container.topAnchor),
            session.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        context.coordinator.session = session
        context.coordinator.start()
        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.session?.updateSettings(model.settings)
        context.coordinator.session?.refreshArtwork(screen: nsView.window?.screen)
    }

    final class Coordinator {
        let state = PearWallRenderState()
        var session: PearWallRenderSession?
        private var frameTimer: Timer?

        func start() {
            state.lastFrameUptime = ProcessInfo.processInfo.systemUptime
            let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                self?.session?.drawFrame()
            }
            RunLoop.main.add(timer, forMode: .common)
            frameTimer = timer
            session?.refreshArtwork(screen: nil)
        }

        deinit {
            frameTimer?.invalidate()
        }
    }
}

private enum PearWallDrawer: String, Identifiable {
    case advanced
    case dynamicWallpaperDisplays
    case screenSaverDisplays
    case exportImage
    case licenses

    var id: String { rawValue }

    var title: String {
        switch self {
        case .advanced: return "高级设置"
        case .dynamicWallpaperDisplays: return "动态壁纸显示器"
        case .screenSaverDisplays: return "屏保显示器"
        case .exportImage: return "导出图片"
        case .licenses: return "开源许可"
        }
    }
}

struct PearWallSettingsView: View {
    @ObservedObject var model: PearWallSettingsModel
    @State private var drawer: PearWallDrawer?
    @State private var permissionNotice = false
    @State private var contentVisible = true

    var body: some View {
        ZStack {
            PearWallPreviewView(model: model)
                .ignoresSafeArea()
            Color.black.opacity(0.22)
                .ignoresSafeArea()
            if contentVisible {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        artworkSection
                        pauseSection
                        playbackSection
                        effectsSection
                        navigationSection
                        moreSection
                        Button("恢复默认设置") {
                            model.restoreDefaults()
                        }
                        .buttonStyle(.bordered)
                        .tint(.white.opacity(0.75))
                        .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: 480)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 24)
                }
                .scrollIndicators(.hidden)
            }
        }
        .preferredColorScheme(.dark)
        .sheet(item: $drawer) { page in
            PearWallDrawerView(page: page, model: model)
                .frame(minWidth: 440, minHeight: 420)
        }
        .sheet(isPresented: $permissionNotice) {
            PearWallPermissionView {
                permissionNotice = false
            }
            .frame(width: 440)
        }
        .onReceive(Timer.publish(every: 2, on: .main, in: .common).autoconnect()) { _ in
            model.refreshDisplays()
            model.refreshWallpaperStatus()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEnterFullScreenNotification)) { _ in
            contentVisible = false
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didExitFullScreenNotification)) { _ in
            contentVisible = true
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Pear Wall")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(.white.opacity(0.9))
            Button {
                NSApp.keyWindow?.toggleFullScreen(nil)
            } label: {
                Label("进入纯享模式", systemImage: "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
            .buttonStyle(.borderedProminent)
            .tint(.white.opacity(0.82))
            .foregroundStyle(.black)
        }
        .padding(.top, 110)
    }

    private var artworkSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            PearWallSectionTitle(title: "未获取到封面时")
            PearWallSettingsCard {
                artworkChoice(
                    icon: "photo",
                    title: "使用默认封面",
                    description: nil,
                    selected: model.settings.artworkFallback == .defaultArtwork
                ) {
                    model.restoreArtwork()
                }
                PearWallDivider()
                artworkChoice(
                    icon: "desktopcomputer",
                    title: "使用桌面壁纸",
                    description: "直接提取当前系统桌面壁纸",
                    selected: model.settings.artworkFallback == .desktop
                ) {
                    model.update {
                        $0.artworkFallback = .desktop
                        $0.customArtwork = ""
                        $0.customArtworkName = ""
                    }
                }
                PearWallDivider()
                artworkChoice(
                    icon: "square.and.arrow.up",
                    title: "使用自选图片",
                    description: "选择本地图片作为备用封面",
                    selected: model.settings.artworkFallback == .custom
                ) {
                    model.chooseArtwork()
                }
                if let image = model.customArtworkImage {
                    HStack(spacing: 8) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 56, height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.settings.customArtworkName.isEmpty ? "自选图片" : model.settings.customArtworkName)
                                .font(.system(size: 14))
                                .foregroundStyle(.white.opacity(0.85))
                                .lineLimit(1)
                            Button("重新选择") {
                                model.chooseArtwork()
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(.white.opacity(0.75))
                        }
                        Spacer()
                    }
                    .padding(.leading, 48)
                    .padding(.trailing, 16)
                    .padding(.bottom, 12)
                    Button("恢复默认封面") {
                        model.restoreArtwork()
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.white.opacity(0.75))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                }
            }
        }
    }

    private func artworkChoice(
        icon: String,
        title: String,
        description: String?,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            PearWallSettingRow(icon: icon, title: title, description: description) {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var pauseSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            PearWallSectionTitle(title: "暂停时")
            PearWallSettingsCard {
                PearWallSettingRow(
                    icon: "pause.fill",
                    title: "暂停流动效果",
                    description: "暂停播放后冻结动画，恢复播放时继续"
                ) {
                    PearWallToggle(value: Binding(
                        get: { model.settings.pauseFlow },
                        set: { value in model.update { settings in settings.pauseFlow = value } }
                    ))
                }
            }
        }
    }

    private var playbackSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            PearWallSectionTitle(title: "纯享、屏保与壁纸")
            PearWallSettingsCard {
                PearWallSettingRow(
                    icon: "desktopcomputer",
                    title: "动态壁纸",
                    description: model.wallpaperRunning
                        ? "已在 \(model.wallpaperDisplayCount) 台显示器上运行"
                        : (model.errorMessage.isEmpty ? "在桌面图标下方显示当前流动画面" : model.errorMessage)
                ) {
                    PearWallToggle(
                        value: Binding(
                            get: { model.wallpaperRunning },
                            set: { model.setDynamicWallpaperEnabled($0) }
                        )
                    )
                }
                PearWallDivider()
                navigationRow(
                    icon: "desktopcomputer",
                    title: "动态壁纸显示器",
                    description: "选择显示动态壁纸的显示器"
                ) {
                    drawer = .dynamicWallpaperDisplays
                }
                PearWallDivider()
                PearWallSettingRow(
                    icon: "cursorarrow",
                    title: "隐藏鼠标指针",
                    description: "纯享模式及屏幕保护程序运行时隐藏"
                ) {
                    PearWallToggle(value: Binding(
                        get: { model.settings.hideCursor },
                        set: { value in model.update { settings in settings.hideCursor = value } }
                    ))
                }
                PearWallDivider()
                navigationRow(
                    icon: "display",
                    title: "屏保显示器",
                    description: "选择显示动态屏保画面的显示器"
                ) {
                    drawer = .screenSaverDisplays
                }
            }
        }
    }

    private var effectsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            PearWallSectionTitle(title: "画面效果")
            PearWallSettingsCard {
                PearWallSettingRow(
                    icon: "waveform",
                    title: "开启音频可视化",
                    description: "画面会跟随正在播放的声音律动",
                    badge: "实验性"
                ) {
                    PearWallToggle(value: Binding(
                        get: { model.settings.audioVisualization },
                        set: { value in
                            model.update { settings in settings.audioVisualization = value }
                            if value { permissionNotice = true }
                        }
                    ))
                }
                if model.settings.audioVisualization {
                    PearWallDivider()
                    PearWallRangeSetting(
                        icon: "waveform.path.ecg",
                        title: "音频律动强度",
                        value: Binding(
                            get: { model.settings.audioIntensity },
                            set: { value in model.update { settings in settings.audioIntensity = value } }
                        ),
                        range: 0.5...3,
                        step: 0.1
                    )
                }
                PearWallDivider()
                PearWallSettingRow(
                    icon: "wand.and.stars",
                    title: "背景模糊",
                    description: "柔化封面细节并突出流动层次"
                ) {
                    PearWallToggle(value: Binding(
                        get: { model.settings.blurEnabled },
                        set: { value in model.update { settings in settings.blurEnabled = value } }
                    ))
                }
                if model.settings.blurEnabled {
                    PearWallDivider()
                    PearWallRangeSetting(
                        icon: "drop",
                        title: "模糊强度",
                        value: Binding(
                            get: { model.settings.blurMultiplier },
                            set: { value in model.update { settings in settings.blurMultiplier = value } }
                        ),
                        range: 0...2,
                        step: 0.05
                    )
                }
                PearWallDivider()
                PearWallRangeSetting(
                    icon: "circle.lefthalf.filled",
                    title: "画面遮罩",
                    value: Binding(
                        get: { model.settings.scrimAlpha },
                        set: { value in model.update { settings in settings.scrimAlpha = value } }
                    ),
                    range: 0...0.8,
                    step: 0.05
                )
                PearWallDivider()
                PearWallChoiceTabs(
                    icon: "play.fill",
                    title: "流动速度",
                    value: Binding(
                        get: { model.settings.flowSpeed },
                        set: { value in model.update { settings in settings.flowSpeed = value } }
                    ),
                    options: [("SLOW", "舒缓"), ("NORMAL", "标准"), ("FAST", "活跃")]
                )
                PearWallDivider()
                PearWallChoiceTabs(
                    icon: "sparkles",
                    title: "光栅玻璃",
                    value: Binding(
                        get: { model.settings.moruStyle },
                        set: { value in model.update { settings in settings.moruStyle = value } }
                    ),
                    options: [("OFF", "关闭"), ("NARROW", "细腻"), ("WIDE", "宽阔"), ("SMOOTH", "柔和")]
                )
            }
        }
    }

    private var navigationSection: some View {
        PearWallSettingsCard {
            navigationRow(
                icon: "slider.horizontal.3",
                title: "高级设置",
                description: "调整渲染质量、屏幕方向方案和屏保选项"
            ) {
                drawer = .advanced
            }
            PearWallDivider()
            navigationRow(
                icon: "square.and.arrow.down",
                title: "导出图片",
                description: "自定义画面参数并导出 PNG 图片"
            ) {
                drawer = .exportImage
            }
        }
    }

    private var moreSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            PearWallSectionTitle(title: "更多")
            PearWallSettingsCard {
                PearWallSettingRow(icon: "circle.hexagongrid", title: "Pear Wall", description: "版本 0.1.2") {}
                PearWallDivider()
                externalRow(name: "Nevoit", description: "原 Compose 项目开发者", url: "https://github.com/Nevodev")
                PearWallDivider()
                externalRow(name: "Aurysian", description: "主要开发者", url: "https://github.com/aurysian-yan")
                PearWallDivider()
                externalRow(name: "WXRIW", description: "特别感谢", url: "https://github.com/WXRIW")
                PearWallDivider()
                externalRow(name: "Raspberry Monster", description: "特别感谢", url: "https://github.com/raspberry-monster")
                PearWallDivider()
                navigationRow(
                    icon: "doc.text",
                    title: "开源许可",
                    description: "查看 Pear Wall 使用的开源许可"
                ) {
                    drawer = .licenses
                }
            }
        }
    }

    private func navigationRow(
        icon: String,
        title: String,
        description: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            PearWallSettingRow(icon: icon, title: title, description: description) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .buttonStyle(.plain)
    }

    private func externalRow(name: String, description: String, url: String) -> some View {
        Button {
            if let link = URL(string: url) {
                NSWorkspace.shared.open(link)
            }
        } label: {
            PearWallSettingRow(icon: "pawprint.fill", title: name, description: description) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .buttonStyle(.plain)
    }
}

private struct PearWallDrawerView: View {
    let page: PearWallDrawer
    @ObservedObject var model: PearWallSettingsModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.opacity(0.3).ignoresSafeArea()
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 18, weight: .semibold))
                                .frame(width: 36, height: 36)
                        }
                        .buttonStyle(.bordered)
                        Text(page.title)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.white)
                        Spacer()
                    }
                    .padding(.top, 20)

                    switch page {
                    case .advanced:
                        advancedContent
                    case .dynamicWallpaperDisplays:
                        displayContent(title: "动态壁纸显示器", screenSaver: false)
                    case .screenSaverDisplays:
                        displayContent(title: "屏保显示器", screenSaver: true)
                    case .exportImage:
                        PearWallExportContent(model: model)
                    case .licenses:
                        licensesContent
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
        }
        .preferredColorScheme(.dark)
    }

    private var advancedContent: some View {
        PearWallSettingsCard {
            PearWallChoiceTabs(
                icon: "gauge.with.dots.needle.67percent",
                title: "渲染质量",
                value: Binding(
                    get: { model.settings.renderScale },
                    set: { value in model.update { settings in settings.renderScale = value } }
                ),
                options: [(0.5, "省电"), (0.75, "均衡"), (1.0, "清晰")]
            )
            PearWallDivider()
            PearWallChoiceTabs(
                icon: "iphone",
                title: "竖屏方案",
                value: Binding(
                    get: { model.settings.portraitPreset },
                    set: { value in model.update { settings in settings.portraitPreset = value } }
                ),
                options: [(0, "方案 1"), (1, "方案 2"), (2, "方案 3"), (3, "方案 4")]
            )
            PearWallDivider()
            PearWallChoiceTabs(
                icon: "display",
                title: "横屏方案",
                value: Binding(
                    get: { model.settings.landscapePreset },
                    set: { value in model.update { settings in settings.landscapePreset = value } }
                ),
                options: [(0, "方案 1"), (1, "方案 2"), (2, "方案 3"), (3, "方案 4"), (4, "方案 5")]
            )
            PearWallDivider()
            PearWallSettingRow(
                icon: "shuffle",
                title: "随机切换",
                description: "根据屏幕方向随机选择流动方案"
            ) {
                PearWallToggle(value: Binding(
                    get: { model.settings.randomPreset },
                    set: { value in model.update { settings in settings.randomPreset = value } }
                ))
            }
            PearWallDivider()
            PearWallSettingRow(
                icon: "info.circle",
                title: "显示配置详情",
                description: "在屏幕保护程序中显示当前画面参数"
            ) {
                PearWallToggle(value: Binding(
                    get: { model.settings.showConfigurationDetails },
                    set: { value in model.update { settings in settings.showConfigurationDetails = value } }
                ))
            }
        }
    }

    private func displayContent(title: String, screenSaver: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(screenSaver
                ? "选择显示动态屏保画面的显示器，未启用的显示器将保持纯黑。"
                : "选择用于显示动态壁纸的显示器。"
            )
            .font(.system(size: 12))
            .foregroundStyle(.white.opacity(0.65))
            PearWallSettingsCard {
                ForEach(Array(model.displays.enumerated()), id: \.element.id) { index, display in
                    if index > 0 {
                        PearWallDivider()
                    }
                    let selected = screenSaver
                        ? model.selectedScreenSaverDisplayIDs.contains(display.id)
                        : model.selectedDynamicDisplayIDs.contains(display.id)
                    Toggle(isOn: Binding(
                        get: { selected },
                        set: {
                            if screenSaver {
                                model.toggleScreenSaverDisplay(display.id, enabled: $0)
                            } else {
                                model.toggleDynamicDisplay(display.id, enabled: $0)
                            }
                        }
                    )) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(display.displayName)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.white)
                                if display.isPrimary {
                                    Text("主屏幕")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(.white.opacity(0.7))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(.white.opacity(0.15), in: Capsule())
                                }
                            }
                            Text([
                                "\(display.width) × \(display.height)",
                                display.aspectRatio,
                                display.physicalSize,
                                display.density,
                            ].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.6))
                        }
                    }
                    .toggleStyle(.switch)
                    .controlSize(.large)
                    .tint(.green)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(minHeight: 72)
                }
                if model.displays.isEmpty {
                    Text(model.displayLoading ? "正在识别已连接的显示器" : "暂时无法读取显示器信息")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.6))
                        .frame(maxWidth: .infinity, minHeight: 72)
                }
            }
        }
    }

    private var licensesContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pear Wall macOS 使用以下系统框架：")
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.65))
            PearWallSettingsCard {
                ForEach(Array(["SwiftUI", "AppKit", "Metal", "WebKit"].enumerated()), id: \.element) { index, dependency in
                    if index > 0 {
                        PearWallDivider()
                    }
                    HStack {
                        Text(dependency)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                        Spacer()
                        Text("系统组件")
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.65))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                }
            }
        }
    }
}

private struct PearWallExportContent: View {
    @ObservedObject var model: PearWallSettingsModel
    @State private var resolution = "2560x1440"
    @State private var width = 2560
    @State private var height = 1440
    @State private var distortionPreset = 0
    @State private var distortionStrength = 1.0
    @State private var distortionProgress = 0.5
    @State private var blurMultiplier = 1.0
    @State private var scrimAlpha = 0.4
    @State private var watermark = false
    @State private var watermarkBackground = "WHITE"
    @State private var exporting = false
    @State private var message = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("调整当前封面的画面参数，并导出指定分辨率的 PNG 图片。")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.65))

            PearWallSettingsCard {
                PearWallChoiceTabs(
                    icon: "rectangle.3.group",
                    title: "导出分辨率",
                    value: Binding(
                        get: { resolution },
                        set: { selectResolution($0) }
                    ),
                    options: [
                        ("1920x1080", "1080p"),
                        ("2560x1440", "2K"),
                        ("3840x2160", "4K"),
                        ("custom", "自定义"),
                    ]
                )
                PearWallDivider()
                HStack(spacing: 12) {
                    TextField("宽度", value: $width, format: .number)
                        .textFieldStyle(.roundedBorder)
                    TextField("高度", value: $height, format: .number)
                        .textFieldStyle(.roundedBorder)
                }
                .padding(16)
                PearWallDivider()
                PearWallChoiceTabs(
                    icon: "wand.and.stars",
                    title: "封面扭曲方案",
                    value: $distortionPreset,
                    options: [(0, "方案 1"), (1, "方案 2"), (2, "方案 3"), (3, "方案 4"), (4, "方案 5")]
                )
                PearWallDivider()
                PearWallRangeSetting(
                    icon: "arrow.up.left.and.arrow.down.right",
                    title: "扭曲强度",
                    value: $distortionStrength,
                    range: 0...1.5,
                    step: 0.05
                )
                PearWallDivider()
                PearWallRangeSetting(
                    icon: "play.fill",
                    title: "扭曲位置",
                    value: $distortionProgress,
                    range: 0...1,
                    step: 0.01
                )
                PearWallDivider()
                PearWallRangeSetting(
                    icon: "drop",
                    title: "导出模糊强度",
                    value: $blurMultiplier,
                    range: 0...2,
                    step: 0.05
                )
                PearWallDivider()
                PearWallRangeSetting(
                    icon: "circle.lefthalf.filled",
                    title: "导出画面遮罩",
                    value: $scrimAlpha,
                    range: 0...0.8,
                    step: 0.05
                )
                PearWallDivider()
                PearWallSettingRow(
                    icon: "photo",
                    title: "添加歌曲水印",
                    description: "在画面下方追加 Logo 与歌曲信息"
                ) {
                    PearWallToggle(value: $watermark)
                }
                if watermark {
                    PearWallDivider()
                    PearWallChoiceTabs(
                        icon: "circle.lefthalf.filled",
                        title: "水印背景",
                        value: $watermarkBackground,
                        options: [
                            ("WHITE", "白色"),
                            ("BLACK", "黑色"),
                            ("BLUR_WHITE", "白色模糊"),
                            ("BLUR_BLACK", "黑色模糊"),
                        ]
                    )
                }
            }

            Button {
                exporting = true
                message = ""
                model.exportImage(
                    width: max(320, min(4096, width)),
                    height: max(320, min(4096, height)),
                    distortionPreset: distortionPreset,
                    distortionStrength: distortionStrength,
                    distortionProgress: distortionProgress,
                    blurMultiplier: blurMultiplier,
                    scrimAlpha: scrimAlpha,
                    watermark: watermark,
                    watermarkBackground: watermarkBackground
                ) { result in
                    exporting = false
                    switch result {
                    case .success(let value):
                        message = value
                    case .failure(let error):
                        message = error.localizedDescription
                    }
                }
            } label: {
                Label(
                    exporting ? "正在导出…" : "导出 PNG 图片",
                    systemImage: "square.and.arrow.down"
                )
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(.white.opacity(0.82))
            .foregroundStyle(.black)
            .disabled(exporting)

            if !message.isEmpty {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.7))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func selectResolution(_ value: String) {
        resolution = value
        guard value != "custom" else { return }
        let values = value.split(separator: "x").compactMap { Int($0) }
        guard values.count == 2 else { return }
        width = values[0]
        height = values[1]
    }
}

private struct PearWallPermissionView: View {
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("音频可视化需要系统权限", systemImage: "waveform")
                .font(.system(size: 18, weight: .semibold))
            Text("为了让画面跟随当前播放的声音律动，macOS 要求 Pear Wall 获得系统音频录制权限。该权限由 macOS 归类在“屏幕与系统音频录制”中，但 Pear Wall 不会读取屏幕画面，也不会保存音频内容。")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("授予权限后需要彻底重启应用。")
                .font(.system(size: 13, weight: .semibold))
            Button("我知道了", action: dismiss)
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(24)
    }
}

final class PearWallSettingsWindowController: NSObject, NSWindowDelegate {
    static let shared = PearWallSettingsWindowController()

    private var window: NSWindow?
    private var model: PearWallSettingsModel?

    func show() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.show()
            }
            return
        }
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let model = PearWallSettingsModel()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Pear Wall 设置"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 440, height: 560)
        window.collectionBehavior = [.moveToActiveSpace]
        window.contentView = NSHostingView(rootView: PearWallSettingsView(model: model))
        window.delegate = self
        window.center()
        self.model = model
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func hide() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.hide()
            }
            return
        }
        window?.orderOut(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }
}
