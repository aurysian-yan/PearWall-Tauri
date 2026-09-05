import Foundation

nonisolated enum AppleMusicLyricsDynamicSpring {
    private static let minimumSourceDuration: TimeInterval = 0.20
    private static let maximumSourceDuration: TimeInterval = 0.75
    private static let sourceDurationRange: TimeInterval = 0.55
    private static let maximumDampingRatio = 0.90
    private static let dampingRatioRange = 0.12
    private static let minimumPeriod: TimeInterval = 0.48
    private static let periodRange: TimeInterval = 0.27

    static func parameters(
        sourceDuration: TimeInterval
    ) -> LyricPhysicalSpringParameters {
        let cappedDuration = sourceDuration.isNaN
            ? minimumSourceDuration
            : min(sourceDuration, maximumSourceDuration)
        let progress = min(
            max(
                (cappedDuration - minimumSourceDuration)
                    / sourceDurationRange,
                0
            ),
            1
        )
        let dampingRatio = maximumDampingRatio
            - progress * dampingRatioRange
        let period = minimumPeriod + progress * periodRange
        let mass = 1.0
        let angularFrequency = 2 * Double.pi / period
        let stiffness = angularFrequency * angularFrequency
        let damping = dampingRatio * 2 * sqrt(mass * stiffness)
        return LyricPhysicalSpringParameters(
            mass: mass,
            stiffness: stiffness,
            damping: damping
        )
    }
}

