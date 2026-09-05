import Darwin
import Foundation
import Metal
import ApplicationServices

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

func pearWallDisplayIdentifier(_ displayID: CGDirectDisplayID) -> String {
    guard let unmanagedUUID = CGDisplayCreateUUIDFromDisplayID(displayID) else {
        return String(displayID)
    }
    let uuid = unmanagedUUID.takeRetainedValue()
    guard let value = CFUUIDCreateString(nil, uuid) else {
        return String(displayID)
    }
    return value as String
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

enum PearWallLyricsFontSizeMode: String {
    case meloXAuto = "MELOX_AUTO"
    case custom = "CUSTOM"
}

enum PearWallLyricsFontWeight: String {
    case regular = "REGULAR"
    case medium = "MEDIUM"
    case semibold = "SEMIBOLD"
    case bold = "BOLD"
    case heavy = "HEAVY"
}

enum PearWallLyricsTextAlignment: String {
    case meloX = "MELOX"
    case left = "LEFT"
    case center = "CENTER"
    case right = "RIGHT"
}

enum PearWallTrackInfoAlignment: String {
    case followLyrics = "FOLLOW_LYRICS"
    case left = "LEFT"
    case center = "CENTER"
    case right = "RIGHT"
}

enum PearWallTrackInfoLayout: String {
    case horizontal = "HORIZONTAL"
    case vertical = "VERTICAL"
}

struct PearWallTrackInfoSettings {
    var enabled = true
    var showArtwork = true
    var showTitle = true
    var showArtist = true
    var showAlbum = true
    var layout = PearWallTrackInfoLayout.horizontal
    var alignment = PearWallTrackInfoAlignment.followLyrics
    var scale = 1.0
    var artworkSize = 72.0
    var titleFontSize = 18.0
    var titleFontWeight = PearWallLyricsFontWeight.bold
    var secondaryFontSize = 14.0
    var secondaryFontWeight = PearWallLyricsFontWeight.medium

    init() {}

    init(object: [String: Any]?, fallback: PearWallTrackInfoSettings) {
        self = fallback
        guard let object else { return }
        enabled = Self.boolean(object, key: "enabled", fallback: enabled)
        showArtwork = Self.boolean(object, key: "showArtwork", fallback: showArtwork)
        showTitle = Self.boolean(object, key: "showTitle", fallback: showTitle)
        showArtist = Self.boolean(object, key: "showArtist", fallback: showArtist)
        showAlbum = Self.boolean(object, key: "showAlbum", fallback: showAlbum)
        layout = PearWallTrackInfoLayout(
            rawValue: Self.string(object, key: "layout", fallback: layout.rawValue)
        ) ?? layout
        alignment = PearWallTrackInfoAlignment(
            rawValue: Self.string(object, key: "alignment", fallback: alignment.rawValue)
        ) ?? alignment
        scale = Self.number(object, key: "scale", fallback: scale, range: 0.6...1.6)
        artworkSize = Self.number(object, key: "artworkSize", fallback: artworkSize, range: 40...160)
        titleFontSize = Self.number(object, key: "titleFontSize", fallback: titleFontSize, range: 12...48)
        titleFontWeight = PearWallLyricsFontWeight(
            rawValue: Self.string(object, key: "titleFontWeight", fallback: titleFontWeight.rawValue)
        ) ?? titleFontWeight
        secondaryFontSize = Self.number(
            object,
            key: "secondaryFontSize",
            fallback: secondaryFontSize,
            range: 10...36
        )
        secondaryFontWeight = PearWallLyricsFontWeight(
            rawValue: Self.string(
                object,
                key: "secondaryFontWeight",
                fallback: secondaryFontWeight.rawValue
            )
        ) ?? secondaryFontWeight
    }

    private static func boolean(_ object: [String: Any], key: String, fallback: Bool) -> Bool {
        (object[key] as? NSNumber)?.boolValue ?? fallback
    }

    private static func string(_ object: [String: Any], key: String, fallback: String) -> String {
        object[key] as? String ?? fallback
    }

    private static func number(
        _ object: [String: Any],
        key: String,
        fallback: Double,
        range: ClosedRange<Double>
    ) -> Double {
        guard let value = (object[key] as? NSNumber)?.doubleValue,
              value.isFinite else {
            return fallback
        }
        return min(range.upperBound, max(range.lowerBound, value))
    }
}

struct PearWallLyricsPresentationProfile {
    var enabled = false
    var showLyrics = true
    var fontSizeMode = PearWallLyricsFontSizeMode.meloXAuto
    var fontSize = 50.0
    var fontWeight = PearWallLyricsFontWeight.bold
    var alignment = PearWallLyricsTextAlignment.meloX
    var progressiveBlur = true
    var trackInfo = PearWallTrackInfoSettings()

    init() {}

    init(object: [String: Any]?, fallback: PearWallLyricsPresentationProfile) {
        self = fallback
        guard let object else { return }
        enabled = Self.boolean(object, key: "enabled", fallback: enabled)
        showLyrics = Self.boolean(object, key: "showLyrics", fallback: showLyrics)
        fontSizeMode = PearWallLyricsFontSizeMode(
            rawValue: Self.string(object, key: "fontSizeMode", fallback: fontSizeMode.rawValue)
        ) ?? fontSizeMode
        fontSize = Self.number(object, key: "fontSize", fallback: fontSize, range: 18...120)
        fontWeight = PearWallLyricsFontWeight(
            rawValue: Self.string(object, key: "fontWeight", fallback: fontWeight.rawValue)
        ) ?? fontWeight
        alignment = PearWallLyricsTextAlignment(
            rawValue: Self.string(object, key: "alignment", fallback: alignment.rawValue)
        ) ?? alignment
        progressiveBlur = Self.boolean(
            object,
            key: "progressiveBlur",
            fallback: progressiveBlur
        )
        trackInfo = PearWallTrackInfoSettings(
            object: object["trackInfo"] as? [String: Any],
            fallback: trackInfo
        )
    }

    private static func boolean(_ object: [String: Any], key: String, fallback: Bool) -> Bool {
        (object[key] as? NSNumber)?.boolValue ?? fallback
    }

    private static func string(_ object: [String: Any], key: String, fallback: String) -> String {
        object[key] as? String ?? fallback
    }

    private static func number(
        _ object: [String: Any],
        key: String,
        fallback: Double,
        range: ClosedRange<Double>
    ) -> Double {
        guard let value = (object[key] as? NSNumber)?.doubleValue,
              value.isFinite else {
            return fallback
        }
        return min(range.upperBound, max(range.lowerBound, value))
    }
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
    var lyricsPresentationDefault = PearWallLyricsPresentationProfile()
    var lyricsPresentationDisplayOverrides: [String: PearWallLyricsPresentationProfile] = [:]

    func lyricsPresentationProfile(displayID: String?) -> PearWallLyricsPresentationProfile {
        guard let displayID,
              let override = lyricsPresentationDisplayOverrides[displayID] else {
            return lyricsPresentationDefault
        }
        return override
    }

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
        if let presentation = object["lyricsPresentation"] as? [String: Any] {
            lyricsPresentationDefault = PearWallLyricsPresentationProfile(
                object: presentation["defaultProfile"] as? [String: Any],
                fallback: lyricsPresentationDefault
            )
            if let overrides = presentation["displayOverrides"] as? [String: Any] {
                lyricsPresentationDisplayOverrides = overrides.reduce(into: [:]) { result, entry in
                    guard let value = entry.value as? [String: Any] else { return }
                    result[entry.key] = PearWallLyricsPresentationProfile(
                        object: value,
                        fallback: lyricsPresentationDefault
                    )
                }
            }
        }
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
