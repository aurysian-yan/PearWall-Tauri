export type FlowSpeed = 'SLOW' | 'NORMAL' | 'FAST';
export type MoruStyle = 'OFF' | 'NARROW' | 'WIDE' | 'SMOOTH';
export type ArtworkFallback = 'DEFAULT' | 'CUSTOM' | 'DESKTOP';
export type ScreenSaverDisplay = 'PRIMARY' | 'SECONDARY';

export type Settings = {
  audioVisualization: boolean;
  audioIntensity: number;
  pauseFlow: boolean;
  hideCursor: boolean;
  screenSaverDisplay: ScreenSaverDisplay;
  screenSaverDisplayIds: string[] | null;
  showConfigurationDetails: boolean;
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
};
