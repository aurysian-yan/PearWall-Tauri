export type FlowSpeed = 'SLOW' | 'NORMAL' | 'FAST';
export type MoruStyle = 'OFF' | 'NARROW' | 'WIDE' | 'SMOOTH';

export type Settings = {
  audioVisualization: boolean;
  pauseFlow: boolean;
  renderScale: number;
  blurEnabled: boolean;
  blurMultiplier: number;
  scrimAlpha: number;
  flowSpeed: FlowSpeed;
  moruStyle: MoruStyle;
  portraitPreset: number;
  landscapePreset: number;
  customArtwork: string;
  customArtworkName: string;
};
