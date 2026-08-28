import type { Settings } from './types';

type ScreenSaverSettingsWindow = Window & {
  PearWallScreenSaverSettings?: Partial<Settings>;
  webkit?: {
    messageHandlers?: {
      pearwallSettings?: {
        postMessage: (value: string) => void;
      };
    };
  };
};

export const settingsStorageKey = 'pearwall.settings';

export const defaultSettings: Settings = {
  dynamicWallpaperEnabled: false,
  dynamicWallpaperDisplayIds: null,
  audioVisualization: false,
  audioIntensity: 1,
  pauseFlow: true,
  hideCursor: true,
  screenSaverDisplay: 'PRIMARY',
  screenSaverDisplayIds: null,
  showConfigurationDetails: true,
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
  customArtworkName: '',
};

function normalizedSettings(saved: Partial<Settings>): Settings {
  const savedWithLegacy = saved as Partial<Settings> & {
    autoBatterySaverThreshold?: unknown;
  };
  const { autoBatterySaverThreshold: _, ...savedWithoutLegacy } = savedWithLegacy;
  const savedArtworkFallback = ['DEFAULT', 'CUSTOM', 'DESKTOP'].includes(
    saved.artworkFallback || '',
  )
    ? saved.artworkFallback
    : saved.customArtwork
      ? 'CUSTOM'
      : 'DEFAULT';
  const artworkFallback = savedArtworkFallback === 'CUSTOM' && !saved.customArtwork
    ? 'DEFAULT'
    : savedArtworkFallback;
  const screenSaverDisplay = saved.screenSaverDisplay === 'SECONDARY'
    ? 'SECONDARY'
    : 'PRIMARY';
  const performanceMode = saved.performanceMode === 'AUTO' ? 'AUTO' : 'MANUAL';
  const legacyBatterySaverMax = Number(savedWithLegacy.autoBatterySaverThreshold);
  const autoBatterySaverMax = Math.min(
    98,
    Math.max(
      1,
      Math.round(
        Number(saved.autoBatterySaverMax)
          || (Number.isFinite(legacyBatterySaverMax) ? legacyBatterySaverMax : 20),
      ),
    ),
  );
  const autoBatteryBalancedMax = Math.min(
    99,
    Math.max(
      autoBatterySaverMax + 1,
      Math.round(Number(saved.autoBatteryBalancedMax) || 60),
    ),
  );
  const screenSaverDisplayIds = Array.isArray(saved.screenSaverDisplayIds)
    ? saved.screenSaverDisplayIds.filter(
      (value): value is string => typeof value === 'string',
    )
    : null;
  const dynamicWallpaperDisplayIds = Array.isArray(saved.dynamicWallpaperDisplayIds)
    ? saved.dynamicWallpaperDisplayIds.filter(
      (value): value is string => typeof value === 'string',
    )
    : null;
  return {
    ...defaultSettings,
    ...savedWithoutLegacy,
    audioIntensity: Math.min(
      3,
      Math.max(0.5, Number(saved.audioIntensity) || defaultSettings.audioIntensity),
    ),
    artworkFallback,
    dynamicWallpaperDisplayIds,
    screenSaverDisplay,
    screenSaverDisplayIds,
    performanceMode,
    autoBatterySaverMax,
    autoBatteryBalancedMax,
  } as Settings;
}

export function settingsFromJSON(json: string): Settings {
  const saved = JSON.parse(json) as Partial<Settings>;
  return normalizedSettings(saved);
}

export function loadSettings(): Settings {
  try {
    const screenSaverWindow = window as ScreenSaverSettingsWindow;
    const saved = {
      ...JSON.parse(window.localStorage.getItem(settingsStorageKey) || '{}'),
      ...(screenSaverWindow.PearWallScreenSaverSettings || {}),
    };
    return normalizedSettings(saved);
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  const json = JSON.stringify(settings);
  try {
    window.localStorage.setItem(settingsStorageKey, json);
  } catch {
    return false;
  }
  const screenSaverWindow = window as ScreenSaverSettingsWindow;
  screenSaverWindow.webkit?.messageHandlers?.pearwallSettings?.postMessage(json);
  return true;
}

export function wallpaperSettings(settings: Settings) {
  const { customArtworkName: _, ...values } = settings;
  return values;
}
