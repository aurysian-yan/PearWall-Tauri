import CoreGraphics

nonisolated struct AppleMusicLyricsTypographyProfile: Equatable, Sendable {
    let compactFontSize: CGFloat
    let regularFontSize: CGFloat
    let mediumFontSize: CGFloat
    let largeFontSize: CGFloat
    let extraLargeFontSize: CGFloat

    func primaryFontSize(
        for viewportWidth: CGFloat,
        prettyMode: Bool = true
    ) -> CGFloat {
        guard prettyMode, viewportWidth >= 300 else {
            return compactFontSize
        }
        switch viewportWidth {
        case ..<528:
            return regularFontSize
        case ..<672:
            return mediumFontSize
        case ..<760:
            return largeFontSize
        default:
            return extraLargeFontSize
        }
    }

    static let macOS26_6 = Self(
        compactFontSize: 24,
        regularFontSize: 28,
        mediumFontSize: 38,
        largeFontSize: 50,
        extraLargeFontSize: 72
    )
}

