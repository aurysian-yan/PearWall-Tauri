import CoreGraphics
import Foundation

struct AppleMusicInterludeDotsPresentation: Equatable, Sendable {
    let dotOpacities: [Double]
    let scale: CGFloat
    let opacity: Double

    static func make(
        playbackTime: TimeInterval,
        interlude: LyricInterlude,
        profile: AppleMusicInstrumentalBreakMotionProfile,
        reducesMotion: Bool
    ) -> AppleMusicInterludeDotsPresentation {
        let timing = profile.timing(for: interlude)
        guard playbackTime.isFinite,
              playbackTime >= timing.startTime,
              playbackTime < timing.visualEndTime else {
            return hidden(profile: profile)
        }

        if reducesMotion {
            return reducedMotionPresentation(
                at: playbackTime,
                timing: timing,
                profile: profile
            )
        }

        let dotOpacities = (0..<profile.dotCount).map { dotIndex in
            fillOpacity(
                at: playbackTime,
                dotIndex: dotIndex,
                timing: timing,
                profile: profile
            )
        }
        let exitStartTime = timing.cueOutTime + profile.cuePeakDuration
        let opacity: Double
        if playbackTime < exitStartTime {
            opacity = 1
        } else {
            opacity = ScalarTransition(
                startTime: exitStartTime,
                duration: profile.cueFadeDuration,
                fromValue: 1,
                toValue: 0,
                curve: .easeIn
            ).value(at: playbackTime)
        }

        return AppleMusicInterludeDotsPresentation(
            dotOpacities: dotOpacities,
            scale: cueScale(
                at: playbackTime,
                timing: timing,
                profile: profile
            ),
            opacity: opacity
        )
    }

    private static func hidden(
        profile: AppleMusicInstrumentalBreakMotionProfile
    ) -> AppleMusicInterludeDotsPresentation {
        AppleMusicInterludeDotsPresentation(
            dotOpacities: Array(repeating: 0, count: profile.dotCount),
            scale: 1,
            opacity: 0
        )
    }

    private static func reducedMotionPresentation(
        at playbackTime: TimeInterval,
        timing: AppleMusicInstrumentalBreakMotionTiming,
        profile: AppleMusicInstrumentalBreakMotionProfile
    ) -> AppleMusicInterludeDotsPresentation {
        let exitStartTime = timing.cueOutTime + profile.cuePeakDuration
        guard playbackTime < exitStartTime else {
            return hidden(profile: profile)
        }

        let completedDotCount: Int
        if playbackTime < timing.fillStartTime {
            completedDotCount = 0
        } else if timing.fillStageInterval > 0 {
            completedDotCount = min(
                Int(
                    floor(
                        (playbackTime - timing.fillStartTime)
                            / timing.fillStageInterval
                    )
                ) + 1,
                profile.dotCount
            )
        } else {
            completedDotCount = profile.dotCount
        }
        let dotOpacities = (0..<profile.dotCount).map { index -> Double in
            if completedDotCount == 0 {
                return 0
            }
            return index < completedDotCount
                ? 1
                : profile.inactiveDotOpacity
        }
        return AppleMusicInterludeDotsPresentation(
            dotOpacities: dotOpacities,
            scale: 1,
            opacity: 1
        )
    }

    private static func fillOpacity(
        at playbackTime: TimeInterval,
        dotIndex: Int,
        timing: AppleMusicInstrumentalBreakMotionTiming,
        profile: AppleMusicInstrumentalBreakMotionProfile
    ) -> Double {
        let events = (1...profile.dotCount).map { completedCount in
            ScalarTransitionEvent(
                startTime: timing.fillStartTime
                    + Double(completedCount - 1)
                        * timing.fillStageInterval
                    + Double(dotIndex) * profile.fillStagger,
                duration: profile.fillAnimationDuration,
                targetValue: dotIndex < completedCount
                    ? 1
                    : profile.inactiveDotOpacity,
                curve: .linear
            )
        }
        return ScalarTransitionEvent.value(
            at: playbackTime,
            initialValue: 0,
            events: events
        )
    }

    private static func cueScale(
        at playbackTime: TimeInterval,
        timing: AppleMusicInstrumentalBreakMotionTiming,
        profile: AppleMusicInstrumentalBreakMotionProfile
    ) -> CGFloat {
        let scaleAtCueOut = breathScale(
            at: timing.cueOutTime,
            timing: timing,
            profile: profile
        )
        guard playbackTime >= timing.cueOutTime else {
            return breathScale(
                at: playbackTime,
                timing: timing,
                profile: profile
            )
        }

        let peakTransition = ScalarTransition(
            startTime: timing.cueOutTime,
            duration: profile.cuePeakDuration,
            fromValue: Double(scaleAtCueOut),
            toValue: profile.cuePeakScale,
            curve: .cuePeak
        )
        let terminalStartTime = timing.cueOutTime + profile.cuePeakDuration
        guard playbackTime >= terminalStartTime else {
            return CGFloat(peakTransition.value(at: playbackTime))
        }
        return CGFloat(
            ScalarTransition(
                startTime: terminalStartTime,
                duration: profile.cueTerminalScaleDuration,
                fromValue: profile.cuePeakScale,
                toValue: profile.cueTerminalScale,
                curve: .easeIn
            ).value(at: playbackTime)
        )
    }

    private static func breathScale(
        at playbackTime: TimeInterval,
        timing: AppleMusicInstrumentalBreakMotionTiming,
        profile: AppleMusicInstrumentalBreakMotionProfile
    ) -> CGFloat {
        guard timing.breathHalfCycleDuration > 0 else { return 1 }
        let phaseCount = max(
            Int(
                ceil(
                    (timing.cueOutTime - timing.startTime)
                        / timing.breathHalfCycleDuration
                )
            ),
            1
        )
        let animationDuration = max(
            timing.breathHalfCycleDuration
                - profile.breathAnimationInset,
            0
        )
        let events = (0..<phaseCount).map { phase in
            ScalarTransitionEvent(
                startTime: timing.startTime
                    + Double(phase)
                        * timing.breathHalfCycleDuration
                    + profile.breathDelay,
                duration: animationDuration,
                targetValue: phase.isMultiple(of: 2)
                    ? profile.breathUpperScale
                    : profile.breathLowerScale,
                curve: .easeOut
            )
        }
        return CGFloat(
            ScalarTransitionEvent.value(
                at: min(playbackTime, timing.cueOutTime),
                initialValue: 1,
                events: events
            )
        )
    }
}

private struct ScalarTransitionEvent {
    let startTime: TimeInterval
    let duration: TimeInterval
    let targetValue: Double
    let curve: AppleMusicInterludeTimingCurve

    static func value(
        at playbackTime: TimeInterval,
        initialValue: Double,
        events: [ScalarTransitionEvent]
    ) -> Double {
        var activeTransition: ScalarTransition?
        for event in events {
            guard playbackTime >= event.startTime else {
                return activeTransition?.value(at: playbackTime)
                    ?? initialValue
            }
            let fromValue = activeTransition?.value(at: event.startTime)
                ?? initialValue
            activeTransition = ScalarTransition(
                startTime: event.startTime,
                duration: event.duration,
                fromValue: fromValue,
                toValue: event.targetValue,
                curve: event.curve
            )
        }
        return activeTransition?.value(at: playbackTime) ?? initialValue
    }
}

private struct ScalarTransition {
    let startTime: TimeInterval
    let duration: TimeInterval
    let fromValue: Double
    let toValue: Double
    let curve: AppleMusicInterludeTimingCurve

    func value(at playbackTime: TimeInterval) -> Double {
        guard duration > 0 else { return toValue }
        let progress = min(
            max((playbackTime - startTime) / duration, 0),
            1
        )
        let curvedProgress = curve.value(at: progress)
        return fromValue + (toValue - fromValue) * curvedProgress
    }
}

private enum AppleMusicInterludeTimingCurve {
    case linear
    case easeIn
    case easeOut
    case cuePeak

    func value(at progress: Double) -> Double {
        switch self {
        case .linear:
            progress
        case .easeIn:
            CubicBezier(
                firstControlPoint: (0.42, 0),
                secondControlPoint: (1, 1)
            ).value(at: progress)
        case .easeOut:
            CubicBezier(
                firstControlPoint: (0, 0),
                secondControlPoint: (0.58, 1)
            ).value(at: progress)
        case .cuePeak:
            CubicBezier(
                firstControlPoint: (0.25, 0.1),
                secondControlPoint: (0.25, 1)
            ).value(at: progress)
        }
    }
}

private struct CubicBezier {
    let firstControlPoint: (x: Double, y: Double)
    let secondControlPoint: (x: Double, y: Double)

    func value(at progress: Double) -> Double {
        let progress = min(max(progress, 0), 1)
        guard progress > 0, progress < 1 else { return progress }

        var parameter = progress
        for _ in 0..<8 {
            let difference = component(
                at: parameter,
                first: firstControlPoint.x,
                second: secondControlPoint.x
            ) - progress
            let derivative = componentDerivative(
                at: parameter,
                first: firstControlPoint.x,
                second: secondControlPoint.x
            )
            guard abs(derivative) > 0.000_001 else { break }
            let candidate = parameter - difference / derivative
            guard candidate >= 0, candidate <= 1 else { break }
            parameter = candidate
        }

        var lowerBound = 0.0
        var upperBound = 1.0
        for _ in 0..<20 {
            let x = component(
                at: parameter,
                first: firstControlPoint.x,
                second: secondControlPoint.x
            )
            if abs(x - progress) < 0.000_001 {
                break
            }
            if x < progress {
                lowerBound = parameter
            } else {
                upperBound = parameter
            }
            parameter = (lowerBound + upperBound) * 0.5
        }

        return component(
            at: parameter,
            first: firstControlPoint.y,
            second: secondControlPoint.y
        )
    }

    private func component(
        at parameter: Double,
        first: Double,
        second: Double
    ) -> Double {
        let inverse = 1 - parameter
        return 3 * inverse * inverse * parameter * first
            + 3 * inverse * parameter * parameter * second
            + parameter * parameter * parameter
    }

    private func componentDerivative(
        at parameter: Double,
        first: Double,
        second: Double
    ) -> Double {
        let inverse = 1 - parameter
        return 3 * inverse * inverse * first
            + 6 * inverse * parameter * (second - first)
            + 3 * parameter * parameter * (1 - second)
    }
}

