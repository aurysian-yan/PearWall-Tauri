(function () {
  const ARTWORK_TRANSITION_SECONDS = 0.5;
  const IMAGE_PULSE_INTENSITY = 0.08;
  const AUDIO_PULSE_ATTACK_SECONDS = 0.08;
  const AUDIO_PULSE_RELEASE_SECONDS = 0.2;
  const BLUR_DOWNSAMPLE = 4;
  const KAWASE_SIGMA_PER_OFFSET = 16;
  const PORTRAIT = 'portrait';
  const MORU_STYLES = new Set(['OFF', 'NARROW', 'WIDE', 'SMOOTH']);
  const PRESET_COUNTS = { portrait: 4, landscape: 5 };
  const SCREEN_SAVER_MAX_PIXELS = 1920 * 1080;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'shader compile failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'program link failed';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createTarget(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('framebuffer creation failed');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  function deleteTarget(gl, target) {
    if (!target) return;
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }

  function createTexture(gl, color) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(color));
    return texture;
  }

  function updateTexture(gl, texture, image) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function createQuad(gl) {
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    const data = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    return {
      draw() {
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
      },
      destroy() {
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vao);
      },
    };
  }

  class Program {
    constructor(gl, vertexSource, fragmentSource) {
      this.gl = gl;
      this.handle = createProgram(gl, vertexSource, fragmentSource);
      this.uniforms = new Map();
    }

    use() {
      this.gl.useProgram(this.handle);
    }

    location(name) {
      if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.handle, name));
      return this.uniforms.get(name);
    }

    int(name, value) {
      this.gl.uniform1i(this.location(name), value);
    }

    float(name, value) {
      this.gl.uniform1f(this.location(name), value);
    }

    vec2(name, x, y) {
      this.gl.uniform2f(this.location(name), x, y);
    }

    vec3(name, x, y, z) {
      this.gl.uniform3f(this.location(name), x, y, z);
    }

    vec4(name, x, y, z, w) {
      this.gl.uniform4f(this.location(name), x, y, z, w);
    }

    destroy() {
      this.gl.deleteProgram(this.handle);
    }
  }

  class PearWallRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
      if (!this.gl) throw new Error('WebGL2 is unavailable');
      this.settings = {
        audioIntensity: 1,
        renderScale: 0.75,
        blurEnabled: true,
        blurMultiplier: 1,
        scrimAlpha: 0.4,
        flowSpeed: 'NORMAL',
        moruStyle: 'OFF',
        portraitPreset: 0,
        landscapePreset: 0,
        randomPreset: false,
        distortionStrength: 1,
      };
      this.surfaceWidth = 0;
      this.surfaceHeight = 0;
      this.outputWidth = 0;
      this.outputHeight = 0;
      this.orientation = PORTRAIT;
      this.meshPresetIndex = -1;
      this.meshDistortionStrength = -1;
      this.randomPresetIndex = -1;
      this.mesh = null;
      this.targets = {};
      this.animationTime = 0;
      this.smoothedAudioPulse = 0;
      this.lastAudioPulseTimestamp = 0;
      this.artworkAspect = 1;
      this.currentArtwork = createTexture(this.gl, [0, 0, 0, 255]);
      this.previousArtwork = this.currentArtwork;
      this.artworkTransitionStart = -Infinity;
      this.pendingArtwork = null;
      this.requestedArtworkSource = '';
      this.moruTextures = {
        NARROW: [createTexture(this.gl, [128, 255, 128, 255]), createTexture(this.gl, [0, 0, 255, 255])],
        WIDE: [createTexture(this.gl, [128, 255, 128, 255]), createTexture(this.gl, [0, 0, 255, 255])],
        SMOOTH: [createTexture(this.gl, [128, 255, 128, 255]), createTexture(this.gl, [0, 0, 255, 255])],
      };
      this.quad = createQuad(this.gl);
      const shaders = window.PearWallShaders;
      this.rotationProgram = new Program(this.gl, shaders.rotationVert, shaders.rotationFrag);
      this.blurProgram = new Program(this.gl, shaders.fullscreenVert, shaders.blurFrag);
      this.fullscreenMaterialProgram = new Program(this.gl, shaders.fullscreenVert, shaders.materialFrag);
      this.pinchMaterialProgram = new Program(this.gl, shaders.pinchVert, shaders.materialFrag);
      this.moruProgram = new Program(this.gl, shaders.fullscreenVert, shaders.moruFrag);
      this.gl.disable(this.gl.DEPTH_TEST);
      this.gl.disable(this.gl.CULL_FACE);
      this.gl.disable(this.gl.BLEND);
      this.gl.clearColor(0, 0, 0, 1);
      this.loadMoruTextures();
    }

    setSettings(settings) {
      const nextSettings = { ...this.settings, ...settings };
      if (this.settings.randomPreset !== nextSettings.randomPreset) this.randomPresetIndex = -1;
      if (!MORU_STYLES.has(nextSettings.moruStyle)) nextSettings.moruStyle = 'OFF';
      this.settings = nextSettings;
      this.ensureSize(this.surfaceWidth, this.surfaceHeight);
    }

    setArtworkSource(source) {
      if (!source || source === this.requestedArtworkSource) return;
      this.requestedArtworkSource = source;
      const image = new Image();
      if (/^https?:/i.test(source)) image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (this.requestedArtworkSource !== source) return;
        this.artworkAspect = image.width / Math.max(1, image.height);
        if (Number.isFinite(this.artworkTransitionStart)) {
          this.pendingArtwork = image;
        } else {
          this.startArtworkTransition(image, performance.now() / 1000);
        }
      };
      image.onerror = () => {
        if (this.requestedArtworkSource === source) this.requestedArtworkSource = '';
      };
      image.src = source;
    }

    loadMoruTextures() {
      for (const style of ['NARROW', 'WIDE', 'SMOOTH']) {
        const [normal, light] = this.moruTextures[style];
        const normalImage = new Image();
        normalImage.onload = () => updateTexture(this.gl, normal, normalImage);
        normalImage.src = `assets/moru/moru_${style.toLowerCase()}.png`;
        const lightImage = new Image();
        lightImage.onload = () => updateTexture(this.gl, light, lightImage);
        lightImage.src = `assets/moru/depth_light_shadow_${style.toLowerCase()}.png`;
      }
    }

    startArtworkTransition(image, timestamp) {
      if (this.currentArtwork === this.previousArtwork) this.previousArtwork = this.currentArtwork;
      const texture = createTexture(this.gl, [0, 0, 0, 255]);
      updateTexture(this.gl, texture, image);
      this.previousArtwork = this.currentArtwork;
      this.currentArtwork = texture;
      this.artworkTransitionStart = timestamp;
    }

    getTransitionMix(timestamp) {
      if (!Number.isFinite(this.artworkTransitionStart)) return 1;
      const progress = clamp((timestamp - this.artworkTransitionStart) / ARTWORK_TRANSITION_SECONDS, 0, 1);
      if (progress < 1) return progress;
      if (this.previousArtwork !== this.currentArtwork) this.gl.deleteTexture(this.previousArtwork);
      this.previousArtwork = this.currentArtwork;
      this.artworkTransitionStart = -Infinity;
      if (this.pendingArtwork) {
        const next = this.pendingArtwork;
        this.pendingArtwork = null;
        this.startArtworkTransition(next, timestamp);
        return 0;
      }
      return 1;
    }

    ensureSize(width, height) {
      if (!width || !height) return;
      const nextOrientation = height >= width ? PORTRAIT : 'landscape';
      const orientationChanged = this.orientation !== nextOrientation;
      let nextPreset = nextOrientation === PORTRAIT ? this.settings.portraitPreset : this.settings.landscapePreset;
      if (this.settings.randomPreset && (this.randomPresetIndex < 0 || orientationChanged)) {
        this.randomPresetIndex = Math.floor(Math.random() * PRESET_COUNTS[nextOrientation]);
      }
      if (this.settings.randomPreset) nextPreset = this.randomPresetIndex;
      const distortionStrength = clamp(Number(this.settings.distortionStrength) || 0, 0, 1.5);
      if (
        !this.mesh
        || this.orientation !== nextOrientation
        || this.meshPresetIndex !== nextPreset
        || this.meshDistortionStrength !== distortionStrength
      ) {
        if (this.mesh) this.mesh.destroy();
        this.orientation = nextOrientation;
        this.meshPresetIndex = nextPreset;
        this.meshDistortionStrength = distortionStrength;
        this.mesh = new window.PearWallMesh.MeshGeometry(this.gl, window.PearWallMesh.createMesh(
          nextOrientation === PORTRAIT,
          nextPreset,
          distortionStrength,
        ));
      }
      const outputWidth = Math.max(1, Math.round(width * this.settings.renderScale));
      const outputHeight = Math.max(1, Math.round(height * this.settings.renderScale));
      if (width === this.surfaceWidth && height === this.surfaceHeight && outputWidth === this.outputWidth && outputHeight === this.outputHeight) return;
      this.surfaceWidth = width;
      this.surfaceHeight = height;
      this.outputWidth = outputWidth;
      this.outputHeight = outputHeight;
      for (const target of Object.values(this.targets)) deleteTarget(this.gl, target);
      const backdropWidth = Math.max(1, Math.floor(outputWidth / BLUR_DOWNSAMPLE));
      const backdropHeight = Math.max(1, Math.floor(outputHeight / BLUR_DOWNSAMPLE));
      this.targets.rotation = createTarget(this.gl, backdropWidth, backdropHeight);
      this.targets.half = createTarget(this.gl, Math.max(1, Math.floor(backdropWidth / 2)), Math.max(1, Math.floor(backdropHeight / 2)));
      this.targets.quarter = createTarget(this.gl, Math.max(1, Math.floor(backdropWidth / 4)), Math.max(1, Math.floor(backdropHeight / 4)));
      this.targets.eighth = createTarget(this.gl, Math.max(1, Math.floor(backdropWidth / 8)), Math.max(1, Math.floor(backdropHeight / 8)));
      this.targets.lyrics = createTarget(this.gl, backdropWidth, backdropHeight);
      this.targets.ordinary = createTarget(this.gl, backdropWidth, backdropHeight);
      this.targets.material = outputWidth === width && outputHeight === height ? null : createTarget(this.gl, outputWidth, outputHeight);
      this.targets.moru = createTarget(this.gl, outputWidth, outputHeight);
    }

    bindTarget(target) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target ? target.framebuffer : null);
      this.gl.viewport(0, 0, target ? target.width : this.surfaceWidth, target ? target.height : this.surfaceHeight);
    }

    bindTexture(slot, texture) {
      this.gl.activeTexture(this.gl.TEXTURE0 + slot);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    }

    drawBackdrop(imageScale, blurSigma, time, transitionMix, target) {
      const gl = this.gl;
      const rotation = this.targets.rotation;
      this.bindTarget(rotation);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.rotationProgram.use();
      this.rotationProgram.float('uTime', time * (this.settings.flowSpeed === 'FAST' ? 2 : 1));
      const aspect = rotation.width / rotation.height;
      this.rotationProgram.vec2('uViewScale', aspect >= 1 ? 1 : 1 / aspect, aspect >= 1 ? aspect : 1);
      this.rotationProgram.vec3('uImageScales', imageScale, imageScale, imageScale);
      this.rotationProgram.float('uTransitionMix', transitionMix);
      this.rotationProgram.int('uCurrentArtwork', 0);
      this.rotationProgram.int('uPreviousArtwork', 1);
      this.bindTexture(0, this.currentArtwork);
      this.bindTexture(1, this.previousArtwork);
      this.rotationProgram.int('uArtworkFill', 1);
      this.rotationProgram.int('uInstance', 0);
      this.quad.draw();
      this.rotationProgram.int('uArtworkFill', 0);
      for (let instance = 0; instance < 3; instance += 1) {
        this.rotationProgram.int('uInstance', instance);
        this.quad.draw();
      }
      if (!this.settings.blurEnabled) {
        this.kawasePass(rotation, target, 0, false);
        return;
      }
      const offset = blurSigma / KAWASE_SIGMA_PER_OFFSET;
      this.kawasePass(rotation, this.targets.half, offset, false);
      this.kawasePass(this.targets.half, this.targets.quarter, offset, false);
      this.kawasePass(this.targets.quarter, this.targets.eighth, offset, false);
      this.kawasePass(this.targets.eighth, this.targets.quarter, offset, true);
      this.kawasePass(this.targets.quarter, this.targets.half, offset, true);
      this.kawasePass(this.targets.half, target, offset, true);
    }

    kawasePass(source, target, offset, upsample) {
      this.bindTarget(target);
      this.blurProgram.use();
      this.blurProgram.int('uSource', 0);
      this.blurProgram.vec2('uTexelSize', 1 / source.width, 1 / source.height);
      this.blurProgram.float('uOffset', offset);
      this.blurProgram.int('uUpsample', upsample ? 1 : 0);
      this.bindTexture(0, source.texture);
      this.quad.draw();
    }

    setMaterialUniforms(program, mode, modeMix, moruStyle) {
      program.use();
      program.int('uLyricsBackdrop', 0);
      program.int('uOrdinaryBackdrop', 1);
      program.float('uBlackScrimAlpha', this.settings.scrimAlpha * (moruStyle === 'OFF' ? 1 : 0.5));
      program.float('uLyricsModeMix', modeMix);
      program.float('uDitherStrength', 1);
      program.int('uMaterialMode', mode);
    }

    drawFullscreenMaterial(mode, modeMix, moruStyle) {
      this.setMaterialUniforms(this.fullscreenMaterialProgram, mode, modeMix, moruStyle);
      this.quad.draw();
    }

    drawPinchMaterial(mode, modeMix, time, moruStyle) {
      this.setMaterialUniforms(this.pinchMaterialProgram, mode, modeMix, moruStyle);
      this.pinchMaterialProgram.float('uTime', time);
      if (this.orientation === PORTRAIT) this.pinchMaterialProgram.vec4('uTextureTransform', 1, 1, 0, 0);
      else this.pinchMaterialProgram.vec4('uTextureTransform', 0.8, 0.8, 0.1, 0.1);
      this.mesh.draw();
    }

    renderMaterial(lyricTexture, ordinaryTexture, modeMix, time) {
      const moruStyle = MORU_STYLES.has(this.settings.moruStyle) ? this.settings.moruStyle : 'OFF';
      const destination = moruStyle === 'OFF' ? this.targets.material : this.targets.moru;
      this.bindTarget(destination);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.bindTexture(0, lyricTexture);
      this.bindTexture(1, ordinaryTexture);
      if (modeMix <= 0) this.drawFullscreenMaterial(0, modeMix, moruStyle);
      else if (modeMix >= 1) {
        if (this.orientation === PORTRAIT) this.drawFullscreenMaterial(1, modeMix, moruStyle);
        this.drawPinchMaterial(1, modeMix, time, moruStyle);
      } else {
        this.drawFullscreenMaterial(this.orientation === PORTRAIT ? 2 : 3, modeMix, moruStyle);
        this.drawPinchMaterial(2, modeMix, time, moruStyle);
      }
      if (moruStyle !== 'OFF') this.renderMoru(this.targets.moru.texture, moruStyle);
      else if (destination) this.blitToScreen(destination);
    }

    renderMoru(source, style) {
      const gl = this.gl;
      this.bindTarget(null);
      this.moruProgram.use();
      this.moruProgram.int('uSource', 0);
      this.moruProgram.int('uNormal', 1);
      this.moruProgram.int('uLight', 2);
      this.moruProgram.int('uStyle', { NARROW: 1, WIDE: 2, SMOOTH: 3 }[style] || 0);
      const screenAspect = this.surfaceWidth / Math.max(1, this.surfaceHeight);
      const normalScale = { NARROW: 0.15, WIDE: 0.31, SMOOTH: 0.24 }[style] || 1;
      this.moruProgram.float('uAspect', 1 / this.artworkAspect);
      this.moruProgram.float('uNormalScale', 1 / normalScale);
      this.moruProgram.float('uIor', { NARROW: 0.68, WIDE: 0.58, SMOOTH: 0.6 }[style] || 1);
      this.moruProgram.float('uSurfaceRatio', Math.min(screenAspect, 1 / screenAspect));
      this.moruProgram.float('uDisplacement', { NARROW: 0.36, WIDE: 0.58, SMOOTH: 0.37 }[style] || 0);
      this.moruProgram.float('uThickness', { NARROW: 0.3, WIDE: 0.36, SMOOTH: 0.06 }[style] || 0);
      this.moruProgram.float('uDarkness', style === 'WIDE' ? 0.1 : 0);
      this.moruProgram.float('uLightness', style === 'WIDE' ? 0.65 : 0.4);
      this.moruProgram.float('uShadowness', style === 'WIDE' ? 0.36 : 1);
      this.bindTexture(0, source);
      this.bindTexture(1, this.moruTextures[style][0]);
      this.bindTexture(2, this.moruTextures[style][1]);
      this.quad.draw();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    blitToScreen(source) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, source.width, source.height, 0, 0, this.surfaceWidth, this.surfaceHeight, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    render(time, pulse) {
      if (!this.surfaceWidth || !this.surfaceHeight) return;
      this.ensureSize(this.surfaceWidth, this.surfaceHeight);
      const timestamp = performance.now() / 1000;
      const pulseDelta = this.lastAudioPulseTimestamp
        ? clamp(timestamp - this.lastAudioPulseTimestamp, 0, 0.1)
        : 1 / 60;
      const pulseResponse = pulse > this.smoothedAudioPulse
        ? AUDIO_PULSE_ATTACK_SECONDS
        : AUDIO_PULSE_RELEASE_SECONDS;
      const pulseAmount = 1 - Math.exp(-pulseDelta / pulseResponse);
      this.smoothedAudioPulse = lerp(this.smoothedAudioPulse, pulse, pulseAmount);
      this.lastAudioPulseTimestamp = timestamp;
      const transitionMix = this.getTransitionMix(timestamp);
      const blurSigma = 24 * this.settings.blurMultiplier;
      this.drawBackdrop(
        1 + IMAGE_PULSE_INTENSITY
          * this.settings.audioIntensity
          * this.smoothedAudioPulse
          * this.smoothedAudioPulse,
        blurSigma,
        time,
        transitionMix,
        this.targets.lyrics,
      );
      this.renderMaterial(this.targets.lyrics.texture, this.targets.lyrics.texture, 1, time);
    }

    exportPixels(options) {
      const width = Math.round(options.width);
      const height = Math.round(options.height);
      const previousCanvasWidth = this.canvas.width;
      const previousCanvasHeight = this.canvas.height;
      const previousSurfaceWidth = this.surfaceWidth;
      const previousSurfaceHeight = this.surfaceHeight;
      const previousSettings = this.settings;
      const previousPulse = this.smoothedAudioPulse;
      const previousPulseTimestamp = this.lastAudioPulseTimestamp;

      try {
        this.canvas.width = width;
        this.canvas.height = height;
        this.settings = {
          ...previousSettings,
          ...options.settings,
          renderScale: 1,
          randomPreset: false,
        };
        this.smoothedAudioPulse = 0;
        this.lastAudioPulseTimestamp = 0;
        this.ensureSize(width, height);
        this.render(options.time, 0);
        this.gl.finish();
        const pixels = new Uint8Array(width * height * 4);
        this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
        if (this.gl.getError() !== this.gl.NO_ERROR) {
          throw new Error('无法读取 WebGL 导出画面');
        }
        return pixels;
      } finally {
        this.canvas.width = previousCanvasWidth;
        this.canvas.height = previousCanvasHeight;
        this.settings = previousSettings;
        this.smoothedAudioPulse = previousPulse;
        this.lastAudioPulseTimestamp = previousPulseTimestamp;
        this.ensureSize(previousSurfaceWidth, previousSurfaceHeight);
      }
    }

    resize() {
      const ratio = window.devicePixelRatio || 1;
      const requestedWidth = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
      const requestedHeight = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
      const requestedPixels = requestedWidth * requestedHeight;
      const budgetScale = window.PearWallNativeFrameDriver && requestedPixels > SCREEN_SAVER_MAX_PIXELS
        ? Math.sqrt(SCREEN_SAVER_MAX_PIXELS / requestedPixels)
        : 1;
      const width = Math.max(1, Math.round(requestedWidth * budgetScale));
      const height = Math.max(1, Math.round(requestedHeight * budgetScale));
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.ensureSize(width, height);
    }
  }

  window.PearWallRenderer = { PearWallRenderer };
}());
