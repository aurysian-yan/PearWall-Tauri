import AppKit
import MetalKit

enum PearWallMoruStyle: String {
    case off = "OFF"
    case narrow = "NARROW"
    case wide = "WIDE"
    case smooth = "SMOOTH"

    init(value: String) {
        switch value.uppercased() {
        case "ON", "TRUE", "1", "NARROW":
            self = .narrow
        case "WIDE":
            self = .wide
        case "SMOOTH":
            self = .smooth
        default:
            self = .off
        }
    }
}

struct PearWallMetalConfiguration: Equatable {
    var audioIntensity: Float = 1
    var renderScale: Float = 0.75
    var blurEnabled = true
    var blurMultiplier: Float = 1
    var scrimAlpha: Float = 0.4
    var portraitPreset = 0
    var landscapePreset = 0
    var randomPreset = false
    var moruStyle = PearWallMoruStyle.off

    init(
        audioIntensity: Double = 1,
        renderScale: Double = 0.75,
        blurEnabled: Bool = true,
        blurMultiplier: Double = 1,
        scrimAlpha: Double = 0.4,
        portraitPreset: Int = 0,
        landscapePreset: Int = 0,
        randomPreset: Bool = false,
        moruStyle: String = "OFF"
    ) {
        self.audioIntensity = Float(min(3, max(0.5, audioIntensity)))
        self.renderScale = Float(min(1, max(0.25, renderScale)))
        self.blurEnabled = blurEnabled
        self.blurMultiplier = Float(min(2, max(0, blurMultiplier)))
        self.scrimAlpha = Float(min(0.8, max(0, scrimAlpha)))
        self.portraitPreset = min(3, max(0, portraitPreset))
        self.landscapePreset = min(4, max(0, landscapePreset))
        self.randomPreset = randomPreset
        self.moruStyle = PearWallMoruStyle(value: moruStyle)
    }
}

private struct PearWallQuadVertex {
    let position: SIMD2<Float>
    let textureCoordinate: SIMD2<Float>
}

private struct PearWallArtworkTexture {
    let texture: MTLTexture
    let aspect: Float
}

private struct PearWallRenderTarget {
    let texture: MTLTexture
    let width: Int
    let height: Int
}

private struct PearWallMoruTextures {
    let normal: MTLTexture
    let light: MTLTexture
}

private struct PearWallRenderTargets {
    let rotation: PearWallRenderTarget
    let half: PearWallRenderTarget
    let quarter: PearWallRenderTarget
    let eighth: PearWallRenderTarget
    let backdrop: PearWallRenderTarget
    let material: PearWallRenderTarget
    let moru: PearWallRenderTarget
}

private struct PearWallRenderSize: Equatable {
    let drawableWidth: Int
    let drawableHeight: Int
    let outputWidth: Int
    let outputHeight: Int
}

private let pearWallMetalSource = """
#include <metal_stdlib>
using namespace metal;

struct QuadVertex {
    float2 position;
    float2 textureCoordinate;
};

struct MeshVertex {
    float2 fromPosition;
    float2 toPosition;
    float2 textureCoordinate;
};

struct RotationVertexOutput {
    float4 position [[position]];
    float2 currentTextureCoordinate;
    float2 previousTextureCoordinate;
};

struct TextureVertexOutput {
    float4 position [[position]];
    float2 textureCoordinate;
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

vertex RotationVertexOutput pearwallArtworkVertex(
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
    RotationVertexOutput output;
    output.currentTextureCoordinate = input.textureCoordinate;
    output.previousTextureCoordinate = input.textureCoordinate;

    if (artworkFill != 0) {
        output.position = float4(input.position, 0.0, 1.0);
        output.currentTextureCoordinate =
            (input.textureCoordinate - 0.5) * currentTextureScale / imageScale + 0.5;
        output.previousTextureCoordinate =
            (input.textureCoordinate - 0.5) * previousTextureScale / imageScale + 0.5;
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
    RotationVertexOutput input [[stage_in]],
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

vertex TextureVertexOutput pearwallFullscreenVertex(
    uint vertexID [[vertex_id]],
    constant QuadVertex *vertices [[buffer(0)]]) {
    QuadVertex input = vertices[vertexID];
    TextureVertexOutput output;
    output.position = float4(input.position, 0.0, 1.0);
    output.textureCoordinate = input.textureCoordinate;
    return output;
}

fragment float4 pearwallBlurFragment(
    TextureVertexOutput input [[stage_in]],
    texture2d<float> source [[texture(0)]],
    sampler sourceSampler [[sampler(0)]],
    constant float2 &texelSize [[buffer(0)]],
    constant float &requestedOffset [[buffer(1)]],
    constant uint &upsample [[buffer(2)]]) {
    float2 offset = texelSize * requestedOffset;
    float3 color;
    if (upsample == 0) {
        color = source.sample(sourceSampler, input.textureCoordinate).rgb * 4.0;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(-offset.x, -offset.y)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(offset.x, -offset.y)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(-offset.x, offset.y)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(offset.x, offset.y)
        ).rgb;
        color *= 0.125;
    } else {
        color = source.sample(
            sourceSampler,
            input.textureCoordinate + float2(-2.0 * offset.x, 0.0)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(-offset.x, offset.y)
        ).rgb * 2.0;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(0.0, 2.0 * offset.y)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(offset.x, offset.y)
        ).rgb * 2.0;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(2.0 * offset.x, 0.0)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(offset.x, -offset.y)
        ).rgb * 2.0;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(0.0, -2.0 * offset.y)
        ).rgb;
        color += source.sample(
            sourceSampler,
            input.textureCoordinate + float2(-offset.x, -offset.y)
        ).rgb * 2.0;
        color /= 12.0;
    }
    return float4(color, 1.0);
}

vertex TextureVertexOutput pearwallPinchVertex(
    uint vertexID [[vertex_id]],
    constant MeshVertex *vertices [[buffer(0)]],
    constant float &animationTime [[buffer(1)]],
    constant float4 &textureTransform [[buffer(2)]]) {
    MeshVertex input = vertices[vertexID];
    float phase = acos(clamp(sin(animationTime * M_PI_F / 5.0), -1.0, 1.0)) / M_PI_F;
    float mixValue = phase * phase * (3.0 - 2.0 * phase);
    float2 warpedPosition = mix(input.fromPosition, input.toPosition, mixValue);
    TextureVertexOutput output;
    output.position = float4(warpedPosition, 0.0, 1.0);
    output.textureCoordinate =
        input.textureCoordinate * textureTransform.xy + textureTransform.zw;
    return output;
}

float3 pearwallSaturation(float3 color, float saturation) {
    float3 redColumn = float3(
        0.2126 + 0.7873 * saturation,
        0.2126 - 0.2126 * saturation,
        0.2126 - 0.2126 * saturation
    );
    float3 greenColumn = float3(
        0.7152 - 0.7152 * saturation,
        0.7152 + 0.2848 * saturation,
        0.7152 - 0.7152 * saturation
    );
    float3 blueColumn = float3(
        0.0722 - 0.0722 * saturation,
        0.0722 - 0.0722 * saturation,
        0.0722 + 0.9278 * saturation
    );
    return redColumn * color.r + greenColumn * color.g + blueColumn * color.b;
}

fragment float4 pearwallMaterialFragment(
    TextureVertexOutput input [[stage_in]],
    texture2d<float> source [[texture(0)]],
    sampler sourceSampler [[sampler(0)]],
    constant float &scrimAlpha [[buffer(0)]]) {
    float3 color = source.sample(sourceSampler, input.textureCoordinate).rgb;
    color = pearwallSaturation(color, 1.4);
    color = clamp(color, float3(-0.752941), float3(1.25098));
    color = pearwallSaturation(color, 0.70);
    float luminance = dot(color, float3(0.2126, 0.7152, 0.0722));
    float brightnessCurve = pow(max(luminance, 0.0), 1.25);
    color = max(color - float3(scrimAlpha * brightnessCurve), float3(0.0));
    float dither = fract(
        52.9829189 * fract(dot(input.position.xy, float2(0.06711056, 0.00583715)))
    ) - 0.5;
    color += dither / 255.0;
    return float4(clamp(color, 0.07, 0.97), 1.0);
}

float3 pearwallSampleMoru(
    texture2d<float> source,
    texture2d<float> normalTexture,
    texture2d<float> lightTexture,
    sampler sourceSampler,
    float2 screenCoordinate,
    float2 delta,
    float aspect,
    float normalScale,
    float ior,
    float surfaceRatio,
    float displacement,
    float thickness,
    float darkness,
    float lightness,
    float shadowness) {
    float2 coordinate = screenCoordinate + delta;
    float2 local = float2(
        fract((coordinate.x - 0.5) * normalScale + 0.5),
        fract(coordinate.y * aspect + 0.5 * aspect)
    );
    float3 upperNormal = normalize(
        normalTexture.sample(sourceSampler, local).xyz * 2.0 - 1.0
    );
    float3 lowerNormal = float3(0.0, 1.0, 0.0);
    float4 lightShadow = lightTexture.sample(sourceSampler, local);
    float depth = -lightShadow.r * displacement - thickness;
    float3 upperOut = normalize(refract(float3(0.0, 1.0, 0.0), upperNormal, ior));
    float3 lowerOut = normalize(refract(upperOut, lowerNormal, ior));
    float3 path = upperOut * depth + lowerOut * thickness;
    float2 offset = float2(path.x * surfaceRatio * ior, 0.0);
    float3 color = source.sample(
        sourceSampler,
        clamp(screenCoordinate + offset, 0.001, 0.999)
    ).rgb;
    color *= 1.0 - darkness;
    color *= mix(float3(1.0), lightShadow.bbb, shadowness);
    color = mix(color, float3(1.0), lightShadow.g * lightness);
    return color;
}

fragment float4 pearwallMoruFragment(
    TextureVertexOutput input [[stage_in]],
    texture2d<float> source [[texture(0)]],
    texture2d<float> normalTexture [[texture(1)]],
    texture2d<float> lightTexture [[texture(2)]],
    sampler sourceSampler [[sampler(0)]],
    constant float &aspect [[buffer(0)]],
    constant float &normalScale [[buffer(1)]],
    constant float &ior [[buffer(2)]],
    constant float &surfaceRatio [[buffer(3)]],
    constant float &displacement [[buffer(4)]],
    constant float &thickness [[buffer(5)]],
    constant float &darkness [[buffer(6)]],
    constant float &lightness [[buffer(7)]],
    constant float &shadowness [[buffer(8)]]) {
    const float stepCoordinate = 1.736e-4;
    float3 color = pearwallSampleMoru(
        source,
        normalTexture,
        lightTexture,
        sourceSampler,
        input.textureCoordinate,
        float2(0.0),
        aspect,
        normalScale,
        ior,
        surfaceRatio,
        displacement,
        thickness,
        darkness,
        lightness,
        shadowness
    );
    color += pearwallSampleMoru(
        source,
        normalTexture,
        lightTexture,
        sourceSampler,
        input.textureCoordinate,
        float2(-stepCoordinate),
        aspect,
        normalScale,
        ior,
        surfaceRatio,
        displacement,
        thickness,
        darkness,
        lightness,
        shadowness
    );
    color += pearwallSampleMoru(
        source,
        normalTexture,
        lightTexture,
        sourceSampler,
        input.textureCoordinate,
        float2(stepCoordinate),
        aspect,
        normalScale,
        ior,
        surfaceRatio,
        displacement,
        thickness,
        darkness,
        lightness,
        shadowness
    );
    return float4(color / 3.0, 1.0);
}

fragment float4 pearwallCopyFragment(
    TextureVertexOutput input [[stage_in]],
    texture2d<float> source [[texture(0)]],
    sampler sourceSampler [[sampler(0)]]) {
    return float4(source.sample(sourceSampler, input.textureCoordinate).rgb, 1.0);
}
"""

final class PearWallMetalRenderer: NSObject, MTKViewDelegate {
    var animationTime: Float = 0
    var audioPulse: Float = 0
    private static let artworkTransitionDuration: TimeInterval = 0.5
    private static let imagePulseIntensity: Float = 0.08
    private static let blurDownsample = 4
    private static let kawaseSigmaPerOffset: Float = 16
    private static let maximumScreenSaverPixels = 1920 * 1080
    private let inFlightSemaphore = DispatchSemaphore(value: 3)
    private let commandQueue: MTLCommandQueue
    private let artworkPipeline: MTLRenderPipelineState
    private let blurPipeline: MTLRenderPipelineState
    private let materialFullscreenPipeline: MTLRenderPipelineState
    private let materialMeshPipeline: MTLRenderPipelineState
    private let moruPipeline: MTLRenderPipelineState
    private let copyPipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private let vertexBuffer: MTLBuffer
    private let textureLoader: MTKTextureLoader
    private let meshLibrary: PearWallMeshLibrary
    private let moruTextures: [PearWallMoruStyle: PearWallMoruTextures]
    private var configuration = PearWallMetalConfiguration()
    private var currentArtwork: PearWallArtworkTexture?
    private var previousArtwork: PearWallArtworkTexture?
    private var pendingArtwork: PearWallArtworkTexture?
    private var artworkTransitionStart: TimeInterval?
    private var renderSize: PearWallRenderSize?
    private var targets: PearWallRenderTargets?
    private var mesh: PearWallMeshGeometry?
    private var meshPortrait: Bool?
    private var meshPresetIndex = -1
    private var randomPresetIndex: Int?

    init(
        view: MTKView,
        resourceBundle: Bundle? = nil
    ) throws {
        guard let device = view.device,
              let commandQueue = device.makeCommandQueue() else {
            throw NSError(domain: "PearWallMetal", code: 1)
        }
        let library = try device.makeLibrary(source: pearWallMetalSource, options: nil)
        artworkPipeline = try Self.makePipeline(
            device: device,
            library: library,
            vertex: "pearwallArtworkVertex",
            fragment: "pearwallArtworkFragment",
            pixelFormat: view.colorPixelFormat
        )
        blurPipeline = try Self.makePipeline(
            device: device,
            library: library,
            vertex: "pearwallFullscreenVertex",
            fragment: "pearwallBlurFragment",
            pixelFormat: view.colorPixelFormat
        )
        materialFullscreenPipeline = try Self.makePipeline(
            device: device,
            library: library,
            vertex: "pearwallFullscreenVertex",
            fragment: "pearwallMaterialFragment",
            pixelFormat: view.colorPixelFormat
        )
        materialMeshPipeline = try Self.makePipeline(
            device: device,
            library: library,
            vertex: "pearwallPinchVertex",
            fragment: "pearwallMaterialFragment",
            pixelFormat: view.colorPixelFormat
        )
        moruPipeline = try Self.makePipeline(
            device: device,
            library: library,
            vertex: "pearwallFullscreenVertex",
            fragment: "pearwallMoruFragment",
            pixelFormat: view.colorPixelFormat
        )
        copyPipeline = try Self.makePipeline(
            device: device,
            library: library,
            vertex: "pearwallFullscreenVertex",
            fragment: "pearwallCopyFragment",
            pixelFormat: view.colorPixelFormat
        )

        let samplerDescriptor = MTLSamplerDescriptor()
        samplerDescriptor.minFilter = .linear
        samplerDescriptor.magFilter = .linear
        samplerDescriptor.mipFilter = .linear
        samplerDescriptor.sAddressMode = .clampToEdge
        samplerDescriptor.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else {
            throw NSError(domain: "PearWallMetal", code: 2)
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
            throw NSError(domain: "PearWallMetal", code: 3)
        }
        self.vertexBuffer = vertexBuffer
        self.commandQueue = commandQueue
        let resolvedBundle = resourceBundle ?? Bundle(for: PearWallMetalRenderer.self)
        let resolvedTextureLoader = MTKTextureLoader(device: device)
        textureLoader = resolvedTextureLoader
        meshLibrary = try PearWallMeshLibrary(
            bundle: resolvedBundle
        )
        moruTextures = try Self.loadMoruTextures(
            bundle: resolvedBundle,
            textureLoader: resolvedTextureLoader
        )
        super.init()
        view.delegate = self
    }

    func setConfiguration(_ configuration: PearWallMetalConfiguration) {
        if self.configuration.renderScale != configuration.renderScale {
            renderSize = nil
            targets = nil
        }
        if self.configuration.randomPreset != configuration.randomPreset {
            randomPresetIndex = nil
        }
        if self.configuration.portraitPreset != configuration.portraitPreset
            || self.configuration.landscapePreset != configuration.landscapePreset
            || self.configuration.randomPreset != configuration.randomPreset {
            meshPresetIndex = -1
        }
        self.configuration = configuration
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

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        renderSize = nil
        targets = nil
        meshPresetIndex = -1
    }

    func draw(in view: MTKView) {
        guard let currentArtwork,
              let device = view.device,
              let targets = ensureTargets(view: view, device: device),
              let mesh = ensureMesh(view: view, device: device) else {
            return
        }
        guard inFlightSemaphore.wait(timeout: .now()) == .success else { return }
        guard let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer() else {
            inFlightSemaphore.signal()
            return
        }
        commandBuffer.addCompletedHandler { [inFlightSemaphore] _ in
            inFlightSemaphore.signal()
        }
        let transitionMix = updateArtworkTransition(
            at: ProcessInfo.processInfo.systemUptime
        )
        let activeCurrentArtwork = self.currentArtwork ?? currentArtwork
        let activePreviousArtwork = previousArtwork ?? activeCurrentArtwork
        drawArtwork(
            current: activeCurrentArtwork,
            previous: activePreviousArtwork,
            transitionMix: transitionMix,
            target: targets.rotation,
            commandBuffer: commandBuffer
        )
        drawBackdrop(targets: targets, commandBuffer: commandBuffer)
        drawMaterial(
            source: targets.backdrop,
            target: targets.material,
            mesh: mesh,
            portrait: targets.material.height >= targets.material.width,
            commandBuffer: commandBuffer
        )
        let output: PearWallRenderTarget
        if configuration.moruStyle == .off {
            output = targets.material
        } else {
            drawMoru(
                source: targets.material,
                target: targets.moru,
                artworkAspect: activeCurrentArtwork.aspect,
                style: configuration.moruStyle,
                commandBuffer: commandBuffer
            )
            output = targets.moru
        }
        drawOutput(
            source: output,
            descriptor: descriptor,
            commandBuffer: commandBuffer
        )
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    private static func makePipeline(
        device: MTLDevice,
        library: MTLLibrary,
        vertex: String,
        fragment: String,
        pixelFormat: MTLPixelFormat
    ) throws -> MTLRenderPipelineState {
        guard let vertexFunction = library.makeFunction(name: vertex),
              let fragmentFunction = library.makeFunction(name: fragment) else {
            throw NSError(domain: "PearWallMetal", code: 4)
        }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertexFunction
        descriptor.fragmentFunction = fragmentFunction
        descriptor.colorAttachments[0].pixelFormat = pixelFormat
        return try device.makeRenderPipelineState(descriptor: descriptor)
    }

    private static func loadMoruTextures(
        bundle: Bundle,
        textureLoader: MTKTextureLoader
    ) throws -> [PearWallMoruStyle: PearWallMoruTextures] {
        let options: [MTKTextureLoader.Option: Any] = [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.topLeft.rawValue,
            .generateMipmaps: true,
        ]
        var textures = [PearWallMoruStyle: PearWallMoruTextures]()
        for style in [PearWallMoruStyle.narrow, .wide, .smooth] {
            let suffix = style.rawValue.lowercased()
            guard let normalURL = bundle.url(
                      forResource: "moru_\(suffix)",
                      withExtension: "png",
                      subdirectory: "assets/moru"
                  ),
                  let lightURL = bundle.url(
                      forResource: "depth_light_shadow_\(suffix)",
                      withExtension: "png",
                      subdirectory: "assets/moru"
                  ) else {
                throw NSError(domain: "PearWallMetal", code: 5)
            }
            textures[style] = PearWallMoruTextures(
                normal: try textureLoader.newTexture(URL: normalURL, options: options),
                light: try textureLoader.newTexture(URL: lightURL, options: options)
            )
        }
        return textures
    }

    private func ensureTargets(
        view: MTKView,
        device: MTLDevice
    ) -> PearWallRenderTargets? {
        let drawableWidth = max(1, Int(view.drawableSize.width.rounded()))
        let drawableHeight = max(1, Int(view.drawableSize.height.rounded()))
        let requestedPixels = drawableWidth * drawableHeight
        let budgetScale = requestedPixels > Self.maximumScreenSaverPixels
            ? sqrt(Double(Self.maximumScreenSaverPixels) / Double(requestedPixels))
            : 1
        let outputWidth = max(
            1,
            Int(
                (Double(drawableWidth) * budgetScale * Double(configuration.renderScale))
                    .rounded()
            )
        )
        let outputHeight = max(
            1,
            Int(
                (Double(drawableHeight) * budgetScale * Double(configuration.renderScale))
                    .rounded()
            )
        )
        let size = PearWallRenderSize(
            drawableWidth: drawableWidth,
            drawableHeight: drawableHeight,
            outputWidth: outputWidth,
            outputHeight: outputHeight
        )
        if renderSize == size, let targets {
            return targets
        }
        let backdropWidth = max(1, outputWidth / Self.blurDownsample)
        let backdropHeight = max(1, outputHeight / Self.blurDownsample)
        guard let rotation = makeTarget(
                  device: device,
                  width: backdropWidth,
                  height: backdropHeight
              ),
              let half = makeTarget(
                  device: device,
                  width: max(1, backdropWidth / 2),
                  height: max(1, backdropHeight / 2)
              ),
              let quarter = makeTarget(
                  device: device,
                  width: max(1, backdropWidth / 4),
                  height: max(1, backdropHeight / 4)
              ),
              let eighth = makeTarget(
                  device: device,
                  width: max(1, backdropWidth / 8),
                  height: max(1, backdropHeight / 8)
              ),
              let backdrop = makeTarget(
                  device: device,
                  width: backdropWidth,
                  height: backdropHeight
              ),
              let material = makeTarget(
                  device: device,
                  width: outputWidth,
                  height: outputHeight
              ),
              let moru = makeTarget(
                  device: device,
                  width: outputWidth,
                  height: outputHeight
              ) else {
            return nil
        }
        let nextTargets = PearWallRenderTargets(
            rotation: rotation,
            half: half,
            quarter: quarter,
            eighth: eighth,
            backdrop: backdrop,
            material: material,
            moru: moru
        )
        renderSize = size
        targets = nextTargets
        return nextTargets
    }

    private func makeTarget(
        device: MTLDevice,
        width: Int,
        height: Int
    ) -> PearWallRenderTarget? {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm,
            width: width,
            height: height,
            mipmapped: false
        )
        descriptor.storageMode = .private
        descriptor.usage = [.renderTarget, .shaderRead]
        guard let texture = device.makeTexture(descriptor: descriptor) else {
            return nil
        }
        return PearWallRenderTarget(texture: texture, width: width, height: height)
    }

    private func ensureMesh(
        view: MTKView,
        device: MTLDevice
    ) -> PearWallMeshGeometry? {
        let portrait = view.drawableSize.height >= view.drawableSize.width
        if meshPortrait != portrait {
            randomPresetIndex = nil
            meshPresetIndex = -1
        }
        let presetCount = portrait ? 4 : 5
        let configuredPreset = portrait
            ? configuration.portraitPreset
            : configuration.landscapePreset
        let selectedPreset: Int
        if configuration.randomPreset {
            if randomPresetIndex == nil {
                randomPresetIndex = Int.random(in: 0..<presetCount)
            }
            selectedPreset = randomPresetIndex ?? 0
        } else {
            selectedPreset = configuredPreset
        }
        if meshPortrait == portrait,
           meshPresetIndex == selectedPreset,
           let mesh {
            return mesh
        }
        guard let nextMesh = try? meshLibrary.makeGeometry(
            device: device,
            portrait: portrait,
            presetIndex: selectedPreset
        ) else {
            return nil
        }
        mesh = nextMesh
        meshPortrait = portrait
        meshPresetIndex = selectedPreset
        return nextMesh
    }

    private func drawArtwork(
        current: PearWallArtworkTexture,
        previous: PearWallArtworkTexture,
        transitionMix: Float,
        target: PearWallRenderTarget,
        commandBuffer: MTLCommandBuffer
    ) {
        guard let encoder = commandBuffer.makeRenderCommandEncoder(
            descriptor: renderPassDescriptor(target: target)
        ) else {
            return
        }
        let viewAspect = Float(target.width) / Float(max(1, target.height))
        var currentTextureScale = aspectFillTextureScale(
            artworkAspect: current.aspect,
            viewAspect: viewAspect
        )
        var previousTextureScale = aspectFillTextureScale(
            artworkAspect: previous.aspect,
            viewAspect: viewAspect
        )
        var viewScale = rotationViewScale(aspect: viewAspect)
        var time = animationTime
        var imageScale = 1
            + Self.imagePulseIntensity * configuration.audioIntensity * audioPulse * audioPulse
        var mix = transitionMix
        encoder.setRenderPipelineState(artworkPipeline)
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
        encoder.setFragmentTexture(current.texture, index: 0)
        encoder.setFragmentTexture(previous.texture, index: 1)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentBytes(&mix, length: MemoryLayout<Float>.stride, index: 0)

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
    }

    private func drawBackdrop(
        targets: PearWallRenderTargets,
        commandBuffer: MTLCommandBuffer
    ) {
        guard configuration.blurEnabled else {
            drawBlur(
                source: targets.rotation,
                target: targets.backdrop,
                offset: 0,
                upsample: false,
                commandBuffer: commandBuffer
            )
            return
        }
        let offset = 24 * configuration.blurMultiplier / Self.kawaseSigmaPerOffset
        drawBlur(
            source: targets.rotation,
            target: targets.half,
            offset: offset,
            upsample: false,
            commandBuffer: commandBuffer
        )
        drawBlur(
            source: targets.half,
            target: targets.quarter,
            offset: offset,
            upsample: false,
            commandBuffer: commandBuffer
        )
        drawBlur(
            source: targets.quarter,
            target: targets.eighth,
            offset: offset,
            upsample: false,
            commandBuffer: commandBuffer
        )
        drawBlur(
            source: targets.eighth,
            target: targets.quarter,
            offset: offset,
            upsample: true,
            commandBuffer: commandBuffer
        )
        drawBlur(
            source: targets.quarter,
            target: targets.half,
            offset: offset,
            upsample: true,
            commandBuffer: commandBuffer
        )
        drawBlur(
            source: targets.half,
            target: targets.backdrop,
            offset: offset,
            upsample: true,
            commandBuffer: commandBuffer
        )
    }

    private func drawBlur(
        source: PearWallRenderTarget,
        target: PearWallRenderTarget,
        offset: Float,
        upsample: Bool,
        commandBuffer: MTLCommandBuffer
    ) {
        guard let encoder = commandBuffer.makeRenderCommandEncoder(
            descriptor: renderPassDescriptor(target: target)
        ) else {
            return
        }
        var texelSize = SIMD2(
            1 / Float(max(1, source.width)),
            1 / Float(max(1, source.height))
        )
        var requestedOffset = offset
        var shouldUpsample = UInt32(upsample ? 1 : 0)
        encoder.setRenderPipelineState(blurPipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(source.texture, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentBytes(
            &texelSize,
            length: MemoryLayout<SIMD2<Float>>.stride,
            index: 0
        )
        encoder.setFragmentBytes(
            &requestedOffset,
            length: MemoryLayout<Float>.stride,
            index: 1
        )
        encoder.setFragmentBytes(
            &shouldUpsample,
            length: MemoryLayout<UInt32>.stride,
            index: 2
        )
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
    }

    private func drawMaterial(
        source: PearWallRenderTarget,
        target: PearWallRenderTarget,
        mesh: PearWallMeshGeometry,
        portrait: Bool,
        commandBuffer: MTLCommandBuffer
    ) {
        guard let encoder = commandBuffer.makeRenderCommandEncoder(
            descriptor: renderPassDescriptor(target: target)
        ) else {
            return
        }
        var scrimAlpha = configuration.scrimAlpha
            * (configuration.moruStyle == .off ? 1 : 0.5)
        encoder.setFragmentTexture(source.texture, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentBytes(
            &scrimAlpha,
            length: MemoryLayout<Float>.stride,
            index: 0
        )
        if portrait {
            encoder.setRenderPipelineState(materialFullscreenPipeline)
            encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        }

        var time = animationTime
        var textureTransform = portrait
            ? SIMD4<Float>(1, 1, 0, 0)
            : SIMD4<Float>(0.8, 0.8, 0.1, 0.1)
        encoder.setRenderPipelineState(materialMeshPipeline)
        encoder.setVertexBuffer(mesh.vertexBuffer, offset: 0, index: 0)
        encoder.setVertexBytes(&time, length: MemoryLayout<Float>.stride, index: 1)
        encoder.setVertexBytes(
            &textureTransform,
            length: MemoryLayout<SIMD4<Float>>.stride,
            index: 2
        )
        encoder.drawIndexedPrimitives(
            type: .triangle,
            indexCount: mesh.indexCount,
            indexType: .uint16,
            indexBuffer: mesh.indexBuffer,
            indexBufferOffset: 0
        )
        encoder.endEncoding()
    }

    private func drawMoru(
        source: PearWallRenderTarget,
        target: PearWallRenderTarget,
        artworkAspect: Float,
        style: PearWallMoruStyle,
        commandBuffer: MTLCommandBuffer
    ) {
        guard let textures = moruTextures[style],
              let encoder = commandBuffer.makeRenderCommandEncoder(
                  descriptor: renderPassDescriptor(target: target)
              ) else {
            return
        }
        let screenAspect = Float(target.width) / Float(max(1, target.height))
        let scale: Float
        let iorValue: Float
        let displacementValue: Float
        let thicknessValue: Float
        switch style {
        case .narrow:
            scale = 0.15
            iorValue = 0.68
            displacementValue = 0.36
            thicknessValue = 0.3
        case .wide:
            scale = 0.31
            iorValue = 0.58
            displacementValue = 0.58
            thicknessValue = 0.36
        case .smooth:
            scale = 0.24
            iorValue = 0.6
            displacementValue = 0.37
            thicknessValue = 0.06
        case .off:
            encoder.endEncoding()
            return
        }
        var aspect = 1 / max(artworkAspect, 0.001)
        var normalScale = 1 / scale
        var ior = iorValue
        var surfaceRatio = min(screenAspect, 1 / max(screenAspect, 0.001))
        var displacement = displacementValue
        var thickness = thicknessValue
        var darkness: Float = style == .wide ? 0.1 : 0
        var lightness: Float = style == .wide ? 0.65 : 0.4
        var shadowness: Float = style == .wide ? 0.36 : 1
        encoder.setRenderPipelineState(moruPipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(source.texture, index: 0)
        encoder.setFragmentTexture(textures.normal, index: 1)
        encoder.setFragmentTexture(textures.light, index: 2)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentBytes(&aspect, length: MemoryLayout<Float>.stride, index: 0)
        encoder.setFragmentBytes(
            &normalScale,
            length: MemoryLayout<Float>.stride,
            index: 1
        )
        encoder.setFragmentBytes(&ior, length: MemoryLayout<Float>.stride, index: 2)
        encoder.setFragmentBytes(
            &surfaceRatio,
            length: MemoryLayout<Float>.stride,
            index: 3
        )
        encoder.setFragmentBytes(
            &displacement,
            length: MemoryLayout<Float>.stride,
            index: 4
        )
        encoder.setFragmentBytes(
            &thickness,
            length: MemoryLayout<Float>.stride,
            index: 5
        )
        encoder.setFragmentBytes(
            &darkness,
            length: MemoryLayout<Float>.stride,
            index: 6
        )
        encoder.setFragmentBytes(
            &lightness,
            length: MemoryLayout<Float>.stride,
            index: 7
        )
        encoder.setFragmentBytes(
            &shadowness,
            length: MemoryLayout<Float>.stride,
            index: 8
        )
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
    }

    private func drawOutput(
        source: PearWallRenderTarget,
        descriptor: MTLRenderPassDescriptor,
        commandBuffer: MTLCommandBuffer
    ) {
        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }
        encoder.setRenderPipelineState(copyPipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(source.texture, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
    }

    private func renderPassDescriptor(
        target: PearWallRenderTarget
    ) -> MTLRenderPassDescriptor {
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = target.texture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1)
        return descriptor
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
        viewAspect: Float
    ) -> SIMD2<Float> {
        guard viewAspect > 0, artworkAspect > 0 else { return SIMD2(1, 1) }
        if artworkAspect > viewAspect {
            return SIMD2(viewAspect / artworkAspect, 1)
        }
        return SIMD2(1, artworkAspect / viewAspect)
    }

    private func rotationViewScale(aspect: Float) -> SIMD2<Float> {
        guard aspect > 0 else { return SIMD2(1, 1) }
        return aspect >= 1 ? SIMD2(1, aspect) : SIMD2(1 / aspect, 1)
    }
}
