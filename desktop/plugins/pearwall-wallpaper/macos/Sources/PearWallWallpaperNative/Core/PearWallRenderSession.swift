import AppKit
import Foundation
import MetalKit
import SwiftUI

final class PearWallRenderState {
    var playbackPlaying = true
    var animationTime: TimeInterval = 0
    var lastFrameUptime: TimeInterval?
}

final class PearWallRenderSession {
    static let missingArtworkConfirmationInterval: TimeInterval = 2.5

    let view: NSView
    private let metalView: MTKView
    private let renderer: PearWallMetalRenderer
    private let device: MTLDevice
    private let resourceBundle: Bundle
    private let state: PearWallRenderState
    private let runtimeStateReader = PearWallRuntimeStateReader()
    private let lyricsSource = PearWallLyricsSource()
    private let lyricsModel = PearWallLyricsOverlayModel()
    private var settings: PearWallSettings
    private var displayID: String?
    private var lastArtworkKey = ""
    private var missingArtworkSince: Date?
    private var smoothedAudioPulse = 0.0
    private var lastAudioPulseUptime: TimeInterval?
    private var lastPerformanceCheckUptime: TimeInterval?

    init?(
        frame: NSRect,
        settings: PearWallSettings,
        state: PearWallRenderState,
        resourceBundle: Bundle,
        displayID: String?
    ) {
        guard let device = MTLCreateSystemDefaultDevice() else {
            return nil
        }
        let container = NSView(frame: frame)
        container.autoresizingMask = [.width, .height]
        container.wantsLayer = true
        let metalView = MTKView(frame: container.bounds, device: device)
        metalView.autoresizingMask = [.width, .height]
        metalView.colorPixelFormat = .bgra8Unorm
        metalView.framebufferOnly = true
        metalView.isPaused = true
        metalView.enableSetNeedsDisplay = false
        metalView.clearColor = MTLClearColorMake(0, 0, 0, 1)
        guard let renderer = try? PearWallMetalRenderer(
            view: metalView,
            resourceBundle: resourceBundle
        ) else {
            return nil
        }
        container.addSubview(metalView)
        let lyricsView = PearWallTransparentHostingView(
            rootView: PearWallMeloXLyricsView(model: lyricsModel)
        )
        lyricsView.frame = container.bounds
        lyricsView.autoresizingMask = [.width, .height]
        lyricsView.wantsLayer = true
        lyricsView.layer?.backgroundColor = NSColor.clear.cgColor
        container.addSubview(lyricsView)
        self.view = container
        self.metalView = metalView
        self.renderer = renderer
        self.device = device
        self.resourceBundle = resourceBundle
        self.state = state
        self.settings = settings
        self.displayID = displayID
        lyricsModel.updateProfile(settings.lyricsPresentationProfile(displayID: displayID))
        renderer.setConfiguration(settings.metalConfiguration(device: device))
        if settings.performanceMode.uppercased() == "AUTO" {
            lastPerformanceCheckUptime = ProcessInfo.processInfo.systemUptime
        }
    }

    func updateSettings(_ settings: PearWallSettings) {
        self.settings = settings
        lyricsModel.updateProfile(settings.lyricsPresentationProfile(displayID: displayID))
        lastPerformanceCheckUptime = nil
        if settings.performanceMode.uppercased() == "AUTO" {
            refreshPerformance(force: true)
        } else {
            renderer.setConfiguration(settings.metalConfiguration(device: device))
        }
    }

    func updateDisplayID(_ displayID: String?) {
        self.displayID = displayID
        lyricsModel.updateProfile(settings.lyricsPresentationProfile(displayID: displayID))
    }

    func refreshPerformance(force: Bool = false) {
        guard settings.performanceMode.uppercased() == "AUTO" else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if !force,
           let lastPerformanceCheckUptime,
           now - lastPerformanceCheckUptime < 60 {
            return
        }
        lastPerformanceCheckUptime = now
        let power = PearWallPerformance.powerStatus()
        let quality = PearWallPerformance.quality(
            tier: PearWallPerformance.hardwareTier(for: device),
            power: power,
            batterySaverMax: settings.autoBatterySaverMax,
            batteryBalancedMax: settings.autoBatteryBalancedMax
        )
        renderer.setConfiguration(settings.metalConfiguration(
            device: device,
            qualityOverride: quality
        ))
    }

    func drawFrame() {
        let now = ProcessInfo.processInfo.systemUptime
        let delta = min(0.1, max(0, now - (state.lastFrameUptime ?? now)))
        state.lastFrameUptime = now
        if !settings.pauseFlow || state.playbackPlaying {
            state.animationTime += delta * settings.flowSpeedMultiplier
        }
        let snapshot = runtimeStateReader.currentSnapshot()
        lyricsModel.updateRuntime(snapshot)
        renderer.animationTime = Float(state.animationTime)
        let pulse = settings.audioVisualization && state.playbackPlaying
            ? snapshot?.pulse ?? 0
            : 0
        let pulseDelta = min(
            0.1,
            max(0, now - (lastAudioPulseUptime ?? now - 1.0 / 60.0))
        )
        let targetPulse = PearWallAudioVisualization.clampedPulse(Double(pulse))
        let response = targetPulse > smoothedAudioPulse ? 0.08 : 0.2
        let amount = 1 - exp(-pulseDelta / response)
        smoothedAudioPulse += (targetPulse - smoothedAudioPulse) * amount
        lastAudioPulseUptime = now
        renderer.audioPulse = Float(smoothedAudioPulse)
        metalView.draw()
    }

    func refreshArtwork(screen: NSScreen?) {
        let media = PearWallMediaArtworkCache.current()
        lyricsModel.updateMedia(media)
        lyricsModel.updateLyrics(lyricsSource.current())
        if let artwork = media {
            state.playbackPlaying = artwork.playing
            if !artwork.source.isEmpty,
               applyArtwork(source: artwork.source, key: "media:\(artwork.key)") {
                missingArtworkSince = nil
                return
            }
        } else {
            state.playbackPlaying = true
        }
        if lastArtworkKey.hasPrefix("media:") {
            if !state.playbackPlaying {
                missingArtworkSince = nil
                return
            }
            let now = Date()
            if let missingArtworkSince {
                if now.timeIntervalSince(missingArtworkSince)
                    < Self.missingArtworkConfirmationInterval {
                    return
                }
            } else {
                missingArtworkSince = now
                return
            }
        }
        missingArtworkSince = nil
        switch settings.artworkFallback {
        case .custom where !settings.customArtwork.isEmpty:
            if applyArtwork(
                source: settings.customArtwork,
                key: "custom:\(settings.customArtwork.hashValue)"
            ) {
                return
            }
        case .desktop:
            if let screen = screen ?? NSScreen.screens.first,
               let url = NSWorkspace.shared.desktopImageURL(for: screen),
               applyArtwork(source: url.absoluteString, key: "desktop:\(url.path)") {
                return
            }
        default:
            break
        }
        guard let url = resourceBundle.url(
            forResource: "default_artwork",
            withExtension: "svg",
            subdirectory: "assets"
        ) else {
            return
        }
        _ = applyArtwork(source: url.absoluteString, key: "default")
    }

    private func applyArtwork(source: String, key: String) -> Bool {
        if key == lastArtworkKey {
            return true
        }
        guard let image = PearWallArtworkLoader.image(from: source),
              renderer.setArtwork(image) else {
            return false
        }
        lastArtworkKey = key
        return true
    }
}
