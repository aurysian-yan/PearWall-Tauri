import Foundation

struct LyricPlaybackPosition: Equatable {
    let highlightedLyricID: LyricLine.ID?
    let activeLyricIDs: Set<LyricLine.ID>
    let nextTransitionTime: TimeInterval?
}

struct LyricFocusCascadeLineTiming: Equatable {
    let delay: TimeInterval
    let duration: TimeInterval
}

struct LyricFocusCascadeTiming: Equatable {
    let lineTimingsByLineOrder: [LyricFocusCascadeLineTiming]
    let usesBounce: Bool

    func lineTiming(for lineOrder: Int) -> LyricFocusCascadeLineTiming {
        guard !lineTimingsByLineOrder.isEmpty else {
            return LyricFocusCascadeLineTiming(delay: 0, duration: 0)
        }
        let index = min(
            max(lineOrder, lineTimingsByLineOrder.startIndex),
            lineTimingsByLineOrder.index(
                before: lineTimingsByLineOrder.endIndex
            )
        )
        return lineTimingsByLineOrder[index]
    }
}

enum LyricPlaybackTimeline {
    private static let maximumFocusCascadeMinimumCatchUpDuration = 0.18

    static func position(
        at playbackTime: TimeInterval,
        in lyrics: [LyricLine]
    ) -> LyricPlaybackPosition {
        guard !lyrics.isEmpty else {
            return LyricPlaybackPosition(
                highlightedLyricID: nil,
                activeLyricIDs: [],
                nextTransitionTime: nil
            )
        }

        var lowerBound = lyrics.startIndex
        var upperBound = lyrics.endIndex
        while lowerBound < upperBound {
            let middleIndex = lowerBound + (upperBound - lowerBound) / 2
            if lyrics[middleIndex].time <= playbackTime {
                lowerBound = middleIndex + 1
            } else {
                upperBound = middleIndex
            }
        }

        let latestStartedLyricID = lowerBound > lyrics.startIndex
            ? lyrics[lyrics.index(before: lowerBound)].id
            : nil
        var activeLyrics = lyrics[..<lowerBound].filter { line in
            guard line.time <= playbackTime else { return false }
            guard let duration = line.duration,
                  duration > 0 else {
                return line.id == latestStartedLyricID
            }
            return playbackTime < line.time + duration
        }
        if activeLyrics.isEmpty,
           let latestStartedLyricID,
           let highlightedLine = lyrics[..<lowerBound].last(where: {
               $0.id == latestStartedLyricID
           }) {
            activeLyrics = [highlightedLine]
        }
        let highlightedLyricID = activeLyrics.last(where: {
            $0.agent?.alignment != .flipped
        })?.id ?? activeLyrics.last.map {
            inheritedFocusLyricID(
                for: $0,
                in: lyrics[..<lowerBound]
            )
        } ?? latestStartedLyricID
        let activeLyricIDs = Set(activeLyrics.map(\.id))
        let nextStartTime = lowerBound < lyrics.endIndex
            ? lyrics[lowerBound].time
            : nil
        let nextEndTime = activeLyrics.compactMap { line -> TimeInterval? in
            guard let duration = line.duration,
                  duration > 0 else {
                return nil
            }
            let end = line.time + duration
            return end > playbackTime ? end : nil
        }.min()
        let nextTransitionTime = [nextStartTime, nextEndTime]
            .compactMap { $0 }
            .min()
        return LyricPlaybackPosition(
            highlightedLyricID: highlightedLyricID,
            activeLyricIDs: activeLyricIDs,
            nextTransitionTime: nextTransitionTime
        )
    }

    private static func inheritedFocusLyricID(
        for target: LyricLine,
        in startedLyrics: ArraySlice<LyricLine>
    ) -> LyricLine.ID {
        typealias FocusEntry = (
            endTime: TimeInterval,
            ownerID: LyricLine.ID,
            isPrimary: Bool
        )
        var overlappingEntries: [FocusEntry] = []

        for line in startedLyrics {
            overlappingEntries.removeAll {
                $0.endTime <= line.time
            }

            let isPrimary = line.agent?.alignment != .flipped
            let ownerID: LyricLine.ID
            if isPrimary {
                ownerID = line.id
            } else if let primaryEntry = overlappingEntries.last(where: {
                $0.isPrimary
            }) {
                ownerID = primaryEntry.ownerID
            } else {
                ownerID = overlappingEntries.last?.ownerID ?? line.id
            }

            if line.id == target.id {
                return ownerID
            }

            guard let duration = line.duration,
                  duration > 0 else {
                continue
            }
            overlappingEntries.append(
                (
                    endTime: line.time + duration,
                    ownerID: ownerID,
                    isPrimary: isPrimary
                )
            )
        }

        return target.id
    }

    static func focusAnimationDuration(
        for highlightedLyricID: LyricLine.ID?,
        in lyrics: [LyricLine]
    ) -> TimeInterval {
        guard let availableDuration = availableFocusDuration(
            for: highlightedLyricID,
            in: lyrics
        ) else {
            return 0.3
        }

        return min(max(availableDuration * 0.35, 0.05), 0.3)
    }

    static func focusCascadeAnimationDuration(
        baseDuration: TimeInterval,
        preferredDuration: TimeInterval
    ) -> TimeInterval {
        let duration = max(baseDuration, 0)
        let configuredDuration = preferredDuration.isFinite
            ? max(preferredDuration, 0)
            : 0
        return max(duration, configuredDuration)
    }

    static func focusCascadeTiming(
        maximumLineOrder: Int,
        preferredDelayPerLine: TimeInterval,
        preferredDelayIncreasePerLine: TimeInterval,
        followingLineBaseDelay: TimeInterval,
        preferredCatchUpCompletionRatio: Double,
        focusColorLeadTime: TimeInterval,
        baseAnimationDuration: TimeInterval,
        preferredAnimationDuration: TimeInterval,
        prefersBounce: Bool,
        snapThreshold: TimeInterval,
        remainingDuration: TimeInterval?
    ) -> LyricFocusCascadeTiming? {
        guard maximumLineOrder >= 0,
              preferredDelayPerLine.isFinite,
              preferredDelayPerLine >= 0,
              preferredDelayIncreasePerLine.isFinite,
              preferredDelayIncreasePerLine >= 0,
              followingLineBaseDelay.isFinite,
              followingLineBaseDelay >= 0,
              preferredCatchUpCompletionRatio.isFinite,
              baseAnimationDuration.isFinite,
              baseAnimationDuration > 0 else {
            return nil
        }
        let delayPerLine = max(preferredDelayPerLine, 0)
        let delayIncreasePerLine = max(preferredDelayIncreasePerLine, 0)
        let baseDelayForFollowingLines = max(followingLineBaseDelay, 0)
        let catchUpCompletionRatio = min(
            max(preferredCatchUpCompletionRatio, 0),
            1
        )
        let fullAnimationDuration = max(
            preferredAnimationDuration,
            baseAnimationDuration
        )
        let fullTiming = LyricFocusCascadeTiming(
            lineTimingsByLineOrder: focusCascadeLineTimings(
                maximumLineOrder: maximumLineOrder,
                delayPerLine: delayPerLine,
                delayIncreasePerLine: delayIncreasePerLine,
                followingLineBaseDelay: baseDelayForFollowingLines,
                catchUpCompletionRatio: catchUpCompletionRatio,
                animationDuration: fullAnimationDuration
            ),
            usesBounce: prefersBounce
        )
        guard let remainingDuration, remainingDuration.isFinite else {
            return fullTiming
        }

        let availableDuration = remainingDuration
            - max(focusColorLeadTime, 0)
        let effectiveSnapThreshold = snapThreshold.isFinite
            ? max(snapThreshold, 0)
            : 0
        guard availableDuration >= effectiveSnapThreshold else {
            return nil
        }
        let availableAnimationDuration = min(
            fullAnimationDuration,
            availableDuration
        )
        return LyricFocusCascadeTiming(
            lineTimingsByLineOrder: focusCascadeLineTimings(
                maximumLineOrder: maximumLineOrder,
                delayPerLine: delayPerLine,
                delayIncreasePerLine: delayIncreasePerLine,
                followingLineBaseDelay: baseDelayForFollowingLines,
                catchUpCompletionRatio: catchUpCompletionRatio,
                animationDuration: availableAnimationDuration
            ),
            usesBounce:
                prefersBounce
                    && availableAnimationDuration >= fullAnimationDuration
        )
    }

    private static func focusCascadeLineTimings(
        maximumLineOrder: Int,
        delayPerLine: TimeInterval,
        delayIncreasePerLine: TimeInterval,
        followingLineBaseDelay: TimeInterval,
        catchUpCompletionRatio: Double,
        animationDuration: TimeInterval
    ) -> [LyricFocusCascadeLineTiming] {
        let catchUpCompletionTime =
            animationDuration * catchUpCompletionRatio
        let minimumCatchUpDuration = min(
            maximumFocusCascadeMinimumCatchUpDuration,
            animationDuration * 0.5
        )
        return (0...maximumLineOrder).map { lineOrder in
            guard lineOrder > 0 else {
                return LyricFocusCascadeLineTiming(
                    delay: 0,
                    duration: animationDuration
                )
            }
            let delay = followingLineBaseDelay
                + accumulatedFocusCascadeDelay(
                    lineOrder: lineOrder,
                    delayPerLine: delayPerLine,
                    delayIncreasePerLine: delayIncreasePerLine
                )
            return LyricFocusCascadeLineTiming(
                delay: delay,
                duration: max(
                    catchUpCompletionTime - delay,
                    minimumCatchUpDuration
                )
            )
        }
    }

    private static func accumulatedFocusCascadeDelay(
        lineOrder: Int,
        delayPerLine: TimeInterval,
        delayIncreasePerLine: TimeInterval
    ) -> TimeInterval {
        let order = Double(max(lineOrder, 0))
        let accumulatedIncrease = order * max(order - 1, 0) / 2
        return order * delayPerLine
            + accumulatedIncrease * delayIncreasePerLine
    }

    static func remainingFocusDuration(
        for highlightedLyricID: LyricLine.ID?,
        at playbackTime: TimeInterval,
        in lyrics: [LyricLine]
    ) -> TimeInterval? {
        guard let highlightedLyricID,
              playbackTime.isFinite,
              let index = lyrics.firstIndex(where: { $0.id == highlightedLyricID }) else {
            return nil
        }
        let followingIndex = lyrics.index(after: index)
        guard followingIndex < lyrics.endIndex else { return nil }

        let remainingDuration = lyrics[followingIndex].time - playbackTime
        guard remainingDuration.isFinite else { return nil }
        return max(remainingDuration, 0)
    }

    private static func availableFocusDuration(
        for highlightedLyricID: LyricLine.ID?,
        in lyrics: [LyricLine]
    ) -> TimeInterval? {
        guard let highlightedLyricID,
              let index = lyrics.firstIndex(where: { $0.id == highlightedLyricID }) else {
            return nil
        }

        let followingIndex = lyrics.index(after: index)
        let availableDuration = followingIndex < lyrics.endIndex
            ? lyrics[followingIndex].time - lyrics[index].time
            : lyrics[index].duration
        guard let availableDuration,
              availableDuration.isFinite,
              availableDuration > 0 else {
            return nil
        }
        return availableDuration
    }
}

