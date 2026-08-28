(function () {
  const canvas = document.getElementById('wallpaper');
  const renderer = new window.PearWallRenderer.PearWallRenderer(canvas);
  const analyzer = new window.PearWallAudio.AppleMusicSpectrumAnalysis();
  const tauriInvoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  const tauriWindowApi = window.__TAURI__ && window.__TAURI__.window;
  const settingsStorageKey = 'pearwall.settings';
  const artworkMissingConfirmationMs = 2500;
  const settings = {
    audioVisualization: false,
    audioIntensity: 1,
    pauseFlow: true,
    pauseArtworkFallback: false,
    hideCursor: true,
    performanceMode: 'MANUAL',
    autoBatterySaverMax: 20,
    autoBatteryBalancedMax: 60,
    renderScale: 0.75,
    blurEnabled: true,
    blurMultiplier: 1,
    scrimAlpha: 0.4,
    flowSpeed: 'NORMAL',
    moruStyle: 'OFF',
    portraitPreset: 0,
    landscapePreset: 0,
    randomPreset: false,
    artworkFallback: 'DEFAULT',
    customArtwork: '',
  };
  let paused = false;
  let playbackPlaying = true;
  let animationTime = 0;
  let lastFrameTime = performance.now();
  let targetFps = 0;
  let lastRenderedAt = 0;
  const rustAudioFrame = {
    previousPulse: 0,
    currentPulse: 0,
    previousUpdatedAt: 0,
    currentUpdatedAt: 0,
  };
  let lastRustAudioPollAt = 0;
  let rustAudioPollPending = false;
  let lastMediaArtworkPollAt = 0;
  let mediaArtworkPollPending = false;
  let nativeAudioPulse = Number.NaN;
  const nativeFrameDriver = Boolean(window.PearWallNativeFrameDriver);
  let nativeArtworkKey = '';
  let watermarkArtworkSource = '';
  let watermarkArtworkImage = null;
  let watermarkArtworkLoadPromise = Promise.resolve(null);
  let resolveWatermarkArtworkLoad = null;
  let mediaArtworkAvailable = false;
  let mediaArtworkSource = '';
  let mediaArtworkMissing = false;
  let mediaArtworkFallbackTimer = 0;
  let desktopArtworkSource = '';
  let desktopArtworkPending = false;
  let desktopArtworkFailed = false;
  let screenSaverMode = false;
  let previewReady = false;
  let performanceStatus = {};
  let performanceMonitor = null;
  const beatLogState = {
    count: 0,
    previousPulse: 0,
    valleyPulse: 1,
    peakPulse: 0,
    peakHasRisen: false,
    lastLogAt: -Infinity,
  };

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    window.setTimeout(() => window.location.reload(), 250);
  }, { once: true });

  renderer.setArtworkSource('assets/default_artwork.svg');

  function savedSettings() {
    try {
      return {
        ...JSON.parse(window.localStorage.getItem(settingsStorageKey) || '{}'),
        ...(window.PearWallScreenSaverSettings || {}),
      };
    } catch (_) {
      return window.PearWallScreenSaverSettings || {};
    }
  }

  function applySettingsValues(values) {
    if (!values || typeof values !== 'object') return;
    const properties = {};
    for (const [key, value] of Object.entries(values)) properties[key] = { value };
    applyUserProperties(properties);
  }

  function audioTimestampSeconds() {
    return tauriInvoke ? Date.now() / 1000 : performance.now() / 1000;
  }

  function pollRustAudio(timestamp) {
    if (!tauriInvoke || !settings.audioVisualization || !playbackPlaying) return;
    if (rustAudioPollPending || timestamp - lastRustAudioPollAt < 50) return;
    lastRustAudioPollAt = timestamp;
    rustAudioPollPending = true;
    tauriInvoke('get_audio_pulse', { timestampSeconds: audioTimestampSeconds() })
      .then((pulse) => {
        updateRustAudioPulse(pulse);
      })
      .catch(() => {})
      .finally(() => {
        rustAudioPollPending = false;
      });
  }

  function updateRustAudioPulse(pulse) {
    const value = Math.max(0, Math.min(1, Number(pulse) || 0));
    const receivedAt = performance.now();
    if (!rustAudioFrame.currentUpdatedAt) {
      rustAudioFrame.previousPulse = value;
      rustAudioFrame.previousUpdatedAt = receivedAt;
    } else {
      rustAudioFrame.previousPulse = rustAudioFrame.currentPulse;
      rustAudioFrame.previousUpdatedAt = rustAudioFrame.currentUpdatedAt;
    }
    rustAudioFrame.currentPulse = value;
    rustAudioFrame.currentUpdatedAt = receivedAt;
  }

  function interpolatedRustAudioPulse(timestamp) {
    if (!rustAudioFrame.currentUpdatedAt || timestamp - rustAudioFrame.currentUpdatedAt > 250) {
      return 0;
    }
    const reportMilliseconds = rustAudioFrame.currentUpdatedAt - rustAudioFrame.previousUpdatedAt;
    if (reportMilliseconds <= 0) return rustAudioFrame.currentPulse;
    const sampleTimestamp = timestamp - reportMilliseconds;
    const amount = Math.max(0, Math.min(
      1,
      (sampleTimestamp - rustAudioFrame.previousUpdatedAt) / reportMilliseconds,
    ));
    return rustAudioFrame.previousPulse
      + (rustAudioFrame.currentPulse - rustAudioFrame.previousPulse) * amount;
  }

  function resetRustAudioPulse() {
    rustAudioFrame.previousPulse = 0;
    rustAudioFrame.currentPulse = 0;
    rustAudioFrame.previousUpdatedAt = 0;
    rustAudioFrame.currentUpdatedAt = 0;
  }

  function logBeat(pulse, timestamp, source) {
    const value = Math.max(0, Math.min(1, Number(pulse) || 0));
    const state = beatLogState;
    state.valleyPulse = Math.min(state.valleyPulse, value);
    if (value >= state.peakPulse) {
      if (value > state.previousPulse) state.peakHasRisen = true;
      state.peakPulse = value;
    }
    const peakFinished = state.peakHasRisen
      && value < state.previousPulse
      && state.peakPulse - value >= 0.04
      && state.peakPulse - state.valleyPulse >= 0.08;
    if (peakFinished && state.peakPulse >= 0.15 && timestamp - state.lastLogAt >= 160) {
      state.count += 1;
      const scale = 1 + 0.08 * settings.audioIntensity * state.peakPulse * state.peakPulse;
      console.info(
        `[Pear Wall 音频] 鼓点 #${state.count} source=${source} pulse=${state.peakPulse.toFixed(3)} intensity=${settings.audioIntensity.toFixed(1)} scale=${scale.toFixed(3)}`,
      );
      state.lastLogAt = timestamp;
      state.valleyPulse = value;
      state.peakPulse = value;
      state.peakHasRisen = false;
    }
    state.previousPulse = value;
  }

  function enableScreenSaverExit() {
    if (!tauriInvoke || !tauriWindowApi || typeof tauriWindowApi.getCurrentWindow !== 'function') return;
    tauriInvoke('is_screen_saver_mode').then((enabled) => {
      screenSaverMode = Boolean(enabled);
      applyCursorVisibility();
      if (!enabled) return;
      const startedAt = performance.now();
      const gracePeriod = 700;
      const mouseDistance = 6;
      let initialPointer = null;
      let exiting = false;
      const exit = () => {
        if (exiting || performance.now() - startedAt < gracePeriod) return;
        exiting = true;
        tauriInvoke('exit_screen_saver').catch(() => (
          tauriWindowApi.getCurrentWindow().close().catch(() => {
            exiting = false;
          })
        ));
      };
      window.addEventListener('mousemove', (event) => {
        const pointer = { x: event.screenX, y: event.screenY };
        if (!initialPointer || performance.now() - startedAt < gracePeriod) {
          initialPointer = pointer;
          return;
        }
        if (
          Math.abs(pointer.x - initialPointer.x) >= mouseDistance
          || Math.abs(pointer.y - initialPointer.y) >= mouseDistance
        ) exit();
      });
      window.addEventListener('mousedown', exit);
      window.addEventListener('keydown', exit);
      window.addEventListener('touchstart', exit);
    }).catch(() => {});
  }

  function applyCursorVisibility() {
    const cursor = settings.hideCursor && screenSaverMode ? 'none' : '';
    document.documentElement.style.cursor = cursor;
    document.body.style.cursor = cursor;
    canvas.style.cursor = cursor;
  }

  function applyEffectiveSettings() {
    const resolver = window.PearWallPerformance;
    const resolution = resolver
      ? resolver.effectiveSettings(settings, performanceStatus)
      : { settings, quality: null };
    renderer.setSettings(resolution.settings);
  }

  if (window.PearWallPerformance) {
    performanceMonitor = window.PearWallPerformance.createMonitor((status) => {
      performanceStatus = status;
      applyEffectiveSettings();
    });
    performanceStatus = performanceMonitor.status();
  }

  window.PearWallSetScreenSaverMode = (enabled) => {
    screenSaverMode = Boolean(enabled);
    applyCursorVisibility();
  };

  function booleanValue(property, fallback) {
    if (!property || property.value === undefined) return fallback;
    return Boolean(property.value);
  }

  function numberValue(property, fallback) {
    const value = Number(property && property.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function stringValue(property, fallback) {
    if (!property || property.value === undefined || property.value === null) return fallback;
    return String(property.value);
  }

  function moruStyleValue(property, fallback) {
    const value = stringValue(property, fallback).toUpperCase();
    if (value === 'ON' || value === 'TRUE' || value === '1') return 'NARROW';
    if (value === 'OFF' || value === 'NARROW' || value === 'WIDE' || value === 'SMOOTH') return value;
    return fallback;
  }

  function artworkSource(value) {
    if (!value) return '';
    const source = String(value);
    if (source.startsWith('data:') || source.startsWith('file:') || source.startsWith('http:') || source.startsWith('https:')) return source;
    return `data:image/png;base64,${source}`;
  }

  function fileArtworkSource(value) {
    if (!value) return '';
    if (/^(data:|blob:|https?:|file:)/i.test(String(value))) return String(value);
    const source = String(value).replace(/\\/g, '/');
    return source.startsWith('file:') ? source : `file:///${source}`;
  }

  function clearMediaArtworkFallbackTimer() {
    if (!mediaArtworkFallbackTimer) return;
    window.clearTimeout(mediaArtworkFallbackTimer);
    mediaArtworkFallbackTimer = 0;
  }

  function cacheWatermarkArtwork(source) {
    if (!source) return Promise.resolve(null);
    if (source === watermarkArtworkSource) return watermarkArtworkLoadPromise;
    if (resolveWatermarkArtworkLoad) resolveWatermarkArtworkLoad(null);
    watermarkArtworkSource = source;
    watermarkArtworkImage = null;
    watermarkArtworkLoadPromise = new Promise((resolve) => {
      resolveWatermarkArtworkLoad = resolve;
    });
    const image = new Image();
    if (/^https?:/i.test(source)) image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (watermarkArtworkSource !== source) return;
      watermarkArtworkImage = image;
      resolveWatermarkArtworkLoad?.(image);
      resolveWatermarkArtworkLoad = null;
    };
    image.onerror = () => {
      if (watermarkArtworkSource !== source) return;
      resolveWatermarkArtworkLoad?.(null);
      resolveWatermarkArtworkLoad = null;
    };
    image.src = source;
    return watermarkArtworkLoadPromise;
  }

  function useMediaArtwork(dataUrl) {
    const source = artworkSource(dataUrl);
    if (!source) return false;
    mediaArtworkMissing = false;
    clearMediaArtworkFallbackTimer();
    mediaArtworkAvailable = true;
    mediaArtworkSource = source;
    cacheWatermarkArtwork(source);
    if (playbackPlaying || !settings.pauseArtworkFallback) renderer.setArtworkSource(source);
    else applyArtworkFallback(true);
    return true;
  }

  function confirmMissingMediaArtwork() {
    mediaArtworkMissing = true;
    if (!mediaArtworkAvailable) {
      applyArtworkFallback();
      return;
    }
    if (!playbackPlaying || mediaArtworkFallbackTimer) return;
    mediaArtworkFallbackTimer = window.setTimeout(() => {
      mediaArtworkFallbackTimer = 0;
      if (!mediaArtworkMissing || !playbackPlaying) return;
      mediaArtworkAvailable = false;
      applyArtworkFallback();
    }, artworkMissingConfirmationMs);
  }

  function setNativeArtwork(key, dataUrl) {
    const nextKey = String(key || '');
    if (nextKey === nativeArtworkKey) {
      if (dataUrl) {
        useMediaArtwork(dataUrl);
      } else if (!mediaArtworkAvailable) {
        applyArtworkFallback();
      }
      return;
    }
    nativeArtworkKey = nextKey;
    if (!useMediaArtwork(dataUrl)) confirmMissingMediaArtwork();
  }

  window.PearWallSetArtwork = (key, dataUrl) => {
    setNativeArtwork(key, dataUrl);
  };

  window.PearWallSetDesktopArtwork = (dataUrl) => {
    desktopArtworkSource = artworkSource(dataUrl);
    desktopArtworkFailed = !desktopArtworkSource;
    if (!mediaArtworkAvailable) applyArtworkFallback();
  };

  window.PearWallSetNativePulse = (pulse) => {
    const value = Number(pulse);
    nativeAudioPulse = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  };

  function pollMediaArtwork(timestamp) {
    if (!tauriInvoke || mediaArtworkPollPending || timestamp - lastMediaArtworkPollAt < 1000) return;
    lastMediaArtworkPollAt = timestamp;
    mediaArtworkPollPending = true;
    tauriInvoke('get_media_artwork', { currentKey: nativeArtworkKey })
      .then((result) => {
        if (!result) return;
        setNativeArtwork(result.key, result.data_url);
        if (Boolean(result.playing) !== playbackPlaying) setPlaybackState(Boolean(result.playing));
      })
      .catch(() => {})
      .finally(() => {
        mediaArtworkPollPending = false;
      });
  }

  function applyArtworkFallback(force = false) {
    if (mediaArtworkAvailable && !force) return;
    if (settings.artworkFallback === 'CUSTOM' && settings.customArtwork) {
      renderer.setArtworkSource(fileArtworkSource(settings.customArtwork));
      return;
    }
    if (settings.artworkFallback !== 'DESKTOP') {
      renderer.setArtworkSource('assets/default_artwork.svg');
      return;
    }
    if (desktopArtworkSource) {
      renderer.setArtworkSource(desktopArtworkSource);
      return;
    }
    renderer.setArtworkSource('assets/default_artwork.svg');
    if (!tauriInvoke || desktopArtworkPending || desktopArtworkFailed) return;
    desktopArtworkPending = true;
    tauriInvoke('get_desktop_wallpaper')
      .then((dataUrl) => {
        desktopArtworkSource = artworkSource(dataUrl);
        desktopArtworkFailed = !desktopArtworkSource;
        if (!mediaArtworkAvailable && settings.artworkFallback === 'DESKTOP' && desktopArtworkSource) {
          renderer.setArtworkSource(desktopArtworkSource);
        }
      })
      .catch(() => {
        desktopArtworkFailed = true;
      })
      .finally(() => {
        desktopArtworkPending = false;
      });
  }

  function applyCurrentArtwork() {
    if (settings.pauseArtworkFallback && !playbackPlaying) {
      applyArtworkFallback(true);
      return;
    }
    if (mediaArtworkAvailable && mediaArtworkSource) {
      renderer.setArtworkSource(mediaArtworkSource);
      return;
    }
    applyArtworkFallback();
  }

  function applyUserProperties(properties) {
    if (!properties) return;
    const previousArtworkFallback = settings.artworkFallback;
    const artworkFallbackProvided = Boolean(properties.artworkFallback && properties.artworkFallback.value != null);
    const renderScaleValue = properties.renderScale && properties.renderScale.value;
    const performanceModeProvided = Boolean(properties.performanceMode && properties.performanceMode.value != null);
    if (String(renderScaleValue || '').toUpperCase() === 'AUTO') {
      settings.performanceMode = 'AUTO';
    } else if (renderScaleValue !== undefined) {
      settings.renderScale = Math.max(0.25, Math.min(1, numberValue(properties.renderScale, settings.renderScale)));
    }
    if (performanceModeProvided) {
      settings.performanceMode = stringValue(properties.performanceMode, settings.performanceMode).toUpperCase() === 'AUTO'
        ? 'AUTO'
        : 'MANUAL';
    }
    const legacyBatterySaverProperty = properties.autoBatterySaverThreshold;
    const saverProperty = properties.autoBatterySaverMax || legacyBatterySaverProperty;
    if (saverProperty && saverProperty.value !== undefined) {
      settings.autoBatterySaverMax = Math.max(
        1,
        Math.min(98, Math.round(numberValue(saverProperty, settings.autoBatterySaverMax))),
      );
    }
    if (properties.autoBatteryBalancedMax && properties.autoBatteryBalancedMax.value !== undefined) {
      settings.autoBatteryBalancedMax = Math.max(
        settings.autoBatterySaverMax + 1,
        Math.min(99, Math.round(numberValue(
          properties.autoBatteryBalancedMax,
          settings.autoBatteryBalancedMax,
        ))),
      );
    }
    settings.audioVisualization = booleanValue(properties.audioVisualization, settings.audioVisualization);
    settings.audioIntensity = Math.max(0.5, Math.min(3, numberValue(properties.audioIntensity, settings.audioIntensity)));
    settings.pauseFlow = booleanValue(properties.pauseFlow, settings.pauseFlow);
    settings.pauseArtworkFallback = booleanValue(properties.pauseArtworkFallback, settings.pauseArtworkFallback);
    settings.hideCursor = booleanValue(properties.hideCursor, settings.hideCursor);
    settings.blurEnabled = booleanValue(properties.blurEnabled, settings.blurEnabled);
    settings.scrimAlpha = Math.max(0, Math.min(0.8, numberValue(properties.scrimAlpha, settings.scrimAlpha)));
    settings.blurMultiplier = Math.max(0, Math.min(2, numberValue(properties.blurMultiplier, settings.blurMultiplier)));
    settings.flowSpeed = stringValue(properties.flowSpeed, settings.flowSpeed);
    settings.moruStyle = moruStyleValue(properties.moruStyle, settings.moruStyle);
    settings.portraitPreset = Math.round(Math.max(0, Math.min(3, numberValue(properties.portraitPreset, settings.portraitPreset))));
    settings.landscapePreset = Math.round(Math.max(0, Math.min(4, numberValue(properties.landscapePreset, settings.landscapePreset))));
    settings.randomPreset = booleanValue(properties.randomPreset, settings.randomPreset);
    settings.artworkFallback = stringValue(properties.artworkFallback, settings.artworkFallback).toUpperCase();
    settings.customArtwork = stringValue(properties.customArtwork, settings.customArtwork);
    if (!artworkFallbackProvided && properties.customArtwork) {
      settings.artworkFallback = settings.customArtwork ? 'CUSTOM' : 'DEFAULT';
    } else if (settings.artworkFallback !== 'DEFAULT' && settings.artworkFallback !== 'CUSTOM' && settings.artworkFallback !== 'DESKTOP') {
      settings.artworkFallback = settings.customArtwork ? 'CUSTOM' : 'DEFAULT';
    }
    if (settings.artworkFallback === 'DESKTOP' && previousArtworkFallback !== 'DESKTOP') desktopArtworkFailed = false;
    if (performanceMonitor) {
      if (settings.performanceMode === 'AUTO') performanceMonitor.start();
      else performanceMonitor.stop();
    }
    applyEffectiveSettings();
    applyCursorVisibility();
    applyCurrentArtwork();
  }

  function setPlaybackState(playing) {
    playbackPlaying = playing;
    if (!playing) {
      clearMediaArtworkFallbackTimer();
      mediaArtworkMissing = false;
      analyzer.reset();
      if (tauriInvoke) tauriInvoke('reset_audio').catch(() => {});
      resetRustAudioPulse();
      if (settings.pauseArtworkFallback) applyArtworkFallback(true);
    } else if (mediaArtworkMissing) {
      confirmMissingMediaArtwork();
    } else {
      applyCurrentArtwork();
    }
  }

  function watermarkHeight(width, height) {
    return Math.max(24, Math.round(Math.min(width * 0.11, height * 0.18)));
  }

  function fittedText(context, value, maxWidth) {
    const text = String(value || '').trim();
    if (!text || context.measureText(text).width <= maxWidth) return text;
    const characters = Array.from(text);
    while (characters.length > 1) {
      characters.pop();
      const candidate = `${characters.join('')}…`;
      if (context.measureText(candidate).width <= maxWidth) return candidate;
    }
    return '…';
  }

  function drawWatermarkBackground(context, photo, width, height, stripHeight, watermarkTop, style) {
    if (style === 'BLACK' || style === 'WHITE') {
      context.fillStyle = style === 'BLACK' ? '#000000' : '#ffffff';
      context.fillRect(0, watermarkTop, width, stripHeight);
      return;
    }
    const sourceHeight = Math.min(height, Math.max(1, stripHeight * 2));
    const sampleScale = 16;
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(width / sampleScale));
    sample.height = Math.max(1, Math.round(stripHeight / sampleScale));
    const sampleContext = sample.getContext('2d');
    if (!sampleContext) {
      context.drawImage(photo, 0, height - sourceHeight, width, sourceHeight, 0, watermarkTop, width, stripHeight);
      return;
    }
    sampleContext.imageSmoothingEnabled = true;
    sampleContext.imageSmoothingQuality = 'high';
    sampleContext.drawImage(
      photo,
      0,
      height - sourceHeight,
      width,
      sourceHeight,
      0,
      0,
      sample.width,
      sample.height,
    );
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      sample,
      0,
      0,
      sample.width,
      sample.height,
      0,
      watermarkTop,
      width,
      stripHeight,
    );
    context.restore();
    context.fillStyle = style === 'BLUR_WHITE'
      ? 'rgba(255, 255, 255, 0.55)'
      : 'rgba(0, 0, 0, 0.55)';
    context.fillRect(0, watermarkTop, width, stripHeight);
  }

  function drawCircularArtwork(context, artwork, fallback, x, y, size) {
    const source = artwork && artwork.complete && artwork.naturalWidth > 0
      ? artwork
      : fallback;
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;
    const sourceSize = Math.min(sourceWidth, sourceHeight);
    const sourceX = (sourceWidth - sourceSize) / 2;
    const sourceY = (sourceHeight - sourceSize) / 2;
    context.save();
    context.beginPath();
    context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(
      source,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      x,
      y,
      size,
      size,
    );
    context.restore();
  }

  function drawWatermarkContent(context, photo, options, width, height, stripHeight, watermarkTop, style) {
    const lightBackground = style === 'WHITE' || style === 'BLUR_WHITE';
    const foreground = lightBackground ? '#111111' : '#ffffff';
    const secondary = lightBackground ? 'rgba(17, 17, 17, 0.58)' : 'rgba(255, 255, 255, 0.62)';
    const dividerColor = lightBackground ? 'rgba(17, 17, 17, 0.16)' : 'rgba(255, 255, 255, 0.22)';
    const columnWidth = width / 3;
    const centerY = watermarkTop + stripHeight / 2;
    const logoHeight = stripHeight * 0.31;
    const logoWidth = logoHeight * 64 / 19;
    const previewRenderScale = Math.min(1, 720 / Math.max(width, height));
    const logoX = 28 / previewRenderScale;
    const logoY = centerY - logoHeight / 2;
    const logoPath = String(options.watermarkLogoPath || '');
    let logoDrawn = false;
    context.save();
    context.fillStyle = foreground;
    if (logoPath && typeof Path2D === 'function') {
      try {
        const path = new Path2D(logoPath);
        context.translate(logoX, logoY);
        context.scale(logoWidth / 64, logoHeight / 19);
        context.fill(path);
        logoDrawn = true;
      } catch (_) {}
    }
    context.restore();
    if (!logoDrawn) {
      context.save();
      context.fillStyle = foreground;
      context.font = `italic 600 ${Math.max(12, Math.round(logoHeight))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('Pear Wall', columnWidth / 2, centerY);
      context.restore();
    }

    const artworkSource = String(options.songArtwork || '');
    if (artworkSource) cacheWatermarkArtwork(artworkSource);
    const dividerX = columnWidth * 2;
    const artworkSize = stripHeight * 0.40;
    const contentGap = Math.max(4, Math.round(stripHeight * 0.15));
    const artworkX = dividerX - contentGap - artworkSize;
    const artworkY = centerY - artworkSize / 2;
    drawCircularArtwork(
      context,
      artworkSource === watermarkArtworkSource ? watermarkArtworkImage : null,
      photo,
      artworkX,
      artworkY,
      artworkSize,
    );
    context.save();
    context.strokeStyle = dividerColor;
    context.lineWidth = Math.max(1, width * 0.0006);
    context.beginPath();
    context.moveTo(dividerX, centerY - stripHeight * 0.15);
    context.lineTo(dividerX, centerY + stripHeight * 0.15);
    context.stroke();
    context.restore();

    const title = String(options.songTitle || '').trim() || '暂无歌曲信息';
    const details = [options.songArtist, options.songAlbum]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' · ') || 'Pear Wall';
    const textX = dividerX + contentGap;
    const textRightPadding = Math.max(contentGap, Math.round(width * 0.035));
    const maxTextWidth = width - textX - textRightPadding;
    const titleSize = Math.max(11, Math.round(stripHeight * 0.17));
    const detailSize = Math.max(10, Math.round(stripHeight * 0.145));
    context.save();
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = foreground;
    context.font = `600 ${titleSize}px sans-serif`;
    context.fillText(
      fittedText(context, title, maxTextWidth),
      textX,
      centerY - stripHeight * 0.105,
    );
    context.fillStyle = secondary;
    context.font = `400 ${detailSize}px sans-serif`;
    context.fillText(
      fittedText(context, details, maxTextWidth),
      textX,
      centerY + stripHeight * 0.14,
    );
    context.restore();
  }

  async function exportImage(options) {
    const songArtwork = String(options.songArtwork || '');
    if (songArtwork) await cacheWatermarkArtwork(songArtwork);
    await renderer.waitForArtwork();
    const width = Math.max(64, Math.min(4096, Math.round(Number(options.width) || 1920)));
    const height = Math.max(64, Math.min(4096, Math.round(Number(options.height) || 1080)));
    const watermarkPlacement = options.watermarkPlacement === 'OVERLAY' ? 'OVERLAY' : 'BELOW';
    const stripHeight = options.watermark ? watermarkHeight(width, height) : 0;
    const watermarkTop = watermarkPlacement === 'OVERLAY'
      ? height - stripHeight
      : height;
    const outputHeight = watermarkPlacement === 'BELOW'
      ? height + stripHeight
      : height;
    if (width * outputHeight > 20_000_000) {
      throw new Error('导出图片不能超过 2000 万像素');
    }
    const portrait = height >= width;
    const blurMultiplier = Math.max(0, Math.min(2, Number(options.blurMultiplier) || 0));
    const exportBlurScale = Math.max(width, height) / 720;
    const preset = Math.round(Math.max(
      0,
      Math.min(portrait ? 3 : 4, Number(options.distortionPreset) || 0),
    ));
    const distortionProgress = Math.max(0, Math.min(1, Number(options.distortionProgress) || 0));
    const pixels = renderer.exportPixels({
      width,
      height,
      time: 2.5 - distortionProgress * 5,
      settings: {
        distortionStrength: Math.max(0, Math.min(1.5, Number(options.distortionStrength) || 0)),
        blurEnabled: blurMultiplier > 0,
        blurMultiplier: blurMultiplier * exportBlurScale,
        scrimAlpha: Math.max(0, Math.min(0.8, Number(options.scrimAlpha) || 0)),
        portraitPreset: portrait ? preset : settings.portraitPreset,
        landscapePreset: portrait ? settings.landscapePreset : preset,
      },
    });
    const photo = document.createElement('canvas');
    photo.width = width;
    photo.height = height;
    const photoContext = photo.getContext('2d');
    if (!photoContext) throw new Error('无法创建图片导出画布');
    const image = photoContext.createImageData(width, height);
    const rowBytes = width * 4;
    for (let row = 0; row < height; row += 1) {
      const sourceOffset = (height - row - 1) * rowBytes;
      image.data.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
    }
    photoContext.putImageData(image, 0, 0);
    const output = document.createElement('canvas');
    output.width = width;
    output.height = outputHeight;
    const context = output.getContext('2d');
    if (!context) throw new Error('无法创建图片导出画布');
    context.drawImage(photo, 0, 0);
    if (options.watermark) {
      const style = ['BLACK', 'WHITE', 'BLUR_WHITE', 'BLUR_BLACK'].includes(options.watermarkBackground)
        ? options.watermarkBackground
        : 'WHITE';
      drawWatermarkBackground(context, photo, width, height, stripHeight, watermarkTop, style);
      drawWatermarkContent(context, photo, options, width, height, stripHeight, watermarkTop, style);
    }
    return output.toDataURL('image/png');
  }

  function playbackState(event) {
    if (!event) return '';
    const value = event.state ?? event.playbackState ?? event.status ?? event;
    if (typeof value === 'number' && window.wallpaperMediaIntegration) {
      if (value === window.wallpaperMediaIntegration.PLAYBACK_PLAYING) return 'PLAYING';
      if (value === window.wallpaperMediaIntegration.PLAYBACK_PAUSED) return 'PAUSED';
      if (value === window.wallpaperMediaIntegration.PLAYBACK_STOPPED) return 'STOPPED';
    }
    return String(value).toUpperCase();
  }

  window.wallpaperPropertyListener = {
    applyUserProperties,
    applyGeneralProperties(properties) {
      if (properties && properties.fps !== undefined) targetFps = Math.max(0, Number(properties.fps) || 0);
    },
    setPaused(value) {
      paused = Boolean(value);
    },
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (window.location.protocol !== 'file:' && event.origin !== window.location.origin) return;
    if (!event.data) return;
    if (event.data.type === 'pearwall:settings') {
      applySettingsValues(event.data.settings);
      return;
    }
    if (event.data.type === 'pearwall:audio-pulse') {
      window.PearWallSetNativePulse(event.data.pulse);
      return;
    }
    if (event.data.type !== 'pearwall:media-artwork') return;
    const result = event.data.artwork;
    if (!result || typeof result !== 'object') return;
    setNativeArtwork(result.key, result.data_url);
    if (typeof result.playing === 'boolean' && result.playing !== playbackPlaying) {
      setPlaybackState(result.playing);
    }
  });

  window.PearWallReloadSettings = () => {
    applySettingsValues(savedSettings());
  };
  window.PearWallExportImage = exportImage;

  window.addEventListener('storage', (event) => {
    if (event.key !== settingsStorageKey) return;
    window.PearWallReloadSettings();
  });

  if (typeof window.wallpaperRegisterAudioListener === 'function') {
    window.wallpaperRegisterAudioListener((audioArray) => {
      if (!settings.audioVisualization || !playbackPlaying) return;
      const timestampSeconds = audioTimestampSeconds();
      if (tauriInvoke) {
        tauriInvoke('push_audio_spectrum', {
          audio: Array.from(audioArray, Number),
          timestampSeconds,
        }).then((pulse) => {
          updateRustAudioPulse(pulse);
        }).catch(() => {});
      } else {
        analyzer.push(audioArray, timestampSeconds);
      }
    });
  }

  if (typeof window.wallpaperRegisterMediaThumbnailListener === 'function') {
    window.wallpaperRegisterMediaThumbnailListener((event) => {
      const thumbnail = typeof event === 'string' ? event : event && (event.thumbnail || event.data);
      if (!useMediaArtwork(thumbnail)) confirmMissingMediaArtwork();
    });
  }

  if (typeof window.wallpaperRegisterMediaPlaybackListener === 'function') {
    window.wallpaperRegisterMediaPlaybackListener((event) => {
      const state = playbackState(event);
      if (state.includes('PLAY')) setPlaybackState(true);
      else if (state.includes('PAUS') || state.includes('STOP')) setPlaybackState(false);
    });
  }

  if (typeof window.wallpaperRegisterMediaPropertiesListener === 'function') {
    window.wallpaperRegisterMediaPropertiesListener(() => {});
  }

  function renderFrame(timestamp) {
    const delta = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
    const minFrameInterval = targetFps > 0 ? 1000 / targetFps : 0;
    if (!minFrameInterval || timestamp - lastRenderedAt >= minFrameInterval) {
      pollRustAudio(timestamp);
      pollMediaArtwork(timestamp);
      if (!paused && (!settings.pauseFlow || playbackPlaying)) animationTime += delta;
      const source = Number.isFinite(nativeAudioPulse)
        ? 'native-frame'
        : (tauriInvoke ? 'native-pcm' : 'wallpaper-spectrum');
      const pulse = settings.audioVisualization && playbackPlaying
        ? (Number.isFinite(nativeAudioPulse)
            ? nativeAudioPulse
            : (tauriInvoke
                ? interpolatedRustAudioPulse(timestamp)
                : analyzer.getInterpolated(timestamp / 1000)))
        : 0;
      logBeat(pulse, timestamp, source);
      renderer.render(animationTime, pulse);
      if (!previewReady) {
        previewReady = true;
        window.parent.postMessage(
          { type: 'pearwall:ready' },
          window.location.protocol === 'file:' ? '*' : window.location.origin,
        );
      }
      lastRenderedAt = timestamp;
    }
  }

  function frame(timestamp) {
    renderFrame(timestamp);
    window.requestAnimationFrame(frame);
  }

  window.PearWallRenderFrame = (timestamp, pulse) => {
    window.PearWallSetNativePulse(pulse);
    renderFrame(Number(timestamp) || performance.now());
  };

  window.addEventListener('resize', () => renderer.resize());
  applySettingsValues(savedSettings());
  enableScreenSaverExit();
  renderer.resize();
  if (!nativeFrameDriver) window.requestAnimationFrame(frame);
}());
