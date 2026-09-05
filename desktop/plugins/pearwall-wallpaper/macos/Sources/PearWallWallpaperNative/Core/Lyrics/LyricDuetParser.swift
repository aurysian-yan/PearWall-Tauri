import Foundation

enum LyricDuetParser {
    private struct SourceLine {
        let order: Int
        let time: TimeInterval
        let text: String
    }

    private struct RoleLabel: Hashable {
        let identifier: String
        let displayName: String
        let kind: LyricAgentKind
    }

    private struct InlineRole {
        let role: RoleLabel
        let content: String
        let prefixCharacterCount: Int
    }

    private struct RoleEvent {
        let time: TimeInterval
        let order: Int
        let role: RoleLabel
    }

    private struct SourceAssignment {
        let time: TimeInterval
        let normalizedText: String
        let role: RoleLabel
    }

    static func apply(lrc: String, to lines: [LyricLine]) -> [LyricLine] {
        guard !lrc.isEmpty, !lines.isEmpty else { return lines }

        let sourceLines = parseSourceLines(lrc)
        guard !sourceLines.isEmpty else { return lines }

        var standaloneEvents: [RoleEvent] = []
        var inlineEvents: [RoleEvent] = []
        var candidateStandaloneMarkerOrders = Set<Int>()

        for (index, sourceLine) in sourceLines.enumerated() {
            if let inline = parseInlineRole(sourceLine.text) {
                inlineEvents.append(
                    RoleEvent(
                        time: sourceLine.time,
                        order: sourceLine.order,
                        role: inline.role
                    )
                )
            }

            guard let role = parseStandaloneRole(sourceLine.text),
                  index + 1 < sourceLines.count else { continue }
            let nextLine = sourceLines[index + 1]
            let gap = nextLine.time - sourceLine.time
            guard gap >= 0, gap <= standaloneMarkerMaximumGap else {
                continue
            }
            candidateStandaloneMarkerOrders.insert(sourceLine.order)
            standaloneEvents.append(
                RoleEvent(
                    time: nextLine.time,
                    order: sourceLine.order,
                    role: role
                )
            )
        }

        standaloneEvents = sortedEvents(standaloneEvents)
        inlineEvents = sortedEvents(inlineEvents)
        let usesStandaloneMarkers = uniquePersonCount(in: standaloneEvents) >= 2
        let events = usesStandaloneMarkers ? standaloneEvents : inlineEvents
        let standaloneMarkerOrders = usesStandaloneMarkers
            ? candidateStandaloneMarkerOrders
            : []

        guard uniquePersonCount(in: events) >= 2 else { return lines }

        let alignments = makeAlignments(for: events)
        let recognizedIdentifiers = Set(events.map { $0.role.identifier })
        let sourceAssignments = makeSourceAssignments(
            sourceLines: sourceLines,
            events: events,
            standaloneMarkerOrders: standaloneMarkerOrders,
            recognizedIdentifiers: recognizedIdentifiers
        )

        return lines.compactMap { line in
            if isStandaloneMarker(
                line,
                recognizedIdentifiers: recognizedIdentifiers
            ) {
                return nil
            }

            let inline = parseInlineRole(line.text).flatMap {
                recognizedIdentifiers.contains($0.role.identifier) ? $0 : nil
            }
            let displayText = inline?.content ?? line.text
            let role = inline?.role
                ?? sourceRole(
                    for: line,
                    displayText: displayText,
                    assignments: sourceAssignments
                )
                ?? activeRole(at: line.time, in: events, tolerance: mappingTolerance)
            guard let role,
                  let alignment = alignments[role.identifier] else {
                return line
            }

            let syllables = inline.map {
                droppingPrefix(
                    characterCount: $0.prefixCharacterCount,
                    from: line.syllables
                )
            } ?? line.syllables
            return line.attachingAgent(
                LyricAgent(
                    identifier: role.identifier,
                    displayName: role.displayName,
                    kind: role.kind,
                    alignment: alignment
                ),
                text: displayText,
                syllables: syllables
            )
        }
    }

    private static func parseSourceLines(_ source: String) -> [SourceLine] {
        var result: [SourceLine] = []
        var order = 0

        for rawLine in source.split(whereSeparator: \.isNewline) {
            let line = String(rawLine)
            let range = NSRange(line.startIndex..., in: line)
            let matches = timestampExpression.matches(in: line, range: range)
            guard let lastMatch = matches.last else { continue }

            let storage = line as NSString
            let text = storage.substring(from: NSMaxRange(lastMatch.range))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            for match in matches {
                guard let minutes = integer(
                    in: match.range(at: 1),
                    from: storage
                ) else { continue }
                let rawSeconds = storage.substring(with: match.range(at: 2))
                    .replacingOccurrences(of: ":", with: ".")
                guard let seconds = Double(rawSeconds) else { continue }
                result.append(
                    SourceLine(
                        order: order,
                        time: Double(minutes) * 60 + seconds,
                        text: text
                    )
                )
                order += 1
            }
        }

        return result.sorted {
            $0.time == $1.time ? $0.order < $1.order : $0.time < $1.time
        }
    }

    private static func parseStandaloneRole(_ text: String) -> RoleLabel? {
        firstRoleMatch(
            in: text,
            expressions: [standaloneBracketExpression, standaloneColonExpression]
        )?.role
    }

    private static func parseInlineRole(_ text: String) -> InlineRole? {
        firstRoleMatch(
            in: text,
            expressions: [inlineBracketExpression, inlineColonExpression]
        )
    }

    private static func firstRoleMatch(
        in text: String,
        expressions: [NSRegularExpression]
    ) -> InlineRole? {
        let fullRange = NSRange(text.startIndex..., in: text)
        for expression in expressions {
            guard let match = expression.firstMatch(
                in: text,
                range: fullRange
            ),
            let labelRange = Range(match.range(at: 1), in: text),
            let role = makeRole(String(text[labelRange])) else {
                continue
            }

            guard match.numberOfRanges > 2,
                  match.range(at: 2).location != NSNotFound,
                  let contentRange = Range(match.range(at: 2), in: text) else {
                return InlineRole(
                    role: role,
                    content: "",
                    prefixCharacterCount: text.count
                )
            }

            let content = String(text[contentRange])
                .trimmingCharacters(in: .whitespaces)
            guard !content.isEmpty,
                  let contentStart = text.range(of: content, range: contentRange)?.lowerBound else {
                continue
            }
            return InlineRole(
                role: role,
                content: content,
                prefixCharacterCount: text.distance(
                    from: text.startIndex,
                    to: contentStart
                )
            )
        }
        return nil
    }

    private static func makeRole(_ rawLabel: String) -> RoleLabel? {
        let displayName = rawLabel
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !displayName.isEmpty, displayName.count <= maximumRoleLength else {
            return nil
        }

        let identifier = normalizedRoleIdentifier(displayName)
        guard !identifier.isEmpty,
              !metadataRoleIdentifiers.contains(identifier) else {
            return nil
        }
        return RoleLabel(
            identifier: identifier,
            displayName: displayName,
            kind: groupRoleIdentifiers.contains(identifier) ? .group : .person
        )
    }

    private static func removingRedundantEvents(
        _ events: [RoleEvent]
    ) -> [RoleEvent] {
        var result: [RoleEvent] = []
        for event in events {
            if result.last?.role.identifier == event.role.identifier {
                continue
            }
            if let last = result.last,
               abs(last.time - event.time) < 0.000_5 {
                result[result.count - 1] = event
            } else {
                result.append(event)
            }
        }
        return result
    }

    private static func sortedEvents(_ events: [RoleEvent]) -> [RoleEvent] {
        removingRedundantEvents(
            events.sorted {
                $0.time == $1.time
                    ? $0.order < $1.order
                    : $0.time < $1.time
            }
        )
    }

    private static func uniquePersonCount(in events: [RoleEvent]) -> Int {
        Set(
            events
                .filter { $0.role.kind == .person }
                .map { $0.role.identifier }
        ).count
    }

    private static func makeAlignments(
        for events: [RoleEvent]
    ) -> [String: LyricAgentAlignment] {
        var result: [String: LyricAgentAlignment] = [:]
        var personIndex = 0
        for event in events where result[event.role.identifier] == nil {
            if event.role.kind == .group {
                result[event.role.identifier] = .normal
            } else {
                result[event.role.identifier] = personIndex.isMultiple(of: 2)
                    ? .normal
                    : .flipped
                personIndex += 1
            }
        }
        return result
    }

    private static func makeSourceAssignments(
        sourceLines: [SourceLine],
        events: [RoleEvent],
        standaloneMarkerOrders: Set<Int>,
        recognizedIdentifiers: Set<String>
    ) -> [SourceAssignment] {
        sourceLines.compactMap { sourceLine in
            guard !standaloneMarkerOrders.contains(sourceLine.order) else {
                return nil
            }
            let inline = parseInlineRole(sourceLine.text).flatMap {
                recognizedIdentifiers.contains($0.role.identifier) ? $0 : nil
            }
            let displayText = inline?.content ?? sourceLine.text
            guard let role = inline?.role
                    ?? activeRole(at: sourceLine.time, in: events) else {
                return nil
            }
            return SourceAssignment(
                time: sourceLine.time,
                normalizedText: normalizedLyricText(displayText),
                role: role
            )
        }
    }

    private static func sourceRole(
        for line: LyricLine,
        displayText: String,
        assignments: [SourceAssignment]
    ) -> RoleLabel? {
        let normalizedText = normalizedLyricText(displayText)
        guard !normalizedText.isEmpty else { return nil }
        return assignments
            .filter {
                $0.normalizedText == normalizedText
                    && abs($0.time - line.time) <= sourceMatchTolerance
            }
            .min { abs($0.time - line.time) < abs($1.time - line.time) }?
            .role
    }

    private static func activeRole(
        at time: TimeInterval,
        in events: [RoleEvent],
        tolerance: TimeInterval = 0
    ) -> RoleLabel? {
        var role: RoleLabel?
        for event in events {
            guard event.time <= time + tolerance else { break }
            role = event.role
        }
        return role
    }

    private static func isStandaloneMarker(
        _ line: LyricLine,
        recognizedIdentifiers: Set<String>
    ) -> Bool {
        guard let role = parseStandaloneRole(line.text) else { return false }
        return recognizedIdentifiers.contains(role.identifier)
    }

    private static func droppingPrefix(
        characterCount: Int,
        from syllables: [LyricSyllable]
    ) -> [LyricSyllable] {
        guard characterCount > 0, !syllables.isEmpty else { return syllables }

        var remaining = characterCount
        var result: [LyricSyllable] = []
        for syllable in syllables {
            let characters = Array(syllable.text)
            guard !characters.isEmpty else { continue }
            if remaining >= characters.count {
                remaining -= characters.count
                continue
            }

            if remaining > 0 {
                let removedFraction = Double(remaining) / Double(characters.count)
                let adjustedStart = syllable.startTime
                    + (syllable.endTime - syllable.startTime) * removedFraction
                result.append(
                    LyricSyllable(
                        text: String(characters.dropFirst(remaining)),
                        startTime: adjustedStart,
                        endTime: syllable.endTime
                    )
                )
                remaining = 0
            } else {
                result.append(syllable)
            }
        }
        return result
    }

    private static func normalizedRoleIdentifier(_ text: String) -> String {
        text
            .folding(
                options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                locale: Locale(identifier: "en_US_POSIX")
            )
            .lowercased()
            .unicodeScalars
            .filter(CharacterSet.alphanumerics.contains)
            .map(String.init)
            .joined()
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

    private static func integer(in range: NSRange, from string: NSString) -> Int? {
        guard range.location != NSNotFound else { return nil }
        return Int(string.substring(with: range))
    }

    private static let maximumRoleLength = 24
    private static let standaloneMarkerMaximumGap: TimeInterval = 1
    private static let mappingTolerance: TimeInterval = 0.35
    private static let sourceMatchTolerance: TimeInterval = 1

    private static let metadataRoleIdentifiers: Set<String> = [
        "词", "曲", "作词", "作曲", "编曲", "制作", "制作人", "监制", "出品",
        "演唱", "歌手", "和声编写", "混音", "录音", "母带", "吉他", "贝斯", "鼓",
        "键盘", "lyricist", "lyrics", "composer", "arranger", "producer",
        "mixing", "recording", "mastering", "vocal", "vocals", "artist"
    ]

    private static let groupRoleIdentifiers: Set<String> = [
        "合", "合唱", "合声", "和声", "众", "全员", "二人", "俩", "all", "both",
        "together", "chorus", "ensemble", "group"
    ]

    private static let timestampExpression = try! NSRegularExpression(
        pattern: #"\[(\d+):(\d+(?:[\.:]\d+)?)\]"#
    )
    private static let standaloneBracketExpression = try! NSRegularExpression(
        pattern: #"^\s*【([^】]{1,24})】\s*$"#
    )
    private static let standaloneColonExpression = try! NSRegularExpression(
        pattern: #"^\s*([^:：]{1,24})\s*[:：]\s*$"#
    )
    private static let inlineBracketExpression = try! NSRegularExpression(
        pattern: #"^\s*【([^】]{1,24})】\s*(\S.*)$"#
    )
    private static let inlineColonExpression = try! NSRegularExpression(
        pattern: #"^\s*([^:：]{1,24})\s*[:：]\s*(\S.*)$"#
    )
}

