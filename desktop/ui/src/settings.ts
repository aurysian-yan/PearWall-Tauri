import type { Settings } from './types';

export const settingsStorageKey = 'pearwall.settings';

export const defaultSettings: Settings = {
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
  customArtworkName: '',
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(settingsStorageKey) || '{}');
    const savedArtworkFallback = ['DEFAULT', 'CUSTOM', 'DESKTOP'].includes(saved.artworkFallback)
      ? saved.artworkFallback
      : saved.customArtwork
        ? 'CUSTOM'
        : 'DEFAULT';
    const artworkFallback = savedArtworkFallback === 'CUSTOM' && !saved.customArtwork
      ? 'DEFAULT'
      : savedArtworkFallback;
    return { ...defaultSettings, ...saved, artworkFallback };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  try {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  } catch {
    return false;
  }
  return true;
}

export function wallpaperSettings(settings: Settings) {
  const { customArtworkName: _, ...values } = settings;
  return values;
}
