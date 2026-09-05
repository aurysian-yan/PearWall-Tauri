import type { ExportSettings, Settings } from "../types";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export type DrawerPage =
  | "advanced"
  | "lyrics"
  | "dynamicWallpaperDisplays"
  | "screenSaverDisplays"
  | "licenses";

export type SettingsRoute = "home" | "exportImage";

export type MediaArtwork = {
  key: string;
  data_url: string | null;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  duration: number;
  elapsed: number;
  playback_rate: number;
};

export type ConnectedDisplay = {
  id: string;
  persistentId: string;
  name: string;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
  physicalWidthMm: number | null;
  physicalHeightMm: number | null;
  scaleFactor: number;
  isBuiltin: boolean;
  isPrimary: boolean;
};

export type WallpaperRuntimeStatus = {
  supported: boolean;
  running: boolean;
  displayCount: number;
};

export type AutoQuality = "POWER_SAVING" | "BALANCED" | "CLEAR";

export type PowerStatus = {
  available: boolean;
  batteryPercent: number | null;
  onBattery: boolean | null;
  lowPowerMode: boolean;
};

export type BatteryManagerLike = {
  level: number;
  charging: boolean;
  addEventListener: (
    type: "levelchange" | "chargingchange",
    listener: () => void,
  ) => void;
  removeEventListener: (
    type: "levelchange" | "chargingchange",
    listener: () => void,
  ) => void;
};

export type BatteryNavigator = Navigator & {
  deviceMemory?: number;
  getBattery?: () => Promise<BatteryManagerLike>;
};

export type ExportImageOptions = {
  width: number;
  height: number;
  distortionPreset: number;
  distortionStrength: number;
  distortionProgress: number;
  blurMultiplier: number;
  scrimAlpha: number;
  watermark: boolean;
  watermarkBackground: ExportSettings["watermarkBackground"];
  watermarkPlacement: ExportSettings["watermarkPlacement"];
  watermarkLogoPath?: string;
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
  songArtwork?: string;
};

export type PearWallPreviewWindow = Window & {
  PearWallExportImage?: (
    options: ExportImageOptions,
  ) => string | Promise<string>;
};

export type UpdateSetting = <Key extends keyof Settings>(
  key: Key,
  value: Settings[Key],
) => void;
