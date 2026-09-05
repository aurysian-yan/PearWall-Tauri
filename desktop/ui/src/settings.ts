import type {
  ExportSettings,
  LyricsFontWeight,
  LyricsProvider,
  LyricsPresentationProfile,
  LyricsPresentationSettings,
  Settings,
  TrackInfoSettings,
} from './types';

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

export const defaultLyricsPresentationProfile: LyricsPresentationProfile = {
  enabled: false,
  showLyrics: true,
  fontSizeMode: 'MELOX_AUTO',
  fontSize: 50,
  fontWeight: 'BOLD',
  alignment: 'MELOX',
  progressiveBlur: true,
  minimumBlurRadius: 3,
  maximumBlurRadius: 4,
  topInset: 44,
  bottomInset: 48,
  trackInfo: {
    enabled: true,
    showArtwork: true,
    showTitle: true,
    showArtist: true,
    showAlbum: true,
    layout: 'HORIZONTAL',
    alignment: 'FOLLOW_LYRICS',
    scale: 1,
    artworkSize: 72,
    titleFontSize: 18,
    titleFontWeight: 'BOLD',
    secondaryFontSize: 14,
    secondaryFontWeight: 'MEDIUM',
  },
};

export const defaultLyricsPresentation: LyricsPresentationSettings = {
  defaultProfile: defaultLyricsPresentationProfile,
  displayOverrides: {},
  sourceOrder: ['AMLL', 'LRCLIB', 'NETEASE', 'QQ', 'KUGOU'],
};

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
  lyricsPresentation: defaultLyricsPresentation,
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
  watermarkPlacement: 'BELOW',
  previewScale: 1,
  askForLocation: true,
  defaultDirectory: '',
};

function isExportResolution(value: unknown): value is ExportSettings['resolution'] {
  return ['1920x1080', '2560x1440', '3840x2160', 'custom'].includes(value as string);
}

function isExportAspectRatio(value: unknown): value is ExportSettings['aspectRatio'] {
  return ['16:9', '16:10', '4:3', '1:1', 'custom'].includes(value as string);
}

function isWatermarkBackground(value: unknown): value is ExportSettings['watermarkBackground'] {
  return ['WHITE', 'BLACK', 'BLUR_WHITE', 'BLUR_BLACK'].includes(value as string);
}

function isWatermarkPlacement(value: unknown): value is ExportSettings['watermarkPlacement'] {
  return ['OVERLAY', 'BELOW'].includes(value as string);
}

function normalizedFontWeight(
  value: unknown,
  fallback: LyricsFontWeight,
): LyricsFontWeight {
  return ['REGULAR', 'MEDIUM', 'SEMIBOLD', 'BOLD', 'HEAVY'].includes(
    value as string,
  )
    ? (value as LyricsFontWeight)
    : fallback;
}

function normalizedLyricsProfile(
  saved: unknown,
  fallback: LyricsPresentationProfile = defaultLyricsPresentationProfile,
): LyricsPresentationProfile {
  const value = saved && typeof saved === 'object'
    ? (saved as Partial<LyricsPresentationProfile>)
    : {};
  const trackInfo: Partial<TrackInfoSettings> =
    value.trackInfo && typeof value.trackInfo === 'object'
      ? value.trackInfo
      : {};
  const numberInRange = (
    candidate: unknown,
    defaultValue: number,
    minimum: number,
    maximum: number,
  ) => {
    const number = Number(candidate);
    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : defaultValue;
  };
  const blurRange = [
    numberInRange(value.minimumBlurRadius, fallback.minimumBlurRadius, 0, 12),
    numberInRange(value.maximumBlurRadius, fallback.maximumBlurRadius, 0, 12),
  ].sort((left, right) => left - right);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    showLyrics: typeof value.showLyrics === 'boolean'
      ? value.showLyrics
      : fallback.showLyrics,
    fontSizeMode: value.fontSizeMode === 'CUSTOM' ? 'CUSTOM' : 'MELOX_AUTO',
    fontSize: numberInRange(value.fontSize, fallback.fontSize, 18, 120),
    fontWeight: normalizedFontWeight(value.fontWeight, fallback.fontWeight),
    alignment: ['MELOX', 'LEFT', 'CENTER', 'RIGHT'].includes(
      value.alignment as string,
    )
      ? value.alignment!
      : fallback.alignment,
    progressiveBlur: typeof value.progressiveBlur === 'boolean'
      ? value.progressiveBlur
      : fallback.progressiveBlur,
    minimumBlurRadius: blurRange[0],
    maximumBlurRadius: blurRange[1],
    topInset: numberInRange(value.topInset, fallback.topInset, 0, 240),
    bottomInset: numberInRange(value.bottomInset, fallback.bottomInset, 0, 240),
    trackInfo: {
      enabled: typeof trackInfo.enabled === 'boolean'
        ? trackInfo.enabled
        : fallback.trackInfo.enabled,
      showArtwork: typeof trackInfo.showArtwork === 'boolean'
        ? trackInfo.showArtwork
        : fallback.trackInfo.showArtwork,
      showTitle: typeof trackInfo.showTitle === 'boolean'
        ? trackInfo.showTitle
        : fallback.trackInfo.showTitle,
      showArtist: typeof trackInfo.showArtist === 'boolean'
        ? trackInfo.showArtist
        : fallback.trackInfo.showArtist,
      showAlbum: typeof trackInfo.showAlbum === 'boolean'
        ? trackInfo.showAlbum
        : fallback.trackInfo.showAlbum,
      layout: trackInfo.layout === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL',
      alignment: ['FOLLOW_LYRICS', 'LEFT', 'CENTER', 'RIGHT'].includes(
        trackInfo.alignment as string,
      )
        ? trackInfo.alignment!
        : fallback.trackInfo.alignment,
      scale: numberInRange(trackInfo.scale, fallback.trackInfo.scale, 0.6, 1.6),
      artworkSize: numberInRange(
        trackInfo.artworkSize,
        fallback.trackInfo.artworkSize,
        40,
        160,
      ),
      titleFontSize: numberInRange(
        trackInfo.titleFontSize,
        fallback.trackInfo.titleFontSize,
        12,
        48,
      ),
      titleFontWeight: normalizedFontWeight(
        trackInfo.titleFontWeight,
        fallback.trackInfo.titleFontWeight,
      ),
      secondaryFontSize: numberInRange(
        trackInfo.secondaryFontSize,
        fallback.trackInfo.secondaryFontSize,
        10,
        36,
      ),
      secondaryFontWeight: normalizedFontWeight(
        trackInfo.secondaryFontWeight,
        fallback.trackInfo.secondaryFontWeight,
      ),
    },
  };
}

function normalizedLyricsPresentation(value: unknown): LyricsPresentationSettings {
  const saved = value && typeof value === 'object'
    ? (value as Partial<LyricsPresentationSettings>)
    : {};
  const defaultProfile = normalizedLyricsProfile(saved.defaultProfile);
  const rawOverrides = saved.displayOverrides && typeof saved.displayOverrides === 'object'
    ? saved.displayOverrides
    : {};
  const displayOverrides = Object.fromEntries(
    Object.entries(rawOverrides).flatMap(([displayId, override]) => {
      if (!displayId || !override || typeof override !== 'object') return [];
      return [[displayId, normalizedLyricsProfile(override, defaultProfile)]];
    }),
  );
  const knownProviders = new Set<LyricsProvider>(
    defaultLyricsPresentation.sourceOrder,
  );
  const savedSourceOrder = Array.isArray(saved.sourceOrder)
    ? saved.sourceOrder.filter(
      (provider): provider is LyricsProvider => knownProviders.has(provider as LyricsProvider),
    )
    : [];
  const sourceOrder = [
    ...new Set([
      ...savedSourceOrder,
      ...defaultLyricsPresentation.sourceOrder,
    ]),
  ];
  return { defaultProfile, displayOverrides, sourceOrder };
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
    lyricsPresentation: normalizedLyricsPresentation(saved.lyricsPresentation),
  } as Settings;
}

function normalizedExportSettings(saved: Partial<ExportSettings>): ExportSettings {
  const resolution = isExportResolution(saved.resolution)
    ? saved.resolution
    : defaultExportSettings.resolution;
  const storedAspectRatio = saved.aspectRatio as string | undefined;
  const aspectRatio = storedAspectRatio === '9:16'
    ? 'custom'
    : isExportAspectRatio(storedAspectRatio)
    ? storedAspectRatio
    : defaultExportSettings.aspectRatio;
  const watermarkBackground = isWatermarkBackground(saved.watermarkBackground)
    ? saved.watermarkBackground
    : defaultExportSettings.watermarkBackground;
  const watermarkPlacement = isWatermarkPlacement(saved.watermarkPlacement)
    ? saved.watermarkPlacement
    : defaultExportSettings.watermarkPlacement;
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
    watermarkPlacement,
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
