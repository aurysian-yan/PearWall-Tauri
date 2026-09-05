import Foundation

nonisolated struct AppleMusicLyricsMotionProfile: Equatable, Sendable {
    enum SelectedLinePosition: Equatable, Sendable {
        case top(Double)
        case center
    }

    let firstLineStartOffset: Double
    let selectedLinePosition: SelectedLinePosition
    let staticTopContentInset: Double
    let staticBottomContentInset: Double
    let viewportMaskTopOpaquePercent: Double
    let paragraphSpacing: Double
    let lineSpacing: Double
    let backgroundVocalsTopSpacing: Double
    let backgroundVocalsDeselectedScale: Double
    let backgroundVocalsFontCoefficient: Double
    let translationSmallFontCoefficient: Double
    let translationLargeFontCoefficient: Double
    let translationBackgroundVocalsFontCoefficient: Double
    let transliterationFontCoefficient: Double
    let transliterationBackgroundVocalsFontCoefficient: Double
    let translationSpacing: Double
    let translationBottomPadding: Double
    let transliterationLineHeightAdjustment: Double
    let transliterationMinWordSpacing: Double
    let vocalGroupWidthCoefficient: Double
    let forwardCascadeDelay: TimeInterval
    let reverseCascadeDelay: TimeInterval
    let deselectedScale: Double
    let nonFocusedBlurRadius: Double
    let maximumNonFocusedBlurRadius: Double
    let selectedTextOpacity: Double
    let selectedUpcomingTextOpacity: Double
    let deselectedTextOpacity: Double
    let focusBlurTransitionDuration: TimeInterval
    let focusBlurTransitionControlPoint1X: Double
    let focusBlurTransitionControlPoint1Y: Double
    let focusBlurTransitionControlPoint2X: Double
    let focusBlurTransitionControlPoint2Y: Double
    let animationHeadstart: TimeInterval
    let emphasisScaleRange: ClosedRange<Double>
    let lineFinishProgressAnimationDuration: TimeInterval
    let lineProgressionGradientFeather: Double
    let glowRadius: Double
    let syllableLift: Double
    let allowsDistanceBlur: Bool
    let lineChangeSpring: LyricPhysicalSpringParameters
    let forcedLineCatchUpSpring: LyricPhysicalSpringParameters
    let annotationPresentationSpring: LyricPhysicalSpringParameters
    let annotationDismissalSpring: LyricPhysicalSpringParameters
    let instrumentalBreak: AppleMusicInstrumentalBreakMotionProfile

    static let macOS26_6Standard = Self(
        firstLineStartOffset: 69.734375,
        selectedLinePosition: .top(69.734375),
        staticTopContentInset: 22,
        staticBottomContentInset: 30,
        viewportMaskTopOpaquePercent: 8,
        paragraphSpacing: 39,
        lineSpacing: 36,
        backgroundVocalsTopSpacing: 15,
        backgroundVocalsDeselectedScale: 0.9,
        backgroundVocalsFontCoefficient: 0.63,
        translationSmallFontCoefficient: 0.46,
        translationLargeFontCoefficient: 0.57,
        translationBackgroundVocalsFontCoefficient: 0.36,
        transliterationFontCoefficient: 0.46,
        transliterationBackgroundVocalsFontCoefficient: 0.27,
        translationSpacing: 7,
        translationBottomPadding: 4,
        transliterationLineHeightAdjustment: 5,
        transliterationMinWordSpacing: 5,
        vocalGroupWidthCoefficient: 0.25,
        forwardCascadeDelay: 0.02,
        reverseCascadeDelay: 0.01,
        deselectedScale: 0.98,
        nonFocusedBlurRadius: 3,
        maximumNonFocusedBlurRadius: 4,
        selectedTextOpacity: 1,
        selectedUpcomingTextOpacity: 0.5,
        deselectedTextOpacity: 0.4,
        focusBlurTransitionDuration: 0.12,
        focusBlurTransitionControlPoint1X: 0.33,
        focusBlurTransitionControlPoint1Y: 0,
        focusBlurTransitionControlPoint2X: 0.2,
        focusBlurTransitionControlPoint2Y: 0.1,
        animationHeadstart: 0.1,
        emphasisScaleRange: 1...1.14,
        lineFinishProgressAnimationDuration: 0.25,
        lineProgressionGradientFeather: 30,
        glowRadius: 5,
        syllableLift: 2,
        allowsDistanceBlur: false,
        lineChangeSpring: LyricPhysicalSpringParameters(
            mass: 1,
            stiffness: 100,
            damping: 18
        ),
        forcedLineCatchUpSpring: LyricPhysicalSpringParameters(
            mass: 2,
            stiffness: 260,
            damping: 50
        ),
        annotationPresentationSpring: LyricPhysicalSpringParameters(
            mass: 1,
            stiffness: 150,
            damping: 30
        ),
        annotationDismissalSpring: LyricPhysicalSpringParameters(
            mass: 1,
            stiffness: 130,
            damping: 30
        ),
        instrumentalBreak: .macOS26_6Standard
    )

    static let macOS26_6 = Self(
        firstLineStartOffset: 10.84765625,
        selectedLinePosition: .center,
        staticTopContentInset: 22,
        staticBottomContentInset: 30,
        viewportMaskTopOpaquePercent: 8,
        paragraphSpacing: 39,
        lineSpacing: 50,
        backgroundVocalsTopSpacing: 15,
        backgroundVocalsDeselectedScale: 0.9,
        backgroundVocalsFontCoefficient: 0.63,
        translationSmallFontCoefficient: 0.46,
        translationLargeFontCoefficient: 0.57,
        translationBackgroundVocalsFontCoefficient: 0.36,
        transliterationFontCoefficient: 0.46,
        transliterationBackgroundVocalsFontCoefficient: 0.27,
        translationSpacing: 7,
        translationBottomPadding: 4,
        transliterationLineHeightAdjustment: 5,
        transliterationMinWordSpacing: 5,
        vocalGroupWidthCoefficient: 0.25,
        forwardCascadeDelay: 0.05,
        reverseCascadeDelay: 0.025,
        deselectedScale: 0.98,
        nonFocusedBlurRadius: 3,
        maximumNonFocusedBlurRadius: 4,
        selectedTextOpacity: 1,
        selectedUpcomingTextOpacity: 0.5,
        deselectedTextOpacity: 0.4,
        focusBlurTransitionDuration: 0.28,
        focusBlurTransitionControlPoint1X: 0.2,
        focusBlurTransitionControlPoint1Y: 0,
        focusBlurTransitionControlPoint2X: 0,
        focusBlurTransitionControlPoint2Y: 1,
        animationHeadstart: 0.1,
        emphasisScaleRange: 1...1.14,
        lineFinishProgressAnimationDuration: 0.25,
        lineProgressionGradientFeather: 30,
        glowRadius: 5,
        syllableLift: 3,
        allowsDistanceBlur: true,
        lineChangeSpring: LyricPhysicalSpringParameters(
            mass: 1,
            stiffness: 100,
            damping: 18
        ),
        forcedLineCatchUpSpring: LyricPhysicalSpringParameters(
            mass: 2,
            stiffness: 260,
            damping: 50
        ),
        annotationPresentationSpring: LyricPhysicalSpringParameters(
            mass: 1,
            stiffness: 150,
            damping: 30
        ),
        annotationDismissalSpring: LyricPhysicalSpringParameters(
            mass: 1,
            stiffness: 130,
            damping: 30
        ),
        instrumentalBreak: .macOS26_6
    )

    func dynamicSpring(
        sourceDuration: TimeInterval
    ) -> LyricPhysicalSpringParameters {
        AppleMusicLyricsDynamicSpring.parameters(
            sourceDuration: sourceDuration
        )
    }
}
