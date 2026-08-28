import type {
  ExportAspectRatio,
  ExportResolution,
  FlowSpeed,
  MoruStyle,
  WatermarkBackground,
  WatermarkPlacement,
} from "../types";
import type {
  AutoQuality,
  BatteryNavigator,
  PowerStatus,
  SelectOption,
  SettingsRoute,
} from "./types";

export const flowSpeeds: SelectOption<FlowSpeed>[] = [
  { value: "SLOW", label: "舒缓" },
  { value: "NORMAL", label: "标准" },
  { value: "FAST", label: "活跃" },
];

export const moruStyles: SelectOption<MoruStyle>[] = [
  { value: "OFF", label: "关闭" },
  { value: "NARROW", label: "细腻" },
  { value: "WIDE", label: "宽阔" },
  { value: "SMOOTH", label: "柔和" },
];

export const renderScales: SelectOption<number | "AUTO">[] = [
  { value: 0.5, label: "省电" },
  { value: 0.75, label: "均衡" },
  { value: 1, label: "清晰" },
  { value: "AUTO", label: "自动" },
];

export const autoQualityLabels: Record<AutoQuality, string> = {
  POWER_SAVING: "省电",
  BALANCED: "均衡",
  CLEAR: "清晰",
};

export const exportResolutions: SelectOption<ExportResolution>[] = [
  { value: "1920x1080", label: "1080p" },
  { value: "2560x1440", label: "2K" },
  { value: "3840x2160", label: "4K" },
  { value: "custom", label: "自定义" },
];

export const exportAspectRatios: SelectOption<ExportAspectRatio>[] = [
  { value: "16:9", label: "16:9" },
  { value: "16:10", label: "16:10" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "custom", label: "自定义" },
];

export const watermarkBackgrounds: SelectOption<WatermarkBackground>[] = [
  { value: "WHITE", label: "白色" },
  { value: "BLACK", label: "黑色" },
  { value: "BLUR_WHITE", label: "白色模糊" },
  { value: "BLUR_BLACK", label: "黑色模糊" },
];

export const watermarkPlacements: SelectOption<WatermarkPlacement>[] = [
  { value: "BELOW", label: "下方延伸" },
  { value: "OVERLAY", label: "覆盖图片" },
];

export const portraitPresets: SelectOption<number>[] = [
  { value: 0, label: "方案 1" },
  { value: 1, label: "方案 2" },
  { value: 2, label: "方案 3" },
  { value: 3, label: "方案 4" },
];

export const landscapePresets: SelectOption<number>[] = [
  { value: 0, label: "方案 1" },
  { value: 1, label: "方案 2" },
  { value: 2, label: "方案 3" },
  { value: 3, label: "方案 4" },
  { value: 4, label: "方案 5" },
];

export const tintLogo = new URL("../tint-logo.png", import.meta.url).href;

const minimumExportLoadingDuration = 1000;
const permissionNoticeStorageKey = "pearwall.permission-notice.v2";

export function waitForMinimumExportLoading(startedAt: number) {
  const remaining =
    minimumExportLoadingDuration - (performance.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remaining);
  });
}

export function exportWatermarkHeight(width: number, height: number) {
  return Math.max(24, Math.round(Math.min(width * 0.11, height * 0.18)));
}

export function dimensionsForAspectRatio(
  aspectRatio: Exclude<ExportAspectRatio, "custom">,
  currentWidth: number,
  currentHeight: number,
) {
  const [numerator, denominator] = aspectRatio.split(":").map(Number);
  const longEdge = Math.max(
    320,
    Math.min(4096, Math.max(currentWidth, currentHeight)),
  );
  const longRatio = Math.max(numerator, denominator);
  const shortRatio = Math.min(numerator, denominator);
  const scale = Math.min(
    4096 / longRatio,
    Math.max(longEdge / longRatio, 320 / shortRatio),
  );
  return {
    width: Math.max(320, Math.round(numerator * scale)),
    height: Math.max(320, Math.round(denominator * scale)),
  };
}

export function detectPerformanceTier(): "LOW" | "BALANCED" | "HIGH" {
  const runtimeNavigator = navigator as BatteryNavigator;
  const cores = Number(runtimeNavigator.hardwareConcurrency) || 0;
  const memory = Number(runtimeNavigator.deviceMemory) || 0;
  if (cores > 0 && cores <= 4) return "LOW";
  if (memory > 0 && memory <= 4 && cores <= 8) return "LOW";
  if (cores >= 8 && memory >= 8) return "HIGH";
  if (cores >= 12) return "HIGH";
  return "BALANCED";
}

export function resolveAutoQuality(
  status: PowerStatus | null,
  saverMax: number,
  balancedMax: number,
): AutoQuality {
  const tier = detectPerformanceTier();
  const normalizedStatus = status ?? {
    available: false,
    batteryPercent: null,
    onBattery: null,
    lowPowerMode: false,
  };
  const normalizedSaverMax = Math.max(1, Math.min(98, Math.round(saverMax)));
  const normalizedBalancedMax = Math.max(
    normalizedSaverMax + 1,
    Math.min(99, Math.round(balancedMax)),
  );
  if (normalizedStatus.lowPowerMode || tier === "LOW") return "POWER_SAVING";
  if (normalizedStatus.batteryPercent !== null) {
    if (normalizedStatus.batteryPercent < normalizedSaverMax) {
      return "POWER_SAVING";
    }
    if (normalizedStatus.batteryPercent < normalizedBalancedMax) {
      return "BALANCED";
    }
    return "CLEAR";
  }
  if (normalizedStatus.onBattery === false && tier === "HIGH") return "CLEAR";
  return "BALANCED";
}

export function shouldShowPermissionNotice() {
  try {
    return (
      window.localStorage.getItem(permissionNoticeStorageKey) !== "acknowledged"
    );
  } catch {
    return true;
  }
}

export function acknowledgePermissionNotice() {
  try {
    window.localStorage.setItem(permissionNoticeStorageKey, "acknowledged");
  } catch {
    return;
  }
}

export function readSettingsRoute(): SettingsRoute {
  return window.location.hash === "#/export-image" ? "exportImage" : "home";
}
