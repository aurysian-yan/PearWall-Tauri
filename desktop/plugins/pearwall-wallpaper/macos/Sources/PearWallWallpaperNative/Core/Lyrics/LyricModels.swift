import Foundation

struct LyricSyllable: Identifiable, Hashable, Sendable {
    let text: String
    let startTime: TimeInterval
    let endTime: TimeInterval

    var id: String {
        "\(startTime)-\(endTime)-\(text)"
    }
}

enum LyricAgentAlignment: Hashable, Sendable {
    case normal
    case flipped
}

enum LyricAgentKind: Hashable, Sendable {
    case person
    case group
}

struct LyricAgent: Hashable, Sendable {
    let identifier: String
    let displayName: String
    let kind: LyricAgentKind
    let alignment: LyricAgentAlignment
}

enum LyricVocalistsType: Hashable, Sendable {
    case single
    case duet
    case group

    static func resolve(in lines: [LyricLine]) -> LyricVocalistsType {
        let agents = lines.compactMap(\.agent)
        let personIdentifiers = Set(
            agents
                .filter { $0.kind == .person }
                .map(\.identifier)
        )
        if agents.contains(where: { $0.kind == .group })
            || personIdentifiers.count > 2 {
            return .group
        }
        return personIdentifiers.count == 2 ? .duet : .single
    }
}

enum LyricBackgroundVocalsPosition: Hashable, Sendable {
    case beforePrimary
    case afterPrimary
}

struct LyricBackgroundVocal: Hashable, Sendable {
    let time: TimeInterval
    let duration: TimeInterval?
    let text: String
    let syllables: [LyricSyllable]
    let translation: String?
    let position: LyricBackgroundVocalsPosition

    func lyricLine(agent: LyricAgent?) -> LyricLine {
        LyricLine(
            time: time,
            duration: duration,
            text: text,
            syllables: syllables,
            translation: translation,
            agent: agent
        )
    }
}

struct LyricLine: Identifiable, Hashable, Sendable {
    let time: TimeInterval
    let duration: TimeInterval?
    let text: String
    let syllables: [LyricSyllable]
    let romanization: String?
    let romanizationSyllables: [LyricSyllable]
    let translation: String?
    let agent: LyricAgent?
    let backgroundVocal: LyricBackgroundVocal?

    init(
        time: TimeInterval,
        duration: TimeInterval? = nil,
        text: String,
        syllables: [LyricSyllable] = [],
        romanization: String? = nil,
        romanizationSyllables: [LyricSyllable] = [],
        translation: String? = nil,
        agent: LyricAgent? = nil,
        backgroundVocal: LyricBackgroundVocal? = nil
    ) {
        self.time = time
        self.duration = duration
        self.text = text
        self.syllables = syllables
        self.romanization = romanization
        self.romanizationSyllables = romanizationSyllables
        self.translation = translation
        self.agent = agent
        self.backgroundVocal = backgroundVocal
    }

    var id: String {
        "\(time)-\(text)"
    }

    var isSyllableSynced: Bool {
        !syllables.isEmpty
    }

    var hasTranslation: Bool {
        guard let translation else { return false }
        return !translation
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
    }

    var hasRomanization: Bool {
        guard let romanization else { return false }
        return !romanization
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
    }

    func makePseudoSyllables() -> [LyricSyllable] {
        guard syllables.isEmpty,
              let duration,
              duration > 0 else { return [] }

        let characters = Array(text)
        guard !characters.isEmpty else { return [] }

        let characterDuration = duration / Double(characters.count)
        return characters.enumerated().map { index, character in
            let startTime = time + Double(index) * characterDuration
            return LyricSyllable(
                text: String(character),
                startTime: startTime,
                endTime: startTime + characterDuration
            )
        }
    }

    func attachingTranslation(_ translation: String?) -> LyricLine {
        LyricLine(
            time: time,
            duration: duration,
            text: text,
            syllables: syllables,
            romanization: romanization,
            romanizationSyllables: romanizationSyllables,
            translation: translation,
            agent: agent,
            backgroundVocal: backgroundVocal
        )
    }

    func attachingRomanization(
        _ romanization: String?,
        romanizationSyllables: [LyricSyllable] = []
    ) -> LyricLine {
        LyricLine(
            time: time,
            duration: duration,
            text: text,
            syllables: syllables,
            romanization: romanization,
            romanizationSyllables: romanizationSyllables,
            translation: translation,
            agent: agent,
            backgroundVocal: backgroundVocal
        )
    }

    func attachingAgent(
        _ agent: LyricAgent?,
        text: String? = nil,
        syllables: [LyricSyllable]? = nil
    ) -> LyricLine {
        LyricLine(
            time: time,
            duration: duration,
            text: text ?? self.text,
            syllables: syllables ?? self.syllables,
            romanization: romanization,
            romanizationSyllables: romanizationSyllables,
            translation: translation,
            agent: agent,
            backgroundVocal: backgroundVocal
        )
    }

    func accessibilityText(
        includingTranslation: Bool,
        includingRomanization: Bool = false
    ) -> String {
        var components = [text]
        if includingRomanization, hasRomanization,
           let romanization {
            components.append(romanization)
        }
        if includingTranslation, hasTranslation,
           let translation {
            components.append(translation)
        }
        if let backgroundVocal {
            components.append(backgroundVocal.text)
            if includingTranslation,
               let translation = backgroundVocal.translation {
                components.append(translation)
            }
        }
        return components.joined(separator: "，")
    }
}
