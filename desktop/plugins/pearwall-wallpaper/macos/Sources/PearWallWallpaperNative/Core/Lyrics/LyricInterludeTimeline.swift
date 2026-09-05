import Foundation

struct LyricInterlude: Identifiable, Hashable {
    let startTime: TimeInterval
    let countdownEndTime: TimeInterval
    let precedingLyricID: LyricLine.ID?
    let followingLyricID: LyricLine.ID
    let displayBeforeLyricID: LyricLine.ID

    var id: String {
        "lyric-interlude-\(startTime)-\(displayBeforeLyricID)-\(followingLyricID)"
    }

    var isPrelude: Bool {
        precedingLyricID == nil
    }

    var cueOutTime: TimeInterval {
        max(
            startTime,
            countdownEndTime
                - AppleMusicInstrumentalBreakMotionProfile.macOS26_6
                    .cueOutLeadTime
        )
    }

    var gapDuration: TimeInterval {
        max(countdownEndTime - startTime, 0)
    }
}

struct LyricInterludePlaybackPosition: Equatable {
    let visibleInterludeID: LyricInterlude.ID?

    let focusedInterludeID: LyricInterlude.ID?

    let promotedLyricID: LyricLine.ID?

    let nextTransitionTime: TimeInterval?
}

enum LyricInterludeTimeline {
    static let minimumAnimatedGapDuration: TimeInterval =
        AppleMusicInstrumentalBreakMotionProfile.macOS26_6
            .fillLeadInDuration
        + AppleMusicInstrumentalBreakMotionProfile.macOS26_6
            .cueOutLeadTime

    static func interludes(in lyrics: [LyricLine]) -> [LyricInterlude] {
        guard let firstLyric = lyrics.first else { return [] }

        var result: [LyricInterlude] = []
        let firstMusicalLyric = lyrics.first {
            preciseEndTime(for: $0) != nil
        } ?? firstLyric
        if let prelude = makeInterlude(
            startTime: 0,
            precedingLyricID: nil,
            followingLyric: firstMusicalLyric,
            displayBeforeLyricID: firstMusicalLyric.id
        ) {
            result.append(prelude)
        }

        guard lyrics.count > 1 else { return result }
        for followingIndex in lyrics.indices.dropFirst() {
            let precedingIndex = lyrics.index(before: followingIndex)
            let precedingLyric = lyrics[precedingIndex]
            let followingLyric = lyrics[followingIndex]
            guard let precedingEndTime = preciseEndTime(
                for: precedingLyric
            ), let interlude = makeInterlude(
                startTime: precedingEndTime,
                precedingLyricID: precedingLyric.id,
                followingLyric: followingLyric,
                displayBeforeLyricID: followingLyric.id
            ) else {
                continue
            }
            result.append(interlude)
        }
        return result
    }

    static func position(
        at playbackTime: TimeInterval,
        in interludes: [LyricInterlude]
    ) -> LyricInterludePlaybackPosition {
        guard playbackTime.isFinite else {
            return inactivePosition(nextTransitionTime: nil)
        }

        for interlude in interludes {
            let motionTiming =
                AppleMusicInstrumentalBreakMotionProfile.macOS26_6.timing(
                    for: interlude
                )
            if playbackTime < interlude.startTime {
                return inactivePosition(
                    nextTransitionTime: interlude.startTime
                )
            }

            if playbackTime < motionTiming.visualEndTime {
                return LyricInterludePlaybackPosition(
                    visibleInterludeID: interlude.id,
                    focusedInterludeID: interlude.id,
                    promotedLyricID: nil,
                    nextTransitionTime: motionTiming.visualEndTime
                )
            }

            if playbackTime < interlude.countdownEndTime {
                return LyricInterludePlaybackPosition(
                    visibleInterludeID: interlude.id,
                    focusedInterludeID: nil,
                    promotedLyricID: interlude.followingLyricID,
                    nextTransitionTime: interlude.countdownEndTime
                )
            }
        }

        return inactivePosition(nextTransitionTime: nil)
    }

    private static func inactivePosition(
        nextTransitionTime: TimeInterval?
    ) -> LyricInterludePlaybackPosition {
        LyricInterludePlaybackPosition(
            visibleInterludeID: nil,
            focusedInterludeID: nil,
            promotedLyricID: nil,
            nextTransitionTime: nextTransitionTime
        )
    }

    private static func makeInterlude(
        startTime: TimeInterval,
        precedingLyricID: LyricLine.ID?,
        followingLyric: LyricLine,
        displayBeforeLyricID: LyricLine.ID
    ) -> LyricInterlude? {
        guard startTime.isFinite,
              followingLyric.time.isFinite else {
            return nil
        }

        let countdownEndTime = max(startTime, followingLyric.time)
        guard countdownEndTime - startTime
                >= minimumAnimatedGapDuration else {
            return nil
        }

        return LyricInterlude(
            startTime: startTime,
            countdownEndTime: countdownEndTime,
            precedingLyricID: precedingLyricID,
            followingLyricID: followingLyric.id,
            displayBeforeLyricID: displayBeforeLyricID
        )
    }

    private static func preciseEndTime(
        for lyric: LyricLine
    ) -> TimeInterval? {
        let durationEndTime: TimeInterval? = lyric.duration.flatMap {
            duration -> TimeInterval? in
            guard duration.isFinite, duration > 0 else { return nil }
            return lyric.time + duration
        }
        let syllableEndTime = lyric.syllables
            .lazy
            .map(\.endTime)
            .filter(\.isFinite)
            .max()

        return [durationEndTime, syllableEndTime]
            .compactMap { $0 }
            .max()
    }
}

