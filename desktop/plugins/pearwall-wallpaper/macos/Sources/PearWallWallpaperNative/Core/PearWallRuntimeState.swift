import Darwin
import Foundation

struct PearWallRuntimeSnapshot {
    let pulse: Float
    let playing: Bool
    let playbackRate: Float
    let trackID: UInt64
    let position: Double
    let duration: Double
    let updatedAtMilliseconds: UInt64
}

final class PearWallRuntimeStateReader {
    private static let stateSize = 128
    private static let maximumAgeMilliseconds: UInt64 = 1_000
    private static let magic: [UInt8] = Array("PWRSTATE".utf8)
    private var mapping: UnsafeMutableRawPointer?
    private var nextOpenAttempt = Date.distantPast
    private let stateURL: URL?

    init(stateURL: URL? = nil) {
        self.stateURL = stateURL
    }

    deinit {
        closeMapping()
    }

    func currentSnapshot() -> PearWallRuntimeSnapshot? {
        openIfNeeded()
        guard let mapping else { return nil }
        for _ in 0..<8 {
            let first = loadUInt32(mapping, offset: 16)
            if first & 1 != 0 {
                continue
            }
            OSMemoryBarrier()
            let pulseBits = loadUInt32(mapping, offset: 20)
            let playing = loadUInt32(mapping, offset: 24) != 0
            let playbackRateBits = loadUInt32(mapping, offset: 28)
            let updatedAtMilliseconds = loadUInt64(mapping, offset: 32)
            let trackID = loadUInt64(mapping, offset: 48)
            let positionBits = loadUInt64(mapping, offset: 56)
            let durationBits = loadUInt64(mapping, offset: 64)
            OSMemoryBarrier()
            let second = loadUInt32(mapping, offset: 16)
            let pulse = Float(bitPattern: pulseBits)
            let playbackRate = Float(bitPattern: playbackRateBits)
            let position = Double(bitPattern: positionBits)
            let duration = Double(bitPattern: durationBits)
            guard first == second,
                  second & 1 == 0,
                  pulse.isFinite,
                  playbackRate.isFinite,
                  position.isFinite,
                  duration.isFinite else {
                continue
            }
            let now = UInt64(max(0, Date().timeIntervalSince1970 * 1_000))
            guard now >= updatedAtMilliseconds,
                  now - updatedAtMilliseconds <= Self.maximumAgeMilliseconds else {
                closeMapping(retryAfter: 1)
                return nil
            }
            return PearWallRuntimeSnapshot(
                pulse: min(1, max(0, pulse)),
                playing: playing,
                playbackRate: max(0, playbackRate),
                trackID: trackID,
                position: max(0, position),
                duration: max(0, duration),
                updatedAtMilliseconds: updatedAtMilliseconds,
            )
        }
        return nil
    }

    private func openIfNeeded() {
        guard mapping == nil, Date() >= nextOpenAttempt else { return }
        nextOpenAttempt = Date().addingTimeInterval(1)
        guard let url = stateURL ?? pearWallApplicationSupportDirectory()?
            .appendingPathComponent("runtime-state-v2.bin") else {
            return
        }
        let descriptor = Darwin.open(url.path, O_RDONLY | O_CLOEXEC)
        guard descriptor >= 0 else { return }
        defer { Darwin.close(descriptor) }
        var attributes = stat()
        guard fstat(descriptor, &attributes) == 0,
              attributes.st_size >= Self.stateSize else {
            return
        }
        let candidate = mmap(nil, Self.stateSize, PROT_READ, MAP_SHARED, descriptor, 0)
        guard candidate != MAP_FAILED,
              let candidate,
              validState(candidate) else {
            if candidate != MAP_FAILED, let candidate {
                munmap(candidate, Self.stateSize)
            }
            return
        }
        mapping = candidate
    }

    private func closeMapping(retryAfter: TimeInterval = 0) {
        guard let mapping else { return }
        munmap(mapping, Self.stateSize)
        self.mapping = nil
        nextOpenAttempt = Date().addingTimeInterval(retryAfter)
    }

    private func validState(_ mapping: UnsafeMutableRawPointer) -> Bool {
        let validMagic = Self.magic.withUnsafeBytes { bytes in
            memcmp(mapping, bytes.baseAddress, Self.magic.count) == 0
        }
        return validMagic
            && loadUInt32(mapping, offset: 8) == 2
            && loadUInt32(mapping, offset: 12) == Self.stateSize
    }

    private func loadUInt32(_ pointer: UnsafeMutableRawPointer, offset: Int) -> UInt32 {
        UInt32(littleEndian: pointer.load(fromByteOffset: offset, as: UInt32.self))
    }

    private func loadUInt64(_ pointer: UnsafeMutableRawPointer, offset: Int) -> UInt64 {
        UInt64(littleEndian: pointer.load(fromByteOffset: offset, as: UInt64.self))
    }
}
