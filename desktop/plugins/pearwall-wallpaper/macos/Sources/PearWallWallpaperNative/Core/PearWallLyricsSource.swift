import Foundation

struct PearWallLyricsSnapshot {
    let trackID: UInt64
    let provider: String
    let format: String
    let lines: [LyricLine]

    static let empty = PearWallLyricsSnapshot(
        trackID: 0,
        provider: "",
        format: "",
        lines: []
    )
}

final class PearWallLyricsSource {
    private var snapshot = PearWallLyricsSnapshot.empty
    private var lastSignature: PearWallFileSignature?

    func current(force: Bool = false) -> PearWallLyricsSnapshot {
        guard let url = pearWallApplicationSupportDirectory()?
            .appendingPathComponent("lyrics", isDirectory: true)
            .appendingPathComponent("current-lyrics.json"),
              let signature = PearWallSettingsStore.fileSignature(for: url),
              force || signature != lastSignature else {
            return snapshot
        }
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return snapshot
        }
        lastSignature = signature
        let trackID = (object["trackId"] as? NSNumber)?.uint64Value ?? 0
        let provider = object["provider"] as? String ?? ""
        let format = (object["format"] as? String ?? "").uppercased()
        let raw = object["raw"] as? String ?? ""
        let translation = object["translation"] as? String ?? ""
        let romanization = object["romanization"] as? String ?? ""
        let lines = Self.parse(
            raw: raw,
            format: format,
            translation: translation,
            romanization: romanization
        )
        snapshot = PearWallLyricsSnapshot(
            trackID: trackID,
            provider: provider,
            format: format,
            lines: lines
        )
        return snapshot
    }

    private static func parse(
        raw: String,
        format: String,
        translation: String,
        romanization: String
    ) -> [LyricLine] {
        guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }
        switch format {
        case "TTML":
            return TTMLLyricParser.parse(raw)
        case "YRC", "KRC":
            return LyricParser.parse(
                yrc: raw,
                lrc: "",
                translatedLRC: translation,
                romanizedLRC: romanization
            )
        case "QRC":
            return LyricParser.parse(
                yrc: QRCLyricNormalizer.normalize(raw),
                lrc: "",
                translatedLRC: translation,
                romanizedLRC: romanization
            )
        default:
            return LyricParser.parse(
                yrc: "",
                lrc: raw,
                translatedLRC: translation,
                romanizedLRC: romanization
            )
        }
    }
}
