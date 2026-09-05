import CoreGraphics
import Foundation

nonisolated struct AppleMusicInstrumentalBreakMotionProfile:
    Equatable,
    Sendable
{
    static let macOS26_6Standard = AppleMusicInstrumentalBreakMotionProfile(
        dotCount: 3,
        dotLength: 12,
        dotMargin: 8,
        viewHeight: 40,
        fillLeadInDuration: 1,
        fillAnimationDuration: 0.8,
        fillStagger: 0.06,
        inactiveDotOpacity: 0.1,
        cueOutLeadTime: 1.8,
        cuePeakScale: 1.2,
        cuePeakDuration: 1,
        cueFadeDuration: 0.3,
        cueTerminalScale: 0.2,
        cueTerminalScaleDuration: 0.5,
        breathLowerScale: 0.9,
        breathUpperScale: 1.2,
        breathDelay: 0.2,
        breathAnimationInset: 0.4
    )

    static let macOS26_6 = AppleMusicInstrumentalBreakMotionProfile(
        dotCount: 3,
        dotLength: 18,
        dotMargin: 11,
        viewHeight: 40,
        fillLeadInDuration: 1,
        fillAnimationDuration: 0.8,
        fillStagger: 0.06,
        inactiveDotOpacity: 0.1,
        cueOutLeadTime: 1.8,
        cuePeakScale: 1.2,
        cuePeakDuration: 1,
        cueFadeDuration: 0.3,
        cueTerminalScale: 0.2,
        cueTerminalScaleDuration: 0.5,
        breathLowerScale: 0.9,
        breathUpperScale: 1.2,
        breathDelay: 0.2,
        breathAnimationInset: 0.4
    )

    let dotCount: Int
    let dotLength: Double
    let dotMargin: Double
    let viewHeight: Double
    let fillLeadInDuration: TimeInterval
    let fillAnimationDuration: TimeInterval
    let fillStagger: TimeInterval
    let inactiveDotOpacity: Double
    let cueOutLeadTime: TimeInterval
    let cuePeakScale: Double
    let cuePeakDuration: TimeInterval
    let cueFadeDuration: TimeInterval
    let cueTerminalScale: Double
    let cueTerminalScaleDuration: TimeInterval
    let breathLowerScale: Double
    let breathUpperScale: Double
    let breathDelay: TimeInterval
    let breathAnimationInset: TimeInterval

    var contentWidth: CGFloat {
        CGFloat(dotCount) * CGFloat(dotLength)
            + CGFloat(max(dotCount - 1, 0)) * CGFloat(dotMargin)
    }

    var visualExitDuration: TimeInterval {
        max(
            cuePeakDuration + cueFadeDuration,
            cuePeakDuration + cueTerminalScaleDuration
        )
    }

    func dotAnchorX(at index: Int) -> CGFloat {
        switch index {
        case 0:
            1.8
        case dotCount - 1:
            -0.8
        default:
            0.5
        }
    }

    func timing(
        for interlude: LyricInterlude
    ) -> AppleMusicInstrumentalBreakMotionTiming {
        let startTime = interlude.startTime
        let endTime = max(interlude.countdownEndTime, startTime)
        let cueOutTime = max(startTime, endTime - cueOutLeadTime)
        let visualEndTime = min(
            endTime,
            cueOutTime + visualExitDuration
        )
        let activeDuration = max(cueOutTime - startTime, 0)
        let breathCount = max(floor(activeDuration * 0.25), 1)
        let breathHalfCycleDuration = activeDuration
            / breathCount
            * 0.5
        let fillStartTime = startTime + fillLeadInDuration
        let fillDuration = max(cueOutTime - fillStartTime, 0)
        let fillStageInterval = fillDuration / Double(max(dotCount, 1))

        return AppleMusicInstrumentalBreakMotionTiming(
            startTime: startTime,
            endTime: endTime,
            visualEndTime: visualEndTime,
            cueOutTime: cueOutTime,
            fillStartTime: fillStartTime,
            fillStageInterval: fillStageInterval,
            breathHalfCycleDuration: breathHalfCycleDuration
        )
    }
}

nonisolated struct AppleMusicInstrumentalBreakMotionTiming:
    Hashable,
    Sendable
{
    let startTime: TimeInterval
    let endTime: TimeInterval
    let visualEndTime: TimeInterval
    let cueOutTime: TimeInterval
    let fillStartTime: TimeInterval
    let fillStageInterval: TimeInterval
    let breathHalfCycleDuration: TimeInterval
}

