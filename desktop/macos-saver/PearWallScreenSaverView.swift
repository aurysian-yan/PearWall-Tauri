import AppKit
import Darwin
import Foundation
import ScreenSaver
import WebKit

@objc(PearWallScreenSaverView)
final class PearWallScreenSaverView: ScreenSaverView, WKNavigationDelegate {
    private var webView: WKWebView?
    private var artworkTimer: Timer?
    private var lastSentArtworkKey = ""
    private var lastSentDesktopWallpaperPath = ""
    private var previewMode = false
    private let mediaRemote = MediaRemoteBridge()

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        previewMode = isPreview
        animationTimeInterval = 1.0 / 60.0

        let configuration = WKWebViewConfiguration()
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
        artworkTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.refreshArtwork()
            self?.refreshDesktopWallpaper()
        }
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func startAnimation() {
        super.startAnimation()
    }

    override func animateOneFrame() {
        super.animateOneFrame()
    }

    override func stopAnimation() {
        artworkTimer?.invalidate()
        artworkTimer = nil
        webView?.stopLoading()
        super.stopAnimation()
    }

    override var hasConfigureSheet: Bool {
        false
    }

    private func refreshArtwork() {
        mediaRemote.fetchNowPlaying { [weak self] artwork in
            guard let self else { return }
            let key = artwork?.key ?? ""
            let dataURL = artwork?.dataURL ?? ""
            guard key != self.lastSentArtworkKey else { return }
            guard let webView = self.webView else { return }
            let keyJSON = Self.javascriptString(key)
            let dataJSON = Self.javascriptString(dataURL)
            webView.evaluateJavaScript(
                "window.PearWallSetArtwork && window.PearWallSetArtwork(\(keyJSON), \(dataJSON));",
            ) { [weak self] _, error in
                if error == nil {
                    self?.lastSentArtworkKey = key
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !previewMode {
            webView.evaluateJavaScript(
                "window.PearWallSetScreenSaverMode && window.PearWallSetScreenSaverMode(true);",
            )
        }
        refreshArtwork()
        refreshDesktopWallpaper()
    }

    private func refreshDesktopWallpaper() {
        guard let screen = NSScreen.main,
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
            "window.PearWallSetDesktopArtwork && window.PearWallSetDesktopArtwork(\(dataJSON));",
        ) { [weak self] _, error in
            if error == nil {
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

private struct MediaArtwork {
    let key: String
    let dataURL: String
}

private final class MediaRemoteBridge {
    private typealias NowPlayingCallback = @convention(block) (NSDictionary?) -> Void
    private typealias GetNowPlayingInfo = @convention(c) (DispatchQueue, @escaping NowPlayingCallback) -> Void

    private let handle: UnsafeMutableRawPointer?
    private let getNowPlayingInfo: GetNowPlayingInfo?

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
    }

    deinit {
        if let handle {
            dlclose(handle)
        }
    }

    func fetchNowPlaying(completion: @escaping (MediaArtwork?) -> Void) {
        guard let getNowPlayingInfo else {
            completion(nil)
            return
        }
        getNowPlayingInfo(.main) { info in
            DispatchQueue.main.async {
                completion(Self.artwork(from: info))
            }
        }
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
