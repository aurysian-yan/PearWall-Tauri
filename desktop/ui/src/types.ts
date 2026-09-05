export type FlowSpeed = 'SLOW' | 'NORMAL' | 'FAST';
export type MoruStyle = 'OFF' | 'NARROW' | 'WIDE' | 'SMOOTH';
export type ArtworkFallback = 'DEFAULT' | 'CUSTOM' | 'DESKTOP';
export type ScreenSaverDisplay = 'PRIMARY' | 'SECONDARY';
export type PerformanceMode = 'MANUAL' | 'AUTO';
export type ExportResolution = '1920x1080' | '2560x1440' | '3840x2160' | 'custom';
export type ExportAspectRatio = '16:9' | '16:10' | '4:3' | '1:1' | 'custom';
export type WatermarkBackground = 'WHITE' | 'BLACK' | 'BLUR_WHITE' | 'BLUR_BLACK';
export type WatermarkPlacement = 'OVERLAY' | 'BELOW';
export type LyricsFontSizeMode = 'MELOX_AUTO' | 'CUSTOM';
export type LyricsFontWeight = 'REGULAR' | 'MEDIUM' | 'SEMIBOLD' | 'BOLD' | 'HEAVY';
export type LyricsTextAlignment = 'MELOX' | 'LEFT' | 'CENTER' | 'RIGHT';
export type TrackInfoAlignment = 'FOLLOW_LYRICS' | 'LEFT' | 'CENTER' | 'RIGHT';
export type TrackInfoLayout = 'HORIZONTAL' | 'VERTICAL';

export type TrackInfoSettings = {
  enabled: boolean;
  showArtwork: boolean;
  showTitle: boolean;
  showArtist: boolean;
  showAlbum: boolean;
  layout: TrackInfoLayout;
  alignment: TrackInfoAlignment;
  scale: number;
  artworkSize: number;
  titleFontSize: number;
  titleFontWeight: LyricsFontWeight;
  secondaryFontSize: number;
  secondaryFontWeight: LyricsFontWeight;
};

export type LyricsPresentationProfile = {
  enabled: boolean;
  showLyrics: boolean;
  fontSizeMode: LyricsFontSizeMode;
  fontSize: number;
  fontWeight: LyricsFontWeight;
  alignment: LyricsTextAlignment;
  progressiveBlur: boolean;
  trackInfo: TrackInfoSettings;
};

export type LyricsPresentationOverride = Partial<
  Omit<LyricsPresentationProfile, 'trackInfo'>
> & {
  trackInfo?: Partial<TrackInfoSettings>;
};

export type LyricsPresentationSettings = {
  defaultProfile: LyricsPresentationProfile;
  displayOverrides: Record<string, LyricsPresentationOverride>;
};

export type ExportSettings = {
  resolution: ExportResolution;
  aspectRatio: ExportAspectRatio;
  width: number;
  height: number;
  distortionPreset: number;
  distortionStrength: number;
  distortionProgress: number;
  blurMultiplier: number;
  scrimAlpha: number;
  watermark: boolean;
  watermarkBackground: WatermarkBackground;
  watermarkPlacement: WatermarkPlacement;
  previewScale: number;
  askForLocation: boolean;
  defaultDirectory: string;
};

export type Settings = {
  dynamicWallpaperEnabled: boolean;
  dynamicWallpaperDisplayIds: string[] | null;
  audioVisualization: boolean;
  audioIntensity: number;
  pauseFlow: boolean;
  hideCursor: boolean;
  screenSaverDisplay: ScreenSaverDisplay;
  screenSaverDisplayIds: string[] | null;
  showConfigurationDetails: boolean;
  performanceMode: PerformanceMode;
  autoBatterySaverMax: number;
  autoBatteryBalancedMax: number;
  renderScale: number;
  blurEnabled: boolean;
  blurMultiplier: number;
  scrimAlpha: number;
  flowSpeed: FlowSpeed;
  moruStyle: MoruStyle;
  portraitPreset: number;
  landscapePreset: number;
  randomPreset: boolean;
  artworkFallback: ArtworkFallback;
  customArtwork: string;
  customArtworkName: string;
  lyricsPresentation: LyricsPresentationSettings;
};
