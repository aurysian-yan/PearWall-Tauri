import Foundation

enum TTMLLyricParser {
    static func parse(_ source: String) -> [LyricLine] {
        guard let root = TTMLDocument.parse(source) else { return [] }

        let agents = parseAgents(in: root)
        let translations = parseAuxiliaryTracks(
            named: "translation",
            in: root
        )
        let transliterations = parseAuxiliaryTracks(
            named: "transliteration",
            in: root
        )

        return root.descendants { $0.localName == "p" }
            .compactMap {
                parseLine(
                    $0,
                    agents: agents,
                    translations: translations,
                    transliterations: transliterations
                )
            }
            .sorted { $0.time < $1.time }
    }

    private static func parseLine(
        _ node: TTMLNode,
        agents: [String: LyricAgent],
        translations: [String: [AuxiliaryTrack]],
        transliterations: [String: [AuxiliaryTrack]]
    ) -> LyricLine? {
        guard let start = parseTime(node.attribute("begin")),
              let end = parseTime(node.attribute("end")),
              end >= start else {
            return nil
        }

        let syllables = parseTimedSpans(in: node)
        let fallbackText = node.text(
            excludingRoles: ["x-translation", "x-roman", "x-bg"]
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        let text = syllables.isEmpty
            ? fallbackText
            : syllables.map(\.text).joined()
                .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        let key = node.attribute("key")
        let inlineTranslation = preferredRoleText(
            role: "x-translation",
            in: node
        )
        let translation = inlineTranslation
            ?? key.flatMap { preferredTrack(for: $0, in: translations)?.text }

        let inlineRomanization = preferredRoleText(
            role: "x-roman",
            in: node
        )
        let transliteration = key.flatMap {
            preferredTrack(for: $0, in: transliterations)
        }
        let romanization = inlineRomanization ?? transliteration?.text
        let agent = node.attribute("agent").flatMap { agents[$0] }
        let backgroundVocal = parseBackgroundVocal(
            in: node,
            parentStart: start,
            parentEnd: end
        )

        return LyricLine(
            time: start,
            duration: end - start,
            text: text,
            syllables: syllables,
            romanization: normalized(romanization),
            romanizationSyllables: transliteration?.syllables ?? [],
            translation: normalized(translation),
            agent: agent,
            backgroundVocal: backgroundVocal
        )
    }

    private static func parseBackgroundVocal(
        in node: TTMLNode,
        parentStart: TimeInterval,
        parentEnd: TimeInterval
    ) -> LyricBackgroundVocal? {
        let backgroundEntries = node.contents.enumerated().compactMap {
            index,
            content -> (index: Int, node: TTMLNode)? in
            guard case .child(let child) = content,
                  child.localName == "span",
                  child.hasRole("x-bg") else {
                return nil
            }
            return (index, child)
        }
        guard let firstEntry = backgroundEntries.first else { return nil }

        let syllables = backgroundEntries.flatMap {
            parseTimedSpans(in: $0.node)
        }
        let rawText = syllables.isEmpty
            ? backgroundEntries.map {
                $0.node.text(
                    excludingRoles: ["x-translation", "x-roman"]
                )
            }.joined()
            : syllables.map(\.text).joined()
        guard let text = normalized(rawText) else { return nil }

        let authoredStart = backgroundEntries.compactMap {
            parseTime($0.node.attribute("begin"))
        }.min()
        let authoredEnd = backgroundEntries.compactMap {
            parseTime($0.node.attribute("end"))
        }.max()
        let start = authoredStart
            ?? syllables.first?.startTime
            ?? parentStart
        let end = authoredEnd
            ?? syllables.last?.endTime
            ?? parentEnd
        let firstPrimaryIndex = node.contents.firstIndex { content in
            guard case .child(let child) = content,
                  child.localName == "span" else {
                return false
            }
            return !child.hasRole("x-translation")
                && !child.hasRole("x-roman")
                && !child.hasRole("x-bg")
        }
        let position: LyricBackgroundVocalsPosition = if let firstPrimaryIndex,
            firstEntry.index < firstPrimaryIndex {
            .beforePrimary
        } else {
            .afterPrimary
        }
        let translation = backgroundEntries.compactMap {
            preferredRoleText(role: "x-translation", in: $0.node)
        }.first

        return LyricBackgroundVocal(
            time: start,
            duration: max(end - start, 0),
            text: text,
            syllables: syllables,
            translation: normalized(translation),
            position: position
        )
    }

    private static func parseAgents(
        in root: TTMLNode
    ) -> [String: LyricAgent] {
        let nodes = root.descendants { $0.localName == "agent" }
        var personIndex = 0
        var result: [String: LyricAgent] = [:]

        for node in nodes {
            guard let identifier = node.attribute("id"),
                  result[identifier] == nil else {
                continue
            }
            let type = node.attribute("type")?.lowercased()
            let kind: LyricAgentKind = type == "group" ? .group : .person
            let alignment: LyricAgentAlignment
            if kind == .group {
                alignment = .normal
            } else {
                alignment = personIndex == 0 ? .normal : .flipped
                personIndex += 1
            }
            let name = node.descendants { $0.localName == "name" }
                .first?
                .text()
                .trimmingCharacters(in: .whitespacesAndNewlines)
            result[identifier] = LyricAgent(
                identifier: identifier,
                displayName: normalized(name) ?? identifier,
                kind: kind,
                alignment: alignment
            )
        }
        return result
    }

    private static func parseAuxiliaryTracks(
        named containerName: String,
        in root: TTMLNode
    ) -> [String: [AuxiliaryTrack]] {
        var result: [String: [AuxiliaryTrack]] = [:]
        let containers = root.descendants { $0.localName == containerName }

        for container in containers {
            let inheritedLanguage = container.attribute("lang")
            for textNode in container.descendants(where: {
                $0.localName == "text"
            }) {
                guard let key = textNode.attribute("for") else { continue }
                let syllables = parseTimedSpans(in: textNode)
                let rawText = syllables.isEmpty
                    ? textNode.text(excludingRoles: ["x-bg"])
                    : syllables.map(\.text).joined()
                guard let text = normalized(rawText) else { continue }
                result[key, default: []].append(
                    AuxiliaryTrack(
                        language: textNode.attribute("lang")
                            ?? inheritedLanguage,
                        text: text,
                        syllables: syllables
                    )
                )
            }
        }
        return result
    }

    private static func parseTimedSpans(
        in parent: TTMLNode
    ) -> [LyricSyllable] {
        var result: [LyricSyllable] = []
        let contents = parent.contents

        for index in contents.indices {
            guard case .child(let span) = contents[index],
                  span.localName == "span",
                  !span.hasRole("x-translation"),
                  !span.hasRole("x-roman"),
                  !span.hasRole("x-bg"),
                  let start = parseTime(span.attribute("begin")),
                  let end = parseTime(span.attribute("end")),
                  end >= start else {
                continue
            }

            var text = span.text(
                excludingRoles: ["x-translation", "x-roman", "x-bg"]
            )
            if index + 1 < contents.count,
               case .text(let separator) = contents[index + 1],
               !separator.contains("\n"),
               separator.allSatisfy(\.isWhitespace) {
                text += separator
            }
            guard !text.isEmpty else { continue }
            result.append(
                LyricSyllable(
                    text: text,
                    startTime: start,
                    endTime: end
                )
            )
        }
        return result
    }

    private static func preferredRoleText(
        role: String,
        in node: TTMLNode
    ) -> String? {
        let candidates = node.children
            .filter { $0.localName == "span" && $0.hasRole(role) }
            .map {
                AuxiliaryTrack(
                    language: $0.attribute("lang"),
                    text: $0.text().trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ),
                    syllables: []
                )
            }
            .filter { !$0.text.isEmpty }
        return preferredTrack(in: candidates)?.text
    }

    private static func preferredTrack(
        for key: String,
        in tracks: [String: [AuxiliaryTrack]]
    ) -> AuxiliaryTrack? {
        preferredTrack(in: tracks[key] ?? [])
    }

    private static func preferredTrack(
        in tracks: [AuxiliaryTrack]
    ) -> AuxiliaryTrack? {
        tracks.min { lhs, rhs in
            languagePriority(lhs.language) < languagePriority(rhs.language)
        }
    }

    private static func languagePriority(_ language: String?) -> Int {
        let value = language?.lowercased() ?? ""
        if value.contains("zh-hans") || value.contains("zh_cn") {
            return 0
        }
        if value == "zh" || value.hasPrefix("zh-") {
            return 1
        }
        if value.hasPrefix("en") {
            return 2
        }
        return 3
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
    }

    private static func parseTime(_ value: String?) -> TimeInterval? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.hasSuffix("ms"),
           let milliseconds = Double(normalized.dropLast(2)) {
            return milliseconds / 1_000
        }
        if normalized.hasSuffix("s"),
           let seconds = Double(normalized.dropLast()) {
            return seconds
        }

        let parts = normalized.split(separator: ":")
        guard !parts.isEmpty else { return nil }
        if parts.count == 1 {
            return Double(parts[0])
        }
        guard let seconds = Double(parts.last!),
              let minutes = Double(parts[parts.count - 2]) else {
            return nil
        }
        let hours = parts.count >= 3
            ? Double(parts[parts.count - 3]) ?? 0
            : 0
        return hours * 3_600 + minutes * 60 + seconds
    }
}

private struct AuxiliaryTrack {
    let language: String?
    let text: String
    let syllables: [LyricSyllable]
}

