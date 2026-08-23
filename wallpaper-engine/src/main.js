(function () {
  const canvas = document.getElementById('wallpaper');
  const renderer = new window.PearWallRenderer.PearWallRenderer(canvas);
  const analyzer = new window.PearWallAudio.AppleMusicSpectrumAnalysis();
  const tauriInvoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  const tauriWindowApi = window.__TAURI__ && window.__TAURI__.window;
  const settingsStorageKey = 'pearwall.settings';
  const settings = {
    audioVisualization: true,
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
  let rustAudioPulse = 0;
  let lastRustAudioPollAt = 0;
  let rustAudioPollPending = false;
  let lastMediaArtworkPollAt = 0;
  let mediaArtworkPollPending = false;
  let nativeArtworkKey = '';
  let mediaArtworkAvailable = false;
  let desktopArtworkSource = '';
  let desktopArtworkPending = false;
  let desktopArtworkFailed = false;
  let screenSaverMode = false;
  let previewReady = false;

  renderer.setArtworkSource('assets/default_artwork.svg');

  function savedSettings() {
    try {
      return JSON.parse(window.localStorage.getItem(settingsStorageKey) || '{}');
    } catch (_) {
      return {};
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
    if (rustAudioPollPending || timestamp - lastRustAudioPollAt < 33) return;
    lastRustAudioPollAt = timestamp;
    rustAudioPollPending = true;
    tauriInvoke('get_audio_pulse', { timestamp_seconds: audioTimestampSeconds() })
      .then((pulse) => {
        rustAudioPulse = Number(pulse) || 0;
      })
      .catch(() => {})
      .finally(() => {
        rustAudioPollPending = false;
      });
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

  function setNativeArtwork(key, dataUrl) {
    const nextKey = String(key || '');
    if (nextKey === nativeArtworkKey) {
      if (!mediaArtworkAvailable) applyArtworkFallback();
      return;
    }
    nativeArtworkKey = nextKey;
    mediaArtworkAvailable = Boolean(dataUrl);
    if (mediaArtworkAvailable) renderer.setArtworkSource(artworkSource(dataUrl));
    else applyArtworkFallback();
  }

  window.PearWallSetArtwork = (key, dataUrl) => {
    setNativeArtwork(key, dataUrl);
  };

  window.PearWallSetDesktopArtwork = (dataUrl) => {
    desktopArtworkSource = artworkSource(dataUrl);
    desktopArtworkFailed = !desktopArtworkSource;
    if (!mediaArtworkAvailable) applyArtworkFallback();
  };

  function pollMediaArtwork(timestamp) {
    if (!tauriInvoke || mediaArtworkPollPending || timestamp - lastMediaArtworkPollAt < 1000) return;
    lastMediaArtworkPollAt = timestamp;
    mediaArtworkPollPending = true;
    tauriInvoke('get_media_artwork')
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
      analyzer.reset();
      if (tauriInvoke) tauriInvoke('reset_audio').catch(() => {});
      rustAudioPulse = 0;
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
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'pearwall:settings') return;
    applySettingsValues(event.data.settings);
  });

  if (typeof window.wallpaperRegisterAudioListener === 'function') {
    window.wallpaperRegisterAudioListener((audioArray) => {
      if (!settings.audioVisualization || !playbackPlaying) return;
      const timestampSeconds = audioTimestampSeconds();
      if (tauriInvoke) {
        tauriInvoke('push_audio_spectrum', {
          audio: Array.from(audioArray, Number),
          timestamp_seconds: timestampSeconds,
        }).then((pulse) => {
          rustAudioPulse = Number(pulse) || 0;
        }).catch(() => {});
      } else {
        analyzer.push(audioArray, timestampSeconds);
      }
    });
  }

  if (typeof window.wallpaperRegisterMediaThumbnailListener === 'function') {
    window.wallpaperRegisterMediaThumbnailListener((event) => {
      const thumbnail = typeof event === 'string' ? event : event && (event.thumbnail || event.data);
      mediaArtworkAvailable = Boolean(thumbnail);
      if (mediaArtworkAvailable) renderer.setArtworkSource(artworkSource(thumbnail));
      else applyArtworkFallback();
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

  function frame(timestamp) {
    const delta = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
    const minFrameInterval = targetFps > 0 ? 1000 / targetFps : 0;
    if (!minFrameInterval || timestamp - lastRenderedAt >= minFrameInterval) {
      pollRustAudio(timestamp);
      pollMediaArtwork(timestamp);
      if (!paused && (!settings.pauseFlow || playbackPlaying)) animationTime += delta;
      const pulse = settings.audioVisualization && playbackPlaying
        ? (tauriInvoke ? rustAudioPulse : analyzer.getInterpolated(timestamp / 1000))
        : 0;
      renderer.render(animationTime, pulse);
      if (!previewReady) {
        previewReady = true;
        window.parent.postMessage({ type: 'pearwall:ready' }, window.location.origin);
      }
      lastRenderedAt = timestamp;
    }
    window.requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => renderer.resize());
  applySettingsValues(savedSettings());
  enableScreenSaverExit();
  renderer.resize();
  window.requestAnimationFrame(frame);
}());
