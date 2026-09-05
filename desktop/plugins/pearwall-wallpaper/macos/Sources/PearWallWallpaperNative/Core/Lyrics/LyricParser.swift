import Foundation

enum LyricParser {
    static func parse(
        yrc: String,
        lrc: String,
        translatedYRC: String = "",
        translatedLRC: String = "",
        romanizedYRC: String = "",
        romanizedLRC: String = "",
        duetLRC: String? = nil
    ) -> [LyricLine] {
        let synchronizedLines = parseYRC(yrc)
        let lineSynchronizedLines = parseLRC(lrc)
        let lines = synchronizedLines.isEmpty ? lineSynchronizedLines : synchronizedLines
        guard !lines.isEmpty else { return [] }

        let translatedLines = attachSecondaryLyrics(
            synchronizedSource: translatedYRC,
            lineSynchronizedSource: translatedLRC,
            synchronizedOriginalLines: synchronizedLines,
            lineSynchronizedOriginalLines: lineSynchronizedLines,
            to: lines,
            kind: .translation
        )
        let romanizedLines = attachSecondaryLyrics(
            synchronizedSource: romanizedYRC,
            lineSynchronizedSource: romanizedLRC,
            synchronizedOriginalLines: synchronizedLines,
            lineSynchronizedOriginalLines: lineSynchronizedLines,
            to: translatedLines,
            kind: .romanization
        )
        let annotatedLines = attachRomanizationTimings(
            parseYRC(romanizedYRC),
            to: romanizedLines
        )
        return LyricDuetParser.apply(
            lrc: duetLRC ?? lrc,
            to: annotatedLines
        )
    }

    static func parseLRC(_ source: String) -> [LyricLine] {
        let lines = source
            .split(whereSeparator: \Character.isNewline)
            .flatMap { parseLRCLines($0) }
            .sorted { $0.time < $1.time }
        return inferringDurations(in: lines)
    }

    static func parseYRC(_ source: String) -> [LyricLine] {
        source
            .split(whereSeparator: \Character.isNewline)
            .compactMap { rawLine in
                let line = String(rawLine).trimmingCharacters(in: .whitespacesAndNewlines)
                if line.first == "{" {
                    return parseYRCCredits(line)
                }
                return parseYRCSyllableLine(line)
            }
            .sorted { $0.time < $1.time }
    }

    private static func parseLRCLines(_ rawLine: Substring) -> [LyricLine] {
        let line = String(rawLine)
        let storage = line as NSString
        let matches = lrcTimestampExpression.matches(
            in: line,
            range: NSRange(line.startIndex..., in: line)
        )
        guard let lastMatch = matches.last else { return [] }

        let textStart = NSMaxRange(lastMatch.range)
        let text = storage.substring(from: textStart)
            .trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return [] }

        return matches.compactMap { match in
            guard let minutes = integer(in: match.range(at: 1), from: storage) else {
                return nil
            }
            let rawSeconds = storage.substring(with: match.range(at: 2))
                .replacingOccurrences(of: ":", with: ".")
            guard let seconds = Double(rawSeconds) else { return nil }
            return LyricLine(time: Double(minutes) * 60 + seconds, text: text)
        }
    }

    private static func inferringDurations(in lines: [LyricLine]) -> [LyricLine] {
        lines.enumerated().map { index, line in
            let nextLineTime = index + 1 < lines.count
                ? lines[index + 1].time
                : nil
            let inferredDuration = nextLineTime.flatMap { nextTime in
                let duration = nextTime - line.time
                return duration > 0 ? duration : nil
            } ?? estimatedLastLineDuration(for: line.text)

            return LyricLine(
                time: line.time,
                duration: inferredDuration,
                text: line.text,
                syllables: line.syllables,
                romanization: line.romanization,
                romanizationSyllables: line.romanizationSyllables,
                translation: line.translation,
                agent: line.agent,
                backgroundVocal: line.backgroundVocal
            )
        }
    }

    private static func estimatedLastLineDuration(for text: String) -> TimeInterval {
        let visibleCharacterCount = text.filter { !$0.isWhitespace }.count
        return min(max(Double(visibleCharacterCount) * 0.32, 2), 8)
    }

    private static func parseYRCSyllableLine(_ line: String) -> LyricLine? {
        guard line.first == "[",
              let closingBracket = line.firstIndex(of: "]") else { return nil }

        let lineTiming = line[line.index(after: line.startIndex)..<closingBracket]
            .split(separator: ",", omittingEmptySubsequences: false)
        guard lineTiming.count >= 2,
              let lineStartMS = Int(lineTiming[0]),
              let lineDurationMS = Int(lineTiming[1]) else { return nil }

        let content = String(line[line.index(after: closingBracket)...])
        let contentRange = NSRange(content.startIndex..., in: content)
        let matches = syllableExpression.matches(in: content, range: contentRange)
        guard !matches.isEmpty else {
            let text = content.trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty else { return nil }
            return LyricLine(
                time: seconds(fromMilliseconds: lineStartMS),
                duration: seconds(fromMilliseconds: lineDurationMS),
                text: text
            )
        }

        let textStorage = content as NSString
        let syllables = matches.enumerated().compactMap { index, match -> LyricSyllable? in
            guard let startMilliseconds = integer(in: match.range(at: 1), from: textStorage),
                  let durationMilliseconds = integer(in: match.range(at: 2), from: textStorage) else {
                return nil
            }

            let textStart = NSMaxRange(match.range)
            let textEnd = index + 1 < matches.count
                ? matches[index + 1].range.location
                : textStorage.length
            guard textEnd >= textStart else { return nil }

            let text = textStorage.substring(
                with: NSRange(location: textStart, length: textEnd - textStart)
            )
            guard !text.isEmpty else { return nil }

            let startTime = seconds(fromMilliseconds: startMilliseconds)
            return LyricSyllable(
                text: text,
                startTime: startTime,
                endTime: startTime + seconds(fromMilliseconds: durationMilliseconds)
            )
        }

        guard !syllables.isEmpty else { return nil }
        return LyricLine(
            time: seconds(fromMilliseconds: lineStartMS),
            duration: seconds(fromMilliseconds: lineDurationMS),
            text: syllables.map(\.text).joined(),
            syllables: syllables
        )
    }

    private static func attachSecondaryLyrics(
        synchronizedSource: String,
        lineSynchronizedSource: String,
        synchronizedOriginalLines: [LyricLine],
        lineSynchronizedOriginalLines: [LyricLine],
        to lines: [LyricLine],
        kind: SecondaryLyricKind
    ) -> [LyricLine] {
        let synchronizedSecondaryLines = parseYRC(synchronizedSource)
        let synchronizedFallback = synchronizedSecondaryLines.isEmpty
            ? parseLRC(synchronizedSource)
            : synchronizedSecondaryLines
        let lineSynchronizedSecondaryLines = parseLRC(
            lineSynchronizedSource
        )

        let directlyAnnotatedLines = attachSecondaryLines(
            synchronizedFallback,
            to: lines,
            kind: kind
        )
        guard !lineSynchronizedSecondaryLines.isEmpty else {
            return directlyAnnotatedLines
        }

        if synchronizedOriginalLines.isEmpty
            || lineSynchronizedOriginalLines.isEmpty {
            return attachSecondaryLines(
                lineSynchronizedSecondaryLines,
                to: directlyAnnotatedLines,
                kind: kind
            )
        }

        let annotatedOriginalLines = attachSecondaryLines(
            lineSynchronizedSecondaryLines,
            to: lineSynchronizedOriginalLines,
            kind: kind
        )
        let canonicallyAnnotatedLines = transferSecondaryLyrics(
            from: annotatedOriginalLines,
            to: directlyAnnotatedLines,
            kind: kind
        )
        return fillMissingSecondaryLyrics(
            in: canonicallyAnnotatedLines,
            from: directlyAnnotatedLines,
            kind: kind
        )
    }

    private static func attachSecondaryLines(
        _ secondaryLines: [LyricLine],
        to lines: [LyricLine],
        kind: SecondaryLyricKind
    ) -> [LyricLine] {
        guard !secondaryLines.isEmpty else { return lines }

        var lineIndex = 0
        var secondaryTextByLineIndex: [Int: String] = [:]
        for secondaryLine in secondaryLines {
            while lineIndex + 1 < lines.count {
                let currentDistance = abs(
                    lines[lineIndex].time - secondaryLine.time
                )
                let nextDistance = abs(
                    lines[lineIndex + 1].time - secondaryLine.time
                )
                let shouldAdvance = nextDistance < currentDistance
                    || (nextDistance == currentDistance
                        && !lines[lineIndex].isSyllableSynced
                        && lines[lineIndex + 1].isSyllableSynced)
                guard shouldAdvance else { break }
                lineIndex += 1
            }

            let line = lines[lineIndex]
            let normalizedSecondaryText = secondaryLine.text
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard abs(line.time - secondaryLine.time) <= annotationTolerance,
                  !normalizedSecondaryText.isEmpty,
                  normalizedSecondaryText
                    != line.text.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ),
                  secondaryTextByLineIndex[lineIndex] == nil else {
                continue
            }
            secondaryTextByLineIndex[lineIndex] = normalizedSecondaryText
        }

        return lines.enumerated().map { index, line in
            kind.attaching(
                secondaryTextByLineIndex[index] ?? kind.text(in: line),
                to: line
            )
        }
    }

    private static func attachRomanizationTimings(
        _ romanizedLines: [LyricLine],
        to lines: [LyricLine]
    ) -> [LyricLine] {
        let timedRomanizedLines = romanizedLines.filter {
            !$0.syllables.isEmpty
        }
        guard !timedRomanizedLines.isEmpty else { return lines }

        var lineIndex = 0
        var romanizedLineByIndex: [Int: LyricLine] = [:]
        for romanizedLine in timedRomanizedLines {
            while lineIndex + 1 < lines.count,
                  abs(lines[lineIndex + 1].time - romanizedLine.time)
                    < abs(lines[lineIndex].time - romanizedLine.time) {
                lineIndex += 1
            }

            guard abs(lines[lineIndex].time - romanizedLine.time)
                    <= annotationTolerance,
                  romanizedLineByIndex[lineIndex] == nil else {
                continue
            }
            romanizedLineByIndex[lineIndex] = romanizedLine
        }

        return lines.enumerated().map { index, line in
            guard let romanizedLine = romanizedLineByIndex[index] else {
                return line
            }
            return line.attachingRomanization(
                line.romanization ?? romanizedLine.text,
                romanizationSyllables: romanizedLine.syllables
            )
        }
    }

    private static func transferSecondaryLyrics(
        from sourceLines: [LyricLine],
        to targetLines: [LyricLine],
        kind: SecondaryLyricKind
    ) -> [LyricLine] {
        guard !sourceLines.isEmpty, !targetLines.isEmpty else { return targetLines }

        var minimumTargetIndex = 0
        var secondaryTextByTargetIndex: [Int: String] = [:]
        for sourceLine in sourceLines {
            guard let secondaryText = kind.text(in: sourceLine),
                  minimumTargetIndex < targetLines.count else { continue }

            let candidateRange = minimumTargetIndex..<targetLines.count
            let normalizedSource = normalizedLyricText(sourceLine.text)
            let textMatchedIndex = candidateRange
                .filter { index in
                    guard !normalizedSource.isEmpty else { return false }
                    let targetLine = targetLines[index]
                    return abs(targetLine.time - sourceLine.time) <= textMatchWindow
                        && normalizedLyricText(targetLine.text) == normalizedSource
                }
                .min { left, right in
                    abs(targetLines[left].time - sourceLine.time)
                        < abs(targetLines[right].time - sourceLine.time)
                }

            let targetIndex = textMatchedIndex ?? candidateRange
                .filter { index in
                    let targetLine = targetLines[index]
                    return targetLine.isSyllableSynced
                        && abs(targetLine.time - sourceLine.time)
                            <= annotationTolerance
                }
                .min { left, right in
                    abs(targetLines[left].time - sourceLine.time)
                        < abs(targetLines[right].time - sourceLine.time)
                }

            guard let targetIndex else { continue }
            secondaryTextByTargetIndex[targetIndex] = secondaryText
            minimumTargetIndex = targetIndex + 1
        }

        return targetLines.enumerated().map { index, line in
            kind.attaching(
                secondaryTextByTargetIndex[index] ?? kind.text(in: line),
                to: line
            )
        }
    }

    private static func fillMissingSecondaryLyrics(
        in primaryLines: [LyricLine],
        from fallbackLines: [LyricLine],
        kind: SecondaryLyricKind
    ) -> [LyricLine] {
        guard primaryLines.count == fallbackLines.count else { return primaryLines }

        return primaryLines.indices.map { index in
            let primaryLine = primaryLines[index]
            let fallbackLine = fallbackLines[index]
            guard kind.text(in: primaryLine) == nil,
                  let fallbackText = kind.text(in: fallbackLine) else {
                return primaryLine
            }

            let normalizedFallback = normalizedLyricText(fallbackText)
            let neighboringRange = max(index - 1, 0)...min(
                index + 1,
                primaryLines.count - 1
            )
            let isDuplicateOfNeighbor = neighboringRange.contains { neighborIndex in
                guard let neighborText = kind.text(
                    in: primaryLines[neighborIndex]
                ) else {
                    return false
                }
                return normalizedLyricText(neighborText)
                    == normalizedFallback
            }
            guard !isDuplicateOfNeighbor else {
                return primaryLine
            }
            return kind.attaching(fallbackText, to: primaryLine)
        }
    }

    private static func normalizedLyricText(_ text: String) -> String {
        text
            .folding(
                options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                locale: .current
            )
            .unicodeScalars
            .filter(CharacterSet.alphanumerics.contains)
            .map(String.init)
            .joined()
    }

    private static func parseYRCCredits(_ line: String) -> LyricLine? {
        guard let data = line.data(using: .utf8),
              let credits = try? JSONDecoder().decode(YRCCredits.self, from: data) else {
            return nil
        }

        let text = credits.items.compactMap(\.text).joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return LyricLine(
            time: seconds(fromMilliseconds: credits.timestamp),
            text: text
        )
    }

    private static func integer(in range: NSRange, from string: NSString) -> Int? {
        guard range.location != NSNotFound else { return nil }
        return Int(string.substring(with: range))
    }

    private static func seconds(fromMilliseconds milliseconds: Int) -> TimeInterval {
        TimeInterval(milliseconds) / 1_000
    }

    private static let syllableExpression = try! NSRegularExpression(
        pattern: #"\((\d+),(\d+)(?:,[^)]*)?\)"#
    )

    private static let lrcTimestampExpression = try! NSRegularExpression(
        pattern: #"\[(\d+):(\d+(?:[\.:]\d+)?)\]"#
    )

    private static let annotationTolerance: TimeInterval = 0.75
    private static let textMatchWindow: TimeInterval = 5
}

private enum SecondaryLyricKind {
    case translation
    case romanization

    func text(in line: LyricLine) -> String? {
        switch self {
        case .translation:
            line.translation
        case .romanization:
            line.romanization
        }
    }

    func attaching(_ text: String?, to line: LyricLine) -> LyricLine {
        switch self {
        case .translation:
            line.attachingTranslation(text)
        case .romanization:
            line.attachingRomanization(text)
        }
    }
}

private struct YRCCredits: Decodable {
    struct Item: Decodable {
        let text: String?

        private enum CodingKeys: String, CodingKey {
            case text = "tx"
        }
    }

    let timestamp: Int
    let items: [Item]

    private enum CodingKeys: String, CodingKey {
        case timestamp = "t"
        case items = "c"
    }
}

