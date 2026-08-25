import Darwin
import Foundation

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

struct PearWallSettings {
    var audioVisualization = true
    var audioIntensity = 1.0
    var pauseFlow = true
    var hideCursor = true
    var screenSaverDisplay = PearWallScreenSaverDisplay.primary
    var screenSaverDisplayIds: [String]?
    var showConfigurationDetails = true
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

    var metalConfiguration: PearWallMetalConfiguration {
        PearWallMetalConfiguration(
            audioIntensity: audioIntensity,
            renderScale: renderScale,
            blurEnabled: blurEnabled,
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
        audioIntensity = min(
            3,
            max(0.5, Self.number(object, key: "audioIntensity", fallback: audioIntensity))
        )
        pauseFlow = Self.boolean(object, key: "pauseFlow", fallback: pauseFlow)
        hideCursor = Self.boolean(object, key: "hideCursor", fallback: hideCursor)
        showConfigurationDetails = Self.boolean(
            object,
            key: "showConfigurationDetails",
            fallback: showConfigurationDetails
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
