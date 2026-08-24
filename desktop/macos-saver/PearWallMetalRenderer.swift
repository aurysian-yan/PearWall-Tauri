import AppKit
import MetalKit

private struct PearWallQuadVertex {
    let position: SIMD2<Float>
    let textureCoordinate: SIMD2<Float>
}

private struct PearWallArtworkTexture {
    let texture: MTLTexture
    let aspect: Float
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
    float2 currentTextureCoordinate;
    float2 previousTextureCoordinate;
};

float2 pearwallRotate(float2 value, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return float2(
        cosine * value.x - sine * value.y,
        sine * value.x + cosine * value.y
    );
}

float2 pearwallTranslation(uint instance) {
    if (instance == 1) return float2(-0.25, 0.15);
    if (instance == 2) return float2(0.7, 0.7);
    return float2(0.0);
}

float pearwallModelScale(uint instance) {
    return instance == 0 ? 1.4 : 0.7;
}

float pearwallRotationPeriod(uint instance) {
    if (instance == 1) return 70.0;
    if (instance == 2) return 90.0;
    return 120.0;
}

vertex VertexOutput pearwallArtworkVertex(
    uint vertexID [[vertex_id]],
    constant QuadVertex *vertices [[buffer(0)]],
    constant float2 &currentTextureScale [[buffer(1)]],
    constant float2 &previousTextureScale [[buffer(2)]],
    constant float2 &viewScale [[buffer(3)]],
    constant float &animationTime [[buffer(4)]],
    constant float &imageScale [[buffer(5)]],
    constant uint &instance [[buffer(6)]],
    constant uint &artworkFill [[buffer(7)]]) {
    QuadVertex input = vertices[vertexID];
    VertexOutput output;
    output.currentTextureCoordinate = input.textureCoordinate;
    output.previousTextureCoordinate = input.textureCoordinate;

    if (artworkFill != 0) {
        output.position = float4(input.position, 0.0, 1.0);
        output.currentTextureCoordinate =
            (input.textureCoordinate - 0.5) * currentTextureScale + 0.5;
        output.previousTextureCoordinate =
            (input.textureCoordinate - 0.5) * previousTextureScale + 0.5;
        return output;
    }

    float angle = animationTime * 6.2831853071795864769 / pearwallRotationPeriod(instance);
    float2 position = pearwallRotate(input.position, angle);
    position *= pearwallModelScale(instance);
    position += pearwallTranslation(instance);
    position *= viewScale;
    position *= imageScale;
    if (instance == 2) {
        float parentAngle = animationTime * 6.2831853071795864769 / pearwallRotationPeriod(0);
        position = pearwallRotate(position, parentAngle);
    }
    output.position = float4(position, 0.0, 1.0);
    return output;
}

fragment float4 pearwallArtworkFragment(
    VertexOutput input [[stage_in]],
    texture2d<float> currentArtwork [[texture(0)]],
    texture2d<float> previousArtwork [[texture(1)]],
    sampler artworkSampler [[sampler(0)]],
    constant float &transitionMix [[buffer(0)]]) {
    float3 current = currentArtwork.sample(
        artworkSampler,
        input.currentTextureCoordinate
    ).rgb;
    float3 previous = previousArtwork.sample(
        artworkSampler,
        input.previousTextureCoordinate
    ).rgb;
    return float4(mix(previous, current, transitionMix), 1.0);
}
"""

final class PearWallMetalRenderer: NSObject, MTKViewDelegate {
    var animationTime: Float = 0
    var audioPulse: Float = 0
    private static let artworkTransitionDuration: TimeInterval = 0.5
    private static let imagePulseIntensity: Float = 0.33
    private weak var view: MTKView?
    private let commandQueue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private let vertexBuffer: MTLBuffer
    private let textureLoader: MTKTextureLoader
    private var currentArtwork: PearWallArtworkTexture?
    private var previousArtwork: PearWallArtworkTexture?
    private var pendingArtwork: PearWallArtworkTexture?
    private var artworkTransitionStart: TimeInterval?

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
        let artwork = PearWallArtworkTexture(
            texture: texture,
            aspect: Float(cgImage.width) / Float(max(1, cgImage.height))
        )
        guard currentArtwork != nil else {
            currentArtwork = artwork
            previousArtwork = artwork
            return true
        }
        if artworkTransitionStart != nil {
            pendingArtwork = artwork
        } else {
            startArtworkTransition(artwork, at: ProcessInfo.processInfo.systemUptime)
        }
        return true
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let currentArtwork,
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        var transitionMix = updateArtworkTransition(at: now)
        let activeCurrentArtwork = self.currentArtwork ?? currentArtwork
        let activePreviousArtwork = previousArtwork ?? activeCurrentArtwork
        var currentTextureScale = aspectFillTextureScale(
            artworkAspect: activeCurrentArtwork.aspect,
            view: view
        )
        var previousTextureScale = aspectFillTextureScale(
            artworkAspect: activePreviousArtwork.aspect,
            view: view
        )
        var viewScale = rotationViewScale(view: view)
        var time = animationTime
        var imageScale = 1 + Self.imagePulseIntensity * audioPulse * audioPulse
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setVertexBytes(
            &currentTextureScale,
            length: MemoryLayout<SIMD2<Float>>.stride,
            index: 1
        )
        encoder.setVertexBytes(
            &previousTextureScale,
            length: MemoryLayout<SIMD2<Float>>.stride,
            index: 2
        )
        encoder.setVertexBytes(
            &viewScale,
            length: MemoryLayout<SIMD2<Float>>.stride,
            index: 3
        )
        encoder.setVertexBytes(&time, length: MemoryLayout<Float>.stride, index: 4)
        encoder.setVertexBytes(&imageScale, length: MemoryLayout<Float>.stride, index: 5)
        encoder.setFragmentTexture(activeCurrentArtwork.texture, index: 0)
        encoder.setFragmentTexture(activePreviousArtwork.texture, index: 1)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentBytes(
            &transitionMix,
            length: MemoryLayout<Float>.stride,
            index: 0
        )

        var artworkFill: UInt32 = 1
        var instance: UInt32 = 0
        encoder.setVertexBytes(&instance, length: MemoryLayout<UInt32>.stride, index: 6)
        encoder.setVertexBytes(&artworkFill, length: MemoryLayout<UInt32>.stride, index: 7)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)

        artworkFill = 0
        encoder.setVertexBytes(&artworkFill, length: MemoryLayout<UInt32>.stride, index: 7)
        for value in 0..<3 {
            instance = UInt32(value)
            encoder.setVertexBytes(&instance, length: MemoryLayout<UInt32>.stride, index: 6)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    private func startArtworkTransition(
        _ artwork: PearWallArtworkTexture,
        at timestamp: TimeInterval
    ) {
        previousArtwork = currentArtwork
        currentArtwork = artwork
        artworkTransitionStart = timestamp
    }

    private func updateArtworkTransition(at timestamp: TimeInterval) -> Float {
        guard let artworkTransitionStart else { return 1 }
        let progress = min(
            1,
            max(0, (timestamp - artworkTransitionStart) / Self.artworkTransitionDuration)
        )
        guard progress >= 1 else { return Float(progress) }
        previousArtwork = currentArtwork
        self.artworkTransitionStart = nil
        if let pendingArtwork {
            self.pendingArtwork = nil
            startArtworkTransition(pendingArtwork, at: timestamp)
            return 0
        }
        return 1
    }

    private func aspectFillTextureScale(
        artworkAspect: Float,
        view: MTKView
    ) -> SIMD2<Float> {
        let viewAspect = Float(view.drawableSize.width / max(1, view.drawableSize.height))
        guard viewAspect > 0, artworkAspect > 0 else { return SIMD2(1, 1) }
        if artworkAspect > viewAspect {
            return SIMD2(viewAspect / artworkAspect, 1)
        }
        return SIMD2(1, artworkAspect / viewAspect)
    }

    private func rotationViewScale(view: MTKView) -> SIMD2<Float> {
        let aspect = Float(view.drawableSize.width / max(1, view.drawableSize.height))
        guard aspect > 0 else { return SIMD2(1, 1) }
        return aspect >= 1 ? SIMD2(1, aspect) : SIMD2(1 / aspect, 1)
    }
}
