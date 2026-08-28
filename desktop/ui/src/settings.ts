import type { ExportSettings, Settings } from './types';

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
export const exportSettingsStorageKey = 'pearwall.export-settings';

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

export const defaultExportSettings: ExportSettings = {
  resolution: '2560x1440',
  aspectRatio: '16:9',
  width: 2560,
  height: 1440,
  distortionPreset: 0,
  distortionStrength: 1,
  distortionProgress: 0.5,
  blurMultiplier: 1,
  scrimAlpha: 0.4,
  watermark: false,
  watermarkBackground: 'WHITE',
  previewScale: 1,
  askForLocation: true,
  defaultDirectory: '',
};

function isExportResolution(value: unknown): value is ExportSettings['resolution'] {
  return ['1920x1080', '2560x1440', '3840x2160', 'custom'].includes(value as string);
}

function isExportAspectRatio(value: unknown): value is ExportSettings['aspectRatio'] {
  return ['16:9', '16:10', '4:3', '1:1', '9:16', 'custom'].includes(value as string);
}

function isWatermarkBackground(value: unknown): value is ExportSettings['watermarkBackground'] {
  return ['WHITE', 'BLACK', 'BLUR_WHITE', 'BLUR_BLACK'].includes(value as string);
}

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

function normalizedExportSettings(saved: Partial<ExportSettings>): ExportSettings {
  const resolution = isExportResolution(saved.resolution)
    ? saved.resolution
    : defaultExportSettings.resolution;
  const aspectRatio = isExportAspectRatio(saved.aspectRatio)
    ? saved.aspectRatio
    : defaultExportSettings.aspectRatio;
  const watermarkBackground = isWatermarkBackground(saved.watermarkBackground)
    ? saved.watermarkBackground
    : defaultExportSettings.watermarkBackground;
  const numberInRange = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : fallback;
  };
  return {
    ...defaultExportSettings,
    ...saved,
    resolution,
    aspectRatio,
    watermarkBackground,
    width: Math.round(numberInRange(saved.width, defaultExportSettings.width, 320, 4096)),
    height: Math.round(numberInRange(saved.height, defaultExportSettings.height, 320, 4096)),
    distortionPreset: Math.round(
      numberInRange(saved.distortionPreset, defaultExportSettings.distortionPreset, 0, 4),
    ),
    distortionStrength: numberInRange(
      saved.distortionStrength,
      defaultExportSettings.distortionStrength,
      0,
      1.5,
    ),
    distortionProgress: numberInRange(
      saved.distortionProgress,
      defaultExportSettings.distortionProgress,
      0,
      1,
    ),
    blurMultiplier: numberInRange(
      saved.blurMultiplier,
      defaultExportSettings.blurMultiplier,
      0,
      2,
    ),
    scrimAlpha: numberInRange(saved.scrimAlpha, defaultExportSettings.scrimAlpha, 0, 0.8),
    watermark: typeof saved.watermark === 'boolean'
      ? saved.watermark
      : defaultExportSettings.watermark,
    previewScale: numberInRange(saved.previewScale, defaultExportSettings.previewScale, 0.75, 1.5),
    askForLocation: typeof saved.askForLocation === 'boolean'
      ? saved.askForLocation
      : defaultExportSettings.askForLocation,
    defaultDirectory: typeof saved.defaultDirectory === 'string'
      ? saved.defaultDirectory
      : defaultExportSettings.defaultDirectory,
  };
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

export function loadExportSettings(): ExportSettings {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(exportSettingsStorageKey) || '{}',
    ) as Partial<ExportSettings>;
    return normalizedExportSettings(saved);
  } catch {
    return defaultExportSettings;
  }
}

export function saveExportSettings(settings: ExportSettings) {
  try {
    window.localStorage.setItem(exportSettingsStorageKey, JSON.stringify(settings));
  } catch {
    return false;
  }
  return true;
}

export function wallpaperSettings(settings: Settings) {
  const { customArtworkName: _, ...values } = settings;
  return values;
}
