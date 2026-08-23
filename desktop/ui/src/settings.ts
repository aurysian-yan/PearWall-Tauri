import type { Settings } from './types';

export const settingsStorageKey = 'pearwall.settings';

export const defaultSettings: Settings = {
  audioVisualization: true,
  pauseFlow: true,
  renderScale: 0.75,
  blurEnabled: true,
  blurMultiplier: 1,
  scrimAlpha: 0.4,
  flowSpeed: 'NORMAL',
  moruStyle: 'OFF',
  portraitPreset: 0,
  landscapePreset: 0,
  randomPreset: false,
  customArtwork: '',
  customArtworkName: '',
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(settingsStorageKey) || '{}');
    return { ...defaultSettings, ...saved };
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
