import Foundation
import IOKit.ps
import Metal

enum PearWallAutoQuality: String {
    case powerSaving = "POWER_SAVING"
    case balanced = "BALANCED"
    case clear = "CLEAR"
}

struct PearWallPowerStatus {
    let batteryPercent: Int?
    let onBattery: Bool?
    let lowPowerMode: Bool
}

enum PearWallPerformance {
    private static let gigabyte = 1024.0 * 1024.0 * 1024.0
    private static let batterySaverMax = 20
    private static let batteryBalancedMax = 60

    static func hardwareTier(for device: MTLDevice) -> String {
        let workingSet = Double(device.recommendedMaxWorkingSetSize)
        if workingSet > 0, workingSet < 6 * gigabyte {
            return "LOW"
        }
        if workingSet >= 12 * gigabyte {
            return "HIGH"
        }
        return "BALANCED"
    }

    static func powerStatus() -> PearWallPowerStatus {
        let lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        let info = IOPSCopyPowerSourcesInfo().takeRetainedValue()
        let sources = IOPSCopyPowerSourcesList(info).takeRetainedValue() as NSArray
        var batteryPercent: Int?
        var onBattery: Bool?

        for source in sources {
            guard let description = IOPSGetPowerSourceDescription(
                info,
                source as CFTypeRef
            )?.takeUnretainedValue() as? [String: Any] else {
                continue
            }
            let current = (description["Current Capacity"] as? NSNumber)?.intValue
            let maximum = (description["Max Capacity"] as? NSNumber)?.intValue
            if batteryPercent == nil, let current, let maximum, maximum > 0 {
                batteryPercent = min(100, max(0, Int((Double(current) / Double(maximum) * 100).rounded())))
            }
            if let state = description["Power Source State"] as? String {
                onBattery = state == "Battery Power"
            }
        }

        return PearWallPowerStatus(
            batteryPercent: batteryPercent,
            onBattery: onBattery,
            lowPowerMode: lowPowerMode
        )
    }

    static func quality(
        tier: String,
        power: PearWallPowerStatus,
        batterySaverMax: Int = Self.batterySaverMax,
        batteryBalancedMax: Int = Self.batteryBalancedMax
    ) -> PearWallAutoQuality {
        let saverMax = min(98, max(1, batterySaverMax))
        let balancedMax = min(99, max(saverMax + 1, batteryBalancedMax))
        let forcedPowerSaving = power.lowPowerMode || tier == "LOW"
        if forcedPowerSaving {
            return .powerSaving
        }
        if let batteryPercent = power.batteryPercent {
            if batteryPercent < saverMax {
                return .powerSaving
            }
            if batteryPercent < balancedMax {
                return .balanced
            }
            return .clear
        }
        if power.onBattery == false, tier == "HIGH" {
            return .clear
        }
        return .balanced
    }

    static func maximumRenderScale(for quality: PearWallAutoQuality) -> Double {
        switch quality {
        case .powerSaving:
            return 0.5
        case .balanced:
            return 0.75
        case .clear:
            return 1
        }
    }
}
