import Foundation

nonisolated struct LyricPhysicalSpringParameters: Equatable, Sendable {
    let mass: Double
    let stiffness: Double
    let damping: Double

    init(mass: Double, stiffness: Double, damping: Double) {
        self.mass = Self.positiveFinite(mass, fallback: 1)
        self.stiffness = Self.positiveFinite(stiffness, fallback: 1)
        self.damping = Self.nonnegativeFinite(damping, fallback: 0)
    }

    private static func positiveFinite(
        _ value: Double,
        fallback: Double
    ) -> Double {
        value.isFinite && value > 0 ? value : fallback
    }

    private static func nonnegativeFinite(
        _ value: Double,
        fallback: Double
    ) -> Double {
        value.isFinite && value >= 0 ? value : fallback
    }
}

