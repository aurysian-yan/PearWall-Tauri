import Foundation

nonisolated enum QRCLyricNormalizer {
    static func normalize(_ source: String) -> String {
        source.split(whereSeparator: \.isNewline).compactMap { rawLine in
            normalizeLine(String(rawLine))
        }.joined(separator: "\n")
    }

    private static func normalizeLine(_ line: String) -> String? {
        let range = NSRange(line.startIndex..., in: line)
        guard let lineMatch = lineExpression.firstMatch(in: line, range: range),
              let startRange = Range(lineMatch.range(at: 1), in: line),
              let durationRange = Range(lineMatch.range(at: 2), in: line),
              let contentRange = Range(lineMatch.range(at: 3), in: line) else {
            return nil
        }
        let content = String(line[contentRange])
        let matches = wordExpression.matches(
            in: content,
            range: NSRange(content.startIndex..., in: content)
        )
        guard !matches.isEmpty else { return line }

        let words = matches.compactMap { match -> String? in
            guard let textRange = Range(match.range(at: 1), in: content),
                  let startRange = Range(match.range(at: 2), in: content),
                  let durationRange = Range(match.range(at: 3), in: content) else {
                return nil
            }
            let text = String(content[textRange])
            guard !text.isEmpty else { return nil }
            return "(\(content[startRange]),\(content[durationRange]),0)\(text)"
        }.joined()
        guard !words.isEmpty else { return nil }
        return "[\(line[startRange]),\(line[durationRange])]\(words)"
    }

    private static let lineExpression = try! NSRegularExpression(
        pattern: #"^\[(\d+),(\d+)\](.*)$"#
    )
    private static let wordExpression = try! NSRegularExpression(
        pattern: #"([^()]*)\((\d+),(\d+)\)"#
    )
}

