import AppKit
import Foundation
import MetalKit

final class PearWallRenderState {
    var playbackPlaying = true
    var animationTime: TimeInterval = 0
    var lastFrameUptime: TimeInterval?
}

final class PearWallRenderSession {
    static let missingArtworkConfirmationInterval: TimeInterval = 2.5

    let view: MTKView
    private let renderer: PearWallMetalRenderer
    private let resourceBundle: Bundle
    private let state: PearWallRenderState
    private let runtimeStateReader = PearWallRuntimeStateReader()
    private var settings: PearWallSettings
    private var lastArtworkKey = ""
    private var missingArtworkSince: Date?
    private var smoothedAudioPulse = 0.0
    private var lastAudioPulseUptime: TimeInterval?

    init?(
        frame: NSRect,
        settings: PearWallSettings,
        state: PearWallRenderState,
        resourceBundle: Bundle
    ) {
        guard let device = MTLCreateSystemDefaultDevice() else {
            return nil
        }
        let view = MTKView(frame: frame, device: device)
        view.autoresizingMask = [.width, .height]
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.isPaused = true
        view.enableSetNeedsDisplay = false
        view.clearColor = MTLClearColorMake(0, 0, 0, 1)
        guard let renderer = try? PearWallMetalRenderer(
            view: view,
            resourceBundle: resourceBundle
        ) else {
            return nil
        }
        self.view = view
        self.renderer = renderer
        self.resourceBundle = resourceBundle
        self.state = state
        self.settings = settings
        renderer.setConfiguration(settings.metalConfiguration)
    }

    func updateSettings(_ settings: PearWallSettings) {
        self.settings = settings
        renderer.setConfiguration(settings.metalConfiguration)
    }

    func drawFrame() {
        let now = ProcessInfo.processInfo.systemUptime
        let delta = min(0.1, max(0, now - (state.lastFrameUptime ?? now)))
        state.lastFrameUptime = now
        if !settings.pauseFlow || state.playbackPlaying {
            state.animationTime += delta * settings.flowSpeedMultiplier
        }
        let snapshot = runtimeStateReader.currentSnapshot()
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
        view.draw()
    }

    func refreshArtwork(screen: NSScreen?) {
        if let artwork = PearWallMediaArtworkCache.current() {
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
