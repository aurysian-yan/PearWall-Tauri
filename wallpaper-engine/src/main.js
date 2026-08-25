(function () {
  const canvas = document.getElementById('wallpaper');
  const renderer = new window.PearWallRenderer.PearWallRenderer(canvas);
  const analyzer = new window.PearWallAudio.AppleMusicSpectrumAnalysis();
  const tauriInvoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  const tauriWindowApi = window.__TAURI__ && window.__TAURI__.window;
  const settingsStorageKey = 'pearwall.settings';
  const artworkMissingConfirmationMs = 2500;
  const settings = {
    audioVisualization: true,
    audioIntensity: 1,
    pauseFlow: true,
    hideCursor: true,
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
  let mediaArtworkAvailable = false;
  let mediaArtworkMissing = false;
  let mediaArtworkFallbackTimer = 0;
  let desktopArtworkSource = '';
  let desktopArtworkPending = false;
  let desktopArtworkFailed = false;
  let screenSaverMode = false;
  let previewReady = false;
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
      const exit = () => tauriWindowApi.getCurrentWindow().close().catch(() => {});
      window.addEventListener('mousemove', exit, { once: true });
      window.addEventListener('mousedown', exit, { once: true });
      window.addEventListener('keydown', exit, { once: true });
      window.addEventListener('touchstart', exit, { once: true });
    }).catch(() => {});
  }

  function applyCursorVisibility() {
    const cursor = settings.hideCursor && screenSaverMode ? 'none' : '';
    document.documentElement.style.cursor = cursor;
    document.body.style.cursor = cursor;
    canvas.style.cursor = cursor;
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

  function useMediaArtwork(dataUrl) {
    const source = artworkSource(dataUrl);
    if (!source) return false;
    mediaArtworkMissing = false;
    clearMediaArtworkFallbackTimer();
    mediaArtworkAvailable = true;
    renderer.setArtworkSource(source);
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

  function applyArtworkFallback() {
    if (mediaArtworkAvailable) return;
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

  function applyUserProperties(properties) {
    if (!properties) return;
    const previousArtworkFallback = settings.artworkFallback;
    const artworkFallbackProvided = Boolean(properties.artworkFallback && properties.artworkFallback.value != null);
    settings.audioVisualization = booleanValue(properties.audioVisualization, settings.audioVisualization);
    settings.audioIntensity = Math.max(0.5, Math.min(3, numberValue(properties.audioIntensity, settings.audioIntensity)));
    settings.pauseFlow = booleanValue(properties.pauseFlow, settings.pauseFlow);
    settings.hideCursor = booleanValue(properties.hideCursor, settings.hideCursor);
    settings.blurEnabled = booleanValue(properties.blurEnabled, settings.blurEnabled);
    settings.renderScale = Math.max(0.25, Math.min(1, numberValue(properties.renderScale, settings.renderScale)));
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
    renderer.setSettings(settings);
    applyCursorVisibility();
    applyArtworkFallback();
  }

  function setPlaybackState(playing) {
    playbackPlaying = playing;
    if (!playing) {
      clearMediaArtworkFallbackTimer();
      mediaArtworkMissing = false;
      analyzer.reset();
      if (tauriInvoke) tauriInvoke('reset_audio').catch(() => {});
      resetRustAudioPulse();
    } else if (mediaArtworkMissing) {
      confirmMissingMediaArtwork();
    }
    if (playing) return;
    applyArtworkFallback();
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
