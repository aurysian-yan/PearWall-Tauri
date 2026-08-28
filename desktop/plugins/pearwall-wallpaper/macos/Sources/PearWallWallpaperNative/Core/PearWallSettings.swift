import Darwin
import Foundation
import Metal

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

enum PearWallScreenSaverDisplay: String {
    case primary = "PRIMARY"
    case secondary = "SECONDARY"
}

enum PearWallArtworkFallback: String {
    case defaultArtwork = "DEFAULT"
    case custom = "CUSTOM"
    case desktop = "DESKTOP"
}

enum PearWallAudioVisualization {
    static let minimumPulse = 0.0
    static let maximumPulse = 1.0
    static let minimumIntensity = 0.5
    static let maximumIntensity = 3.0
    static let imagePulseIntensity = 0.08

    static func clampedPulse(_ value: Double) -> Double {
        guard value.isFinite else { return minimumPulse }
        return min(maximumPulse, max(minimumPulse, value))
    }

    static func clampedIntensity(_ value: Double) -> Double {
        guard value.isFinite else { return minimumIntensity }
        return min(maximumIntensity, max(minimumIntensity, value))
    }
}

struct PearWallSettings {
    var dynamicWallpaperDisplayIds: [String]?
    var audioVisualization = true
    var audioIntensity = 1.0
    var pauseFlow = true
    var hideCursor = true
    var screenSaverDisplay = PearWallScreenSaverDisplay.primary
    var screenSaverDisplayIds: [String]?
    var showConfigurationDetails = true
    var performanceMode = "MANUAL"
    var autoBatterySaverMax = 20
    var autoBatteryBalancedMax = 60
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

    var flowSpeedMultiplier: Double {
        switch flowSpeed.uppercased() {
        case "SLOW":
            return 0.5
        case "FAST":
            return 2
        default:
            return 1
        }
    }

    func metalConfiguration(
        device: MTLDevice,
        qualityOverride: PearWallAutoQuality? = nil
    ) -> PearWallMetalConfiguration {
        let rawRenderScale = min(1, max(0.25, renderScale))
        let quality: PearWallAutoQuality?
        if performanceMode.uppercased() == "AUTO" {
            quality = qualityOverride ?? PearWallPerformance.quality(
                tier: PearWallPerformance.hardwareTier(for: device),
                power: PearWallPerformance.powerStatus(),
                batterySaverMax: autoBatterySaverMax,
                batteryBalancedMax: autoBatteryBalancedMax
            )
        } else {
            quality = nil
        }
        let effectiveRenderScale = quality.map {
            PearWallPerformance.maximumRenderScale(for: $0)
        } ?? rawRenderScale
        let effectiveBlurEnabled = quality == .powerSaving ? false : blurEnabled
        return PearWallMetalConfiguration(
            audioIntensity: audioIntensity,
            renderScale: effectiveRenderScale,
            blurEnabled: effectiveBlurEnabled,
            blurMultiplier: blurMultiplier,
            scrimAlpha: scrimAlpha,
            portraitPreset: portraitPreset,
            landscapePreset: landscapePreset,
            randomPreset: randomPreset,
            moruStyle: moruStyle
        )
    }

    init(json: String = "{}") {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        audioVisualization = Self.boolean(object, key: "audioVisualization", fallback: audioVisualization)
        audioIntensity = PearWallAudioVisualization.clampedIntensity(
            Self.number(object, key: "audioIntensity", fallback: audioIntensity)
        )
        pauseFlow = Self.boolean(object, key: "pauseFlow", fallback: pauseFlow)
        hideCursor = Self.boolean(object, key: "hideCursor", fallback: hideCursor)
        showConfigurationDetails = Self.boolean(
            object,
            key: "showConfigurationDetails",
            fallback: showConfigurationDetails
        )
        performanceMode = Self.string(object, key: "performanceMode", fallback: performanceMode)
            .uppercased() == "AUTO" ? "AUTO" : "MANUAL"
        let legacyBatterySaverMax = Self.integer(object, key: "autoBatterySaverThreshold", fallback: autoBatterySaverMax)
        autoBatterySaverMax = min(
            98,
            max(1, Self.integer(object, key: "autoBatterySaverMax", fallback: legacyBatterySaverMax))
        )
        autoBatteryBalancedMax = min(
            99,
            max(
                autoBatterySaverMax + 1,
                Self.integer(object, key: "autoBatteryBalancedMax", fallback: autoBatteryBalancedMax)
            )
        )
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
        if let values = object["dynamicWallpaperDisplayIds"] as? [String] {
            dynamicWallpaperDisplayIds = values
        }
        if let value = PearWallScreenSaverDisplay(
            rawValue: Self.string(object, key: "screenSaverDisplay", fallback: "PRIMARY")
        ) {
            screenSaverDisplay = value
        }
        if let values = object["screenSaverDisplayIds"] as? [String] {
            screenSaverDisplayIds = values
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

struct PearWallFileSignature: Equatable {
    let modificationDate: Date
    let size: UInt64
    let fileNumber: UInt64
}

enum PearWallSettingsStore {
    static var sharedURL: URL? {
        pearWallApplicationSupportDirectory()?
            .appendingPathComponent("settings.json")
    }

    static func readShared() -> (json: String, signature: PearWallFileSignature?)? {
        guard let url = sharedURL,
              let data = try? Data(contentsOf: url),
              let json = String(data: data, encoding: .utf8),
              isSettingsJSON(json) else {
            return nil
        }
        return (json, fileSignature(for: url))
    }

    static func fileSignature(for url: URL) -> PearWallFileSignature? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        guard let modificationDate = attributes?[.modificationDate] as? Date else {
            return nil
        }
        return PearWallFileSignature(
            modificationDate: modificationDate,
            size: (attributes?[.size] as? NSNumber)?.uint64Value ?? 0,
            fileNumber: (attributes?[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
        )
    }

    static func isSettingsJSON(_ value: String) -> Bool {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) else {
            return false
        }
        return object is [String: Any]
    }
}
