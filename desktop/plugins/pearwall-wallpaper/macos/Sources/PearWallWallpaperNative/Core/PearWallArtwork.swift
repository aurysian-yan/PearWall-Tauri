import AppKit
import Foundation

struct PearWallMediaArtwork {
    let key: String
    let source: String
    let playing: Bool
}

enum PearWallMediaArtworkCache {
    private static let maximumAgeMilliseconds: UInt64 = 10_000

    static func current() -> PearWallMediaArtwork? {
        guard let url = pearWallApplicationSupportDirectory()?
            .appendingPathComponent("media-artwork.json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = object["key"] as? String,
              !key.isEmpty,
              let updatedAt = object["updated_at_milliseconds"] as? NSNumber else {
            return nil
        }
        let now = UInt64(max(0, Date().timeIntervalSince1970 * 1_000))
        let updatedAtMilliseconds = updatedAt.uint64Value
        guard now >= updatedAtMilliseconds,
              now - updatedAtMilliseconds <= maximumAgeMilliseconds else {
            return nil
        }
        return PearWallMediaArtwork(
            key: key,
            source: object["data_url"] as? String ?? "",
            playing: (object["playing"] as? NSNumber)?.boolValue ?? true,
        )
    }
}

enum PearWallArtworkLoader {
    static func image(from source: String) -> NSImage? {
        if source.hasPrefix("data:") {
            guard let separator = source.firstIndex(of: ",") else { return nil }
            let metadata = source[..<separator]
            let payload = String(source[source.index(after: separator)...])
            let data: Data?
            if metadata.contains(";base64") {
                data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
            } else {
                data = payload.removingPercentEncoding?.data(using: .utf8)
            }
            return data.flatMap(NSImage.init(data:))
        }
        if let url = URL(string: source), url.isFileURL {
            return NSImage(contentsOf: url)
        }
        if let data = Data(base64Encoded: source, options: .ignoreUnknownCharacters),
           let image = NSImage(data: data) {
            return image
        }
        return NSImage(contentsOfFile: source)
    }
}
