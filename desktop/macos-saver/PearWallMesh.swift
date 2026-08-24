import Foundation
import Metal

private struct PearWallPresetCollection: Decodable {
    let portrait: [PearWallMeshPreset]
    let landscape: [PearWallMeshPreset]
}

private struct PearWallMeshPreset: Decodable {
    let from: [[Float]]
    let to: [[Float]]
}

struct PearWallMeshVertex {
    let fromPosition: SIMD2<Float>
    let toPosition: SIMD2<Float>
    let textureCoordinate: SIMD2<Float>
}

struct PearWallMeshGeometry {
    let vertexBuffer: MTLBuffer
    let indexBuffer: MTLBuffer
    let indexCount: Int
}

final class PearWallMeshLibrary {
    private let presets: PearWallPresetCollection

    init(bundle: Bundle) throws {
        guard let url = bundle.url(
            forResource: "presets",
            withExtension: "json",
            subdirectory: "assets"
        ) else {
            throw NSError(domain: "PearWallMesh", code: 1)
        }
        let data = try Data(contentsOf: url)
        presets = try JSONDecoder().decode(PearWallPresetCollection.self, from: data)
    }

    func makeGeometry(
        device: MTLDevice,
        portrait: Bool,
        presetIndex: Int
    ) throws -> PearWallMeshGeometry {
        let availablePresets = portrait ? presets.portrait : presets.landscape
        guard !availablePresets.isEmpty else {
            throw NSError(domain: "PearWallMesh", code: 2)
        }
        let index = min(max(0, presetIndex), availablePresets.count - 1)
        let preset = availablePresets[index]
        let initialSize = portrait ? 6 : 9
        var from = try grid(points: preset.from, size: initialSize)
        var to = try grid(points: preset.to, size: initialSize)
        for _ in 0..<3 {
            from = subdivide(from)
            to = subdivide(to)
        }

        let rows = from.count
        let columns = from[0].count
        var vertices = [PearWallMeshVertex]()
        vertices.reserveCapacity(rows * columns)
        for row in 0..<rows {
            let v = Float(row) / Float(rows - 1)
            for column in 0..<columns {
                let u = Float(column) / Float(columns - 1)
                vertices.append(
                    PearWallMeshVertex(
                        fromPosition: from[row][column] * 2 - 1,
                        toPosition: to[row][column] * 2 - 1,
                        textureCoordinate: SIMD2(u, 1 - v)
                    )
                )
            }
        }

        var indices = [UInt16]()
        indices.reserveCapacity((rows - 1) * (columns - 1) * 6)
        for row in 0..<(rows - 1) {
            for column in 0..<(columns - 1) {
                let bottomLeft = row * columns + column
                let bottomRight = bottomLeft + 1
                let topLeft = bottomLeft + columns
                let topRight = topLeft + 1
                indices.append(UInt16(bottomLeft))
                indices.append(UInt16(topLeft))
                indices.append(UInt16(topRight))
                indices.append(UInt16(topRight))
                indices.append(UInt16(bottomRight))
                indices.append(UInt16(bottomLeft))
            }
        }

        guard let vertexBuffer = device.makeBuffer(
                  bytes: vertices,
                  length: MemoryLayout<PearWallMeshVertex>.stride * vertices.count,
                  options: .storageModeShared
              ),
              let indexBuffer = device.makeBuffer(
                  bytes: indices,
                  length: MemoryLayout<UInt16>.stride * indices.count,
                  options: .storageModeShared
              ) else {
            throw NSError(domain: "PearWallMesh", code: 3)
        }
        return PearWallMeshGeometry(
            vertexBuffer: vertexBuffer,
            indexBuffer: indexBuffer,
            indexCount: indices.count
        )
    }

    private func grid(
        points: [[Float]],
        size: Int
    ) throws -> [[SIMD2<Float>]] {
        guard points.count == size * size,
              points.allSatisfy({ $0.count >= 2 }) else {
            throw NSError(domain: "PearWallMesh", code: 4)
        }
        return (0..<size).map { row in
            (0..<size).map { column in
                let point = points[row * size + column]
                return SIMD2(point[0], point[1])
            }
        }
    }

    private func subdivide(
        _ source: [[SIMD2<Float>]]
    ) -> [[SIMD2<Float>]] {
        let rows = source.count
        let columns = source[0].count
        let facePoints = (0..<(rows - 1)).map { row in
            (0..<(columns - 1)).map { column in
                (
                    source[row][column]
                        + source[row][column + 1]
                        + source[row + 1][column]
                        + source[row + 1][column + 1]
                ) / 4
            }
        }
        var result = Array(
            repeating: Array(
                repeating: SIMD2<Float>.zero,
                count: columns * 2 - 1
            ),
            count: rows * 2 - 1
        )

        for row in 0..<rows {
            for column in 0..<columns {
                let boundaryRow = row == 0 || row == rows - 1
                let boundaryColumn = column == 0 || column == columns - 1
                let point = source[row][column]
                let value: SIMD2<Float>
                if boundaryRow && boundaryColumn {
                    value = point
                } else if boundaryRow {
                    value = (
                        source[row][column - 1]
                            + point * 6
                            + source[row][column + 1]
                    ) / 8
                } else if boundaryColumn {
                    value = (
                        source[row - 1][column]
                            + point * 6
                            + source[row + 1][column]
                    ) / 8
                } else {
                    let faceAverage = (
                        facePoints[row - 1][column - 1]
                            + facePoints[row - 1][column]
                            + facePoints[row][column - 1]
                            + facePoints[row][column]
                    ) / 4
                    let edgeAverage = (
                        (point + source[row - 1][column]) / 2
                            + (point + source[row + 1][column]) / 2
                            + (point + source[row][column - 1]) / 2
                            + (point + source[row][column + 1]) / 2
                    ) / 4
                    value = (faceAverage + edgeAverage * 2 + point) / 4
                }
                result[row * 2][column * 2] = value
            }
        }

        for row in 0..<rows {
            for column in 0..<(columns - 1) {
                let first = source[row][column]
                let second = source[row][column + 1]
                result[row * 2][column * 2 + 1] = row == 0 || row == rows - 1
                    ? (first + second) / 2
                    : (
                        first
                            + second
                            + facePoints[row - 1][column]
                            + facePoints[row][column]
                    ) / 4
            }
        }

        for row in 0..<(rows - 1) {
            for column in 0..<columns {
                let first = source[row][column]
                let second = source[row + 1][column]
                result[row * 2 + 1][column * 2] = column == 0 || column == columns - 1
                    ? (first + second) / 2
                    : (
                        first
                            + second
                            + facePoints[row][column - 1]
                            + facePoints[row][column]
                    ) / 4
            }
        }

        for row in 0..<(rows - 1) {
            for column in 0..<(columns - 1) {
                result[row * 2 + 1][column * 2 + 1] = facePoints[row][column]
            }
        }
        return result
    }
}
