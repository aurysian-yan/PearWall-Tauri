import AppKit
import Combine
import SwiftUI

final class PearWallLyricsOverlayModel: ObservableObject {
    @Published private(set) var profile = PearWallLyricsPresentationProfile()
    @Published private(set) var lines: [LyricLine] = []
    @Published private(set) var interludes: [LyricInterlude] = []
    @Published private(set) var trackID: UInt64 = 0
    @Published private(set) var playbackTime: TimeInterval = 0
    @Published private(set) var playing = false
    @Published private(set) var title = ""
    @Published private(set) var artist = ""
    @Published private(set) var album = ""
    @Published private(set) var artwork: NSImage?

    private var artworkKey = ""
    private var lyricsTrackID: UInt64 = 0

    func updateProfile(_ profile: PearWallLyricsPresentationProfile) {
        self.profile = profile
    }

    func updateMedia(_ media: PearWallMediaArtwork?) {
        guard let media else {
            title = ""
            artist = ""
            album = ""
            artwork = nil
            artworkKey = ""
            return
        }
        title = media.title
        artist = media.artist
        album = media.album
        playing = media.playing
        if artworkKey != media.key {
            artworkKey = media.key
            artwork = PearWallArtworkLoader.image(from: media.source)
        }
        if trackID == 0 {
            playbackTime = media.elapsed
        }
    }

    func updateLyrics(_ snapshot: PearWallLyricsSnapshot) {
        guard lyricsTrackID != snapshot.trackID || lines != snapshot.lines else {
            return
        }
        lyricsTrackID = snapshot.trackID
        lines = snapshot.lines
        interludes = LyricInterludeTimeline.interludes(in: snapshot.lines)
    }

    func updateRuntime(_ snapshot: PearWallRuntimeSnapshot?) {
        guard let snapshot else { return }
        trackID = snapshot.trackID
        playbackTime = snapshot.position
        playing = snapshot.playing
    }

    var visibleLines: [LyricLine] {
        guard lyricsTrackID == trackID else { return [] }
        return lines
    }

    var focusedIndex: Int? {
        let lyrics = visibleLines
        guard !lyrics.isEmpty else { return nil }
        let interludePosition = LyricInterludeTimeline.position(
            at: playbackTime,
            in: interludes
        )
        if interludePosition.focusedInterludeID != nil {
            return nil
        }
        let lyricID = interludePosition.promotedLyricID
            ?? LyricPlaybackTimeline.position(
                at: playbackTime,
                in: lyrics
            ).highlightedLyricID
            ?? lyrics.first?.id
        return lyricID.flatMap { id in
            lyrics.firstIndex(where: { $0.id == id })
        }
    }

    var focusTargetID: String? {
        guard !visibleLines.isEmpty else { return nil }
        let position = LyricInterludeTimeline.position(
            at: playbackTime,
            in: interludes
        )
        if let interludeID = position.focusedInterludeID {
            return "interlude-\(interludeID)"
        }
        return focusedIndex.map { "lyric-\($0)" }
    }

    func interlude(before lyricID: LyricLine.ID) -> LyricInterlude? {
        interludes.first(where: { $0.displayBeforeLyricID == lyricID })
    }

    func isInterludeVisible(_ interlude: LyricInterlude) -> Bool {
        guard !visibleLines.isEmpty else { return false }
        return LyricInterludeTimeline.position(
            at: playbackTime,
            in: interludes
        ).visibleInterludeID == interlude.id
    }
}

private struct PearWallLyricTimingAttribute: TextAttribute, Hashable {
    let startTime: TimeInterval
    let endTime: TimeInterval
    let syllableStartTime: TimeInterval
    let syllableEndTime: TimeInterval
    let characterIndex: Int
    let characterCount: Int
    let isWhitespace: Bool
}

private struct PearWallMeloXTextRenderer: TextRenderer {
    var playbackTime: TimeInterval
    var timingEffectsStrength: Double

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(playbackTime, timingEffectsStrength) }
        set {
            playbackTime = newValue.first
            timingEffectsStrength = newValue.second
        }
    }

    var displayPadding: EdgeInsets {
        EdgeInsets(top: 36, leading: 32, bottom: 32, trailing: 32)
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            for run in line {
                guard let timing = run[PearWallLyricTimingAttribute.self] else {
                    context.draw(run)
                    continue
                }
                draw(run, timing: timing, in: &context)
            }
        }
    }

    private func draw(
        _ run: Text.Layout.Run,
        timing: PearWallLyricTimingAttribute,
        in context: inout GraphicsContext
    ) {
        let strength = min(max(timingEffectsStrength, 0), 1)
        let bounds = run.typographicBounds.rect
        var runContext = context
        let liftProgress = smootherStep(
            (playbackTime - timing.startTime)
                / max(timing.endTime - timing.startTime + 0.32, 0.01)
        )
        let lift = -3 * CGFloat(liftProgress * strength)
        if lift != 0 {
            runContext.translateBy(x: 0, y: lift)
        }

        let duration = timing.syllableEndTime - timing.syllableStartTime
        var glowStrength = 0.0
        if duration >= 0.95 {
            let animationDuration = max(duration, 1)
            let stagger: TimeInterval = timing.characterCount > 1
                ? duration * 0.55 * Double(timing.characterIndex)
                    / Double(timing.characterCount - 1)
                : 0
            let phase = min(
                max(
                    (playbackTime - timing.syllableStartTime - stagger)
                        / animationDuration,
                    0
                ),
                1
            )
            let envelope = phase <= 0.5
                ? smootherStep(phase / 0.5)
                : 1 - smootherStep((phase - 0.5) / 0.5)
            let durationProgress = smootherStep(
                (duration - 0.95) / (2.8 - 0.95)
            )
            let expansionAmount = 0.7 + (1 - 0.7) * durationProgress
            let scale = 1
                + 0.14 * CGFloat(envelope * expansionAmount * strength)
            let characterCount = max(timing.characterCount, 1)
            let resolvedIndex = run.layoutDirection == .rightToLeft
                ? characterCount - min(max(timing.characterIndex, 0), characterCount - 1) - 1
                : min(max(timing.characterIndex, 0), characterCount - 1)
            let distanceFromCenter = Double(characterCount - 1) * 0.5
                - Double(resolvedIndex)
            let expansionIntensity = CGFloat(
                envelope * expansionAmount * strength
            )
            let horizontalOffset = -expansionIntensity
                * 0.03
                * max(bounds.height, 1)
                * CGFloat(distanceFromCenter)
            let verticalOffset = -expansionIntensity
                * 0.025
                * max(bounds.height, 1)
            let glowAmount = 0.32
                + (0.7 - 0.32) * durationProgress
            glowStrength = envelope * glowAmount * strength
            if scale != 1 {
                runContext.addFilter(
                    .projectionTransform(
                        ProjectionTransform(
                            CGAffineTransform(
                                a: scale,
                                b: 0,
                                c: 0,
                                d: scale,
                                tx: bounds.midX * (1 - scale) + horizontalOffset,
                                ty: bounds.midY * (1 - scale) + verticalOffset
                            )
                        )
                    )
                )
            }
        }

        var upcomingContext = runContext
        upcomingContext.opacity = 0.5 + 0.5 * (1 - strength)
        upcomingContext.draw(run)

        guard !timing.isWhitespace,
              playbackTime >= timing.startTime,
              bounds.width > 0,
              bounds.height > 0 else {
            return
        }
        let reveal = revealProgress(timing)
        let feather: CGFloat = 30
        let frontX: CGFloat
        if run.layoutDirection == .rightToLeft {
            frontX = bounds.maxX + feather
                - (bounds.width + feather) * CGFloat(reveal)
        } else {
            frontX = bounds.minX - feather
                + (bounds.width + feather) * CGFloat(reveal)
        }
        let startPoint: CGPoint
        let endPoint: CGPoint
        if run.layoutDirection == .rightToLeft {
            startPoint = CGPoint(x: frontX - feather, y: bounds.midY)
            endPoint = CGPoint(x: frontX, y: bounds.midY)
        } else {
            startPoint = CGPoint(x: frontX, y: bounds.midY)
            endPoint = CGPoint(x: frontX + feather, y: bounds.midY)
        }
        let gradient = Gradient(stops: (0...8).map { index in
            let location = Double(index) / 8
            let distance = run.layoutDirection == .rightToLeft
                ? 1 - location
                : location
            return Gradient.Stop(
                color: .white.opacity((1 - distance) * (1 - 0.65 * distance)),
                location: location
            )
        })

        if glowStrength > 0 {
            var outerGlow = runContext
            outerGlow.opacity = 0.4 * glowStrength * 0.55
            outerGlow.blendMode = .plusLighter
            outerGlow.addFilter(.blur(radius: 5))
            drawRevealed(
                run,
                bounds: bounds,
                gradient: gradient,
                startPoint: startPoint,
                endPoint: endPoint,
                in: &outerGlow
            )
            var innerGlow = runContext
            innerGlow.opacity = 0.4 * glowStrength
            innerGlow.blendMode = .plusLighter
            innerGlow.addFilter(.blur(radius: 1.75))
            drawRevealed(
                run,
                bounds: bounds,
                gradient: gradient,
                startPoint: startPoint,
                endPoint: endPoint,
                in: &innerGlow
            )
        }
        drawRevealed(
            run,
            bounds: bounds,
            gradient: gradient,
            startPoint: startPoint,
            endPoint: endPoint,
            in: &runContext
        )
    }

    private func drawRevealed(
        _ run: Text.Layout.Run,
        bounds: CGRect,
        gradient: Gradient,
        startPoint: CGPoint,
        endPoint: CGPoint,
        in context: inout GraphicsContext
    ) {
        context.clipToLayer { mask in
            mask.fill(
                Path(bounds),
                with: .linearGradient(
                    gradient,
                    startPoint: startPoint,
                    endPoint: endPoint
                )
            )
        }
        context.draw(run)
    }

    private func revealProgress(_ timing: PearWallLyricTimingAttribute) -> Double {
        let duration = timing.endTime - timing.startTime
        let raw = duration > 0
            ? min(max((playbackTime - timing.startTime) / duration, 0), 1)
            : 1
        let regular = smootherStep(raw)
        guard duration > 0.55, duration >= 0.95 else { return regular }
        let attack = smootherStep(
            (playbackTime - timing.startTime) / 0.3
        )
        let release = smootherStep(
            (playbackTime - (timing.endTime - 0.25)) / 0.25
        )
        return min(max(0.82 * attack + 0.08 * raw + 0.1 * release, 0), 1)
    }

    private func smootherStep(_ value: Double) -> Double {
        let progress = min(max(value, 0), 1)
        return progress * progress * progress
            * (progress * (progress * 6 - 15) + 10)
    }
}

struct PearWallMeloXLyricsView: View {
    @ObservedObject var model: PearWallLyricsOverlayModel

    var body: some View {
        GeometryReader { geometry in
            if model.profile.enabled {
                let contentWidth = min(max(geometry.size.width * 0.72, 320), 1_160)
                VStack(spacing: 24) {
                    if model.profile.showLyrics {
                        lyricsView(width: contentWidth)
                            .frame(maxHeight: .infinity)
                    } else {
                        Spacer(minLength: 0)
                    }
                    if model.profile.trackInfo.enabled {
                        trackInfo(width: contentWidth)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, 44)
                .padding(.bottom, 48)
                .allowsHitTesting(false)
            }
        }
        .background(Color.clear)
    }

    private func lyricsView(width: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 50) {
                    ForEach(Array(model.visibleLines.enumerated()), id: \.offset) { index, line in
                        if let interlude = model.interlude(before: line.id) {
                            interludeView(interlude)
                                .id("interlude-\(interlude.id)")
                        }
                        lyricRow(line, index: index, width: width)
                            .id("lyric-\(index)")
                    }
                }
                .padding(.vertical, 240)
            }
            .scrollDisabled(true)
            .scrollIndicators(.hidden)
            .frame(width: width)
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .black, location: 0.08),
                        .init(color: .black, location: 0.86),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .onChange(of: model.focusTargetID, initial: true) { _, target in
                guard let target else { return }
                let spring = AppleMusicLyricsMotionProfile.macOS26_6.lineChangeSpring
                withAnimation(
                    .interpolatingSpring(
                        mass: spring.mass,
                        stiffness: spring.stiffness,
                        damping: spring.damping,
                        initialVelocity: 0
                    )
                ) {
                    proxy.scrollTo(target, anchor: .center)
                }
            }
        }
    }

    private func interludeView(_ interlude: LyricInterlude) -> some View {
        let profile = AppleMusicInstrumentalBreakMotionProfile.macOS26_6
        let presentation = AppleMusicInterludeDotsPresentation.make(
            playbackTime: model.playbackTime,
            interlude: interlude,
            profile: profile,
            reducesMotion: false
        )
        return HStack(spacing: CGFloat(profile.dotMargin)) {
            ForEach(presentation.dotOpacities.indices, id: \.self) { index in
                Circle()
                    .fill(.white.opacity(presentation.dotOpacities[index]))
                    .frame(
                        width: CGFloat(profile.dotLength),
                        height: CGFloat(profile.dotLength)
                    )
                    .scaleEffect(
                        presentation.scale,
                        anchor: UnitPoint(
                            x: profile.dotAnchorX(at: index),
                            y: 0.5
                        )
                    )
            }
        }
        .frame(
            width: profile.contentWidth,
            height: CGFloat(profile.viewHeight),
            alignment: .leading
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(model.isInterludeVisible(interlude) ? presentation.opacity : 0)
        .accessibilityHidden(true)
    }

    private func lyricRow(
        _ line: LyricLine,
        index: Int,
        width: CGFloat
    ) -> some View {
        let focusedIndex = model.focusedIndex
        let distance = focusedIndex.map { abs(index - $0) } ?? Int.max
        let focused = focusedIndex == index
        let profile = AppleMusicLyricsMotionProfile.macOS26_6
        let blurRadius: CGFloat = if !model.profile.progressiveBlur || focused {
            0
        } else if distance <= 1 {
            CGFloat(profile.nonFocusedBlurRadius)
        } else {
            CGFloat(profile.maximumNonFocusedBlurRadius)
        }
        let rowAlignment = alignment(for: line)
        let lineSpring = Animation.interpolatingSpring(
            mass: profile.lineChangeSpring.mass,
            stiffness: profile.lineChangeSpring.stiffness,
            damping: profile.lineChangeSpring.damping,
            initialVelocity: 0
        )
        return VStack(alignment: horizontalAlignment(for: rowAlignment), spacing: 7) {
            primaryText(line, focused: focused)
                .font(
                    .system(
                        size: resolvedFontSize(width: width),
                        weight: model.profile.fontWeight.swiftUIWeight
                    )
                )
                .multilineTextAlignment(rowAlignment)
            if let romanization = line.romanization, !romanization.isEmpty {
                Text(romanization)
                    .font(
                        .system(
                            size: resolvedFontSize(width: width)
                                * CGFloat(profile.transliterationFontCoefficient),
                            weight: model.profile.fontWeight.swiftUIWeight
                        )
                    )
                    .multilineTextAlignment(rowAlignment)
            }
            if let translation = line.translation, !translation.isEmpty {
                Text(translation)
                    .font(
                        .system(
                            size: resolvedFontSize(width: width)
                                * CGFloat(profile.translationLargeFontCoefficient),
                            weight: model.profile.fontWeight.swiftUIWeight
                        )
                    )
                    .multilineTextAlignment(rowAlignment)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: frameAlignment(for: rowAlignment))
        .opacity(
            focused
                ? profile.selectedTextOpacity
                : profile.deselectedTextOpacity
        )
        .scaleEffect(
            focused ? 1 : profile.deselectedScale,
            anchor: scaleAnchor(for: rowAlignment)
        )
        .blur(radius: blurRadius)
        .animation(lineSpring.delay(cascadeDelay(index: index)), value: focusedIndex)
        .animation(
            .timingCurve(
                profile.focusBlurTransitionControlPoint1X,
                profile.focusBlurTransitionControlPoint1Y,
                profile.focusBlurTransitionControlPoint2X,
                profile.focusBlurTransitionControlPoint2Y,
                duration: profile.focusBlurTransitionDuration
            ),
            value: focused
        )
    }

    @ViewBuilder
    private func primaryText(_ line: LyricLine, focused: Bool) -> some View {
        if focused, !line.syllables.isEmpty {
            timedText(line.syllables)
                .textRenderer(
                    PearWallMeloXTextRenderer(
                        playbackTime: model.playbackTime,
                        timingEffectsStrength: 1
                    )
                )
        } else {
            Text(line.text)
        }
    }

    private func timedText(_ syllables: [LyricSyllable]) -> Text {
        syllables.reduce(Text("")) { result, syllable in
            let characters = Array(syllable.text)
            let duration = max(syllable.endTime - syllable.startTime, 0)
            return characters.enumerated().reduce(result) { text, entry in
                let characterDuration = characters.isEmpty
                    ? 0
                    : duration / Double(characters.count)
                let start = syllable.startTime
                    + Double(entry.offset) * characterDuration
                let end = entry.offset == characters.count - 1
                    ? syllable.endTime
                    : start + characterDuration
                return text + Text(verbatim: String(entry.element)).customAttribute(
                    PearWallLyricTimingAttribute(
                        startTime: start,
                        endTime: max(end, start),
                        syllableStartTime: syllable.startTime,
                        syllableEndTime: syllable.endTime,
                        characterIndex: entry.offset,
                        characterCount: max(characters.count, 1),
                        isWhitespace: entry.element.isWhitespace
                    )
                )
            }
        }
    }

    @ViewBuilder
    private func trackInfo(width: CGFloat) -> some View {
        let settings = model.profile.trackInfo
        let alignment = trackInfoAlignment()
        Group {
            if settings.layout == .horizontal {
                HStack(alignment: .center, spacing: 16) {
                    trackArtwork(settings)
                    trackLabels(settings, alignment: alignment)
                }
            } else {
                VStack(alignment: horizontalAlignment(for: alignment), spacing: 12) {
                    trackArtwork(settings)
                    trackLabels(settings, alignment: alignment)
                }
            }
        }
        .scaleEffect(settings.scale, anchor: scaleAnchor(for: alignment))
        .frame(width: width, alignment: frameAlignment(for: alignment))
    }

    @ViewBuilder
    private func trackArtwork(_ settings: PearWallTrackInfoSettings) -> some View {
        if settings.showArtwork, let artwork = model.artwork {
            Image(nsImage: artwork)
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: settings.artworkSize, height: settings.artworkSize)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func trackLabels(
        _ settings: PearWallTrackInfoSettings,
        alignment: TextAlignment
    ) -> some View {
        VStack(alignment: horizontalAlignment(for: alignment), spacing: 3) {
            if settings.showTitle, !model.title.isEmpty {
                Text(model.title)
                    .font(
                        .system(
                            size: settings.titleFontSize,
                            weight: settings.titleFontWeight.swiftUIWeight
                        )
                    )
            }
            if settings.showArtist, !model.artist.isEmpty {
                Text(model.artist)
                    .font(
                        .system(
                            size: settings.secondaryFontSize,
                            weight: settings.secondaryFontWeight.swiftUIWeight
                        )
                    )
                    .foregroundStyle(.white.opacity(0.76))
            }
            if settings.showAlbum, !model.album.isEmpty {
                Text(model.album)
                    .font(
                        .system(
                            size: settings.secondaryFontSize,
                            weight: settings.secondaryFontWeight.swiftUIWeight
                        )
                    )
                    .foregroundStyle(.white.opacity(0.58))
            }
        }
        .lineLimit(1)
        .multilineTextAlignment(alignment)
    }

    private func resolvedFontSize(width: CGFloat) -> CGFloat {
        if model.profile.fontSizeMode == .custom {
            return model.profile.fontSize
        }
        return AppleMusicLyricsTypographyProfile.macOS26_6
            .primaryFontSize(for: width)
    }

    private func alignment(for line: LyricLine) -> TextAlignment {
        switch model.profile.alignment {
        case .left:
            return .leading
        case .center:
            return .center
        case .right:
            return .trailing
        case .meloX:
            return line.agent?.alignment == .flipped ? .trailing : .leading
        }
    }

    private func trackInfoAlignment() -> TextAlignment {
        switch model.profile.trackInfo.alignment {
        case .left:
            return .leading
        case .center:
            return .center
        case .right:
            return .trailing
        case .followLyrics:
            switch model.profile.alignment {
            case .center:
                return .center
            case .right:
                return .trailing
            default:
                return .leading
            }
        }
    }

    private func horizontalAlignment(for alignment: TextAlignment) -> HorizontalAlignment {
        switch alignment {
        case .center:
            return .center
        case .trailing:
            return .trailing
        default:
            return .leading
        }
    }

    private func frameAlignment(for alignment: TextAlignment) -> Alignment {
        switch alignment {
        case .center:
            return .center
        case .trailing:
            return .trailing
        default:
            return .leading
        }
    }

    private func scaleAnchor(for alignment: TextAlignment) -> UnitPoint {
        switch alignment {
        case .center:
            return .center
        case .trailing:
            return .trailing
        default:
            return .leading
        }
    }

    private func cascadeDelay(index: Int) -> TimeInterval {
        guard let focusedIndex = model.focusedIndex else { return 0 }
        return Double(max(abs(index - focusedIndex) - 1, 0))
            * AppleMusicLyricsMotionProfile.macOS26_6.forwardCascadeDelay
    }
}

extension PearWallLyricsFontWeight {
    var swiftUIWeight: Font.Weight {
        switch self {
        case .regular:
            return .regular
        case .medium:
            return .medium
        case .semibold:
            return .semibold
        case .bold:
            return .bold
        case .heavy:
            return .heavy
        }
    }
}

final class PearWallTransparentHostingView<Content: View>: NSHostingView<Content> {
    override var isOpaque: Bool { false }
}
