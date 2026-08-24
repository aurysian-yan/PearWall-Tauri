import AppKit
import MetalKit

private struct PearWallQuadVertex {
    let position: SIMD2<Float>
    let textureCoordinate: SIMD2<Float>
}

private let pearWallMetalSource = """
#include <metal_stdlib>
using namespace metal;

struct QuadVertex {
    float2 position;
    float2 textureCoordinate;
};

struct VertexOutput {
    float4 position [[position]];
    float2 textureCoordinate;
};

vertex VertexOutput pearwallArtworkVertex(
    uint vertexID [[vertex_id]],
    constant QuadVertex *vertices [[buffer(0)]],
    constant float2 &textureScale [[buffer(1)]]) {
    QuadVertex input = vertices[vertexID];
    VertexOutput output;
    output.position = float4(input.position, 0.0, 1.0);
    output.textureCoordinate = (input.textureCoordinate - 0.5) * textureScale + 0.5;
    return output;
}

fragment float4 pearwallArtworkFragment(
    VertexOutput input [[stage_in]],
    texture2d<float> artwork [[texture(0)]],
    sampler artworkSampler [[sampler(0)]]) {
    return float4(artwork.sample(artworkSampler, input.textureCoordinate).rgb, 1.0);
}
"""

final class PearWallMetalRenderer: NSObject, MTKViewDelegate {
    var audioPulse: Float = 0
    var playbackPlaying = true
    private weak var view: MTKView?
    private let commandQueue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private let vertexBuffer: MTLBuffer
    private let textureLoader: MTKTextureLoader
    private var artworkTexture: MTLTexture?
    private var artworkAspect: Float = 1

    init(view: MTKView) throws {
        guard let device = view.device,
              let commandQueue = device.makeCommandQueue() else {
            throw NSError(domain: "PearWallMetal", code: 1)
        }
        let library = try device.makeLibrary(source: pearWallMetalSource, options: nil)
        guard let vertexFunction = library.makeFunction(name: "pearwallArtworkVertex"),
              let fragmentFunction = library.makeFunction(name: "pearwallArtworkFragment") else {
            throw NSError(domain: "PearWallMetal", code: 2)
        }
        let pipelineDescriptor = MTLRenderPipelineDescriptor()
        pipelineDescriptor.vertexFunction = vertexFunction
        pipelineDescriptor.fragmentFunction = fragmentFunction
        pipelineDescriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        pipeline = try device.makeRenderPipelineState(descriptor: pipelineDescriptor)

        let samplerDescriptor = MTLSamplerDescriptor()
        samplerDescriptor.minFilter = .linear
        samplerDescriptor.magFilter = .linear
        samplerDescriptor.mipFilter = .linear
        samplerDescriptor.sAddressMode = .clampToEdge
        samplerDescriptor.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else {
            throw NSError(domain: "PearWallMetal", code: 3)
        }
        self.sampler = sampler

        let vertices = [
            PearWallQuadVertex(position: SIMD2(-1, -1), textureCoordinate: SIMD2(0, 1)),
            PearWallQuadVertex(position: SIMD2(1, -1), textureCoordinate: SIMD2(1, 1)),
            PearWallQuadVertex(position: SIMD2(-1, 1), textureCoordinate: SIMD2(0, 0)),
            PearWallQuadVertex(position: SIMD2(1, 1), textureCoordinate: SIMD2(1, 0)),
        ]
        guard let vertexBuffer = device.makeBuffer(
            bytes: vertices,
            length: MemoryLayout<PearWallQuadVertex>.stride * vertices.count,
            options: .storageModeShared
        ) else {
            throw NSError(domain: "PearWallMetal", code: 4)
        }
        self.vertexBuffer = vertexBuffer
        self.commandQueue = commandQueue
        textureLoader = MTKTextureLoader(device: device)
        self.view = view
        super.init()
        view.delegate = self
    }

    func setArtwork(_ image: NSImage) -> Bool {
        var rect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            return false
        }
        let options: [MTKTextureLoader.Option: Any] = [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.topLeft.rawValue,
            .generateMipmaps: true,
        ]
        guard let texture = try? textureLoader.newTexture(cgImage: cgImage, options: options) else {
            return false
        }
        artworkTexture = texture
        artworkAspect = Float(cgImage.width) / Float(max(1, cgImage.height))
        return true
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }
        if let artworkTexture {
            var textureScale = aspectFillTextureScale(
                viewAspect: Float(view.drawableSize.width / max(1, view.drawableSize.height))
            )
            encoder.setRenderPipelineState(pipeline)
            encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
            encoder.setVertexBytes(
                &textureScale,
                length: MemoryLayout<SIMD2<Float>>.stride,
                index: 1
            )
            encoder.setFragmentTexture(artworkTexture, index: 0)
            encoder.setFragmentSamplerState(sampler, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }
        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    private func aspectFillTextureScale(viewAspect: Float) -> SIMD2<Float> {
        guard viewAspect > 0, artworkAspect > 0 else { return SIMD2(1, 1) }
        if artworkAspect > viewAspect {
            return SIMD2(viewAspect / artworkAspect, 1)
        }
        return SIMD2(1, artworkAspect / viewAspect)
    }
}
