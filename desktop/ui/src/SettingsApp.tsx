import {
  Button,
  Checkbox,
  Modal,
  NumberField,
  Separator,
  Slider,
  Tabs,
  Spinner,
} from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  open as openDialog,
  save as saveFile,
} from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Drawer } from "vaul";
import { Toaster, toast } from "sonner";
import {
  CaretLeft,
  CaretRightIcon,
  SwapIcon,
  BatteryMediumIcon,
  CheckIcon,
  CornersOutIcon,
  CopyIcon,
  CursorIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DotsSixVerticalIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FrameCornersIcon,
  FolderOpenIcon,
  GithubLogoIcon,
  GaugeIcon,
  HouseIcon,
  ImageIcon,
  InfoIcon,
  MagicWandIcon,
  MonitorIcon,
  PauseIcon,
  PawPrintIcon,
  PlayIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  SpeakerHighIcon,
  UploadSimpleIcon,
  WaveformIcon,
  CircleHalfIcon,
  DropIcon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  defaultSettings,
  loadExportSettings,
  loadSettings,
  saveExportSettings,
  saveSettings,
  settingsFromJSON,
  wallpaperSettings,
} from "./settings";
import type {
  ExportAspectRatio,
  ExportResolution,
  ExportSettings,
  FlowSpeed,
  MoruStyle,
  Settings,
  WatermarkBackground,
  WatermarkPlacement,
} from "./types";
import { DynamicDrawerHandle } from "./DynamicDrawerHandle";
import { PearWallLogo } from "./PearWallLogo";
import { WindowTitleBar } from "./WindowTitleBar";
import {
  DrawerCard,
  SectionTitle,
  SettingRow,
  SettingsCard,
  Toggle,
  type IconType,
} from "./SettingsPrimitives";
import licenseDataJson from "./generated/openSourceLicenses.json";

type SelectOption<T extends string | number> = { value: T; label: string };
type DrawerPage =
  "advanced" | "dynamicWallpaperDisplays" | "screenSaverDisplays" | "licenses";
type SettingsRoute = "home" | "exportImage";
type MediaArtwork = {
  key: string;
  data_url: string | null;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
};
type ConnectedDisplay = {
  id: string;
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
type WallpaperRuntimeStatus = {
  supported: boolean;
  running: boolean;
  displayCount: number;
};
type AutoQuality = "POWER_SAVING" | "BALANCED" | "CLEAR";
type PowerStatus = {
  available: boolean;
  batteryPercent: number | null;
  onBattery: boolean | null;
  lowPowerMode: boolean;
};
type BatteryManagerLike = {
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
type BatteryNavigator = Navigator & {
  deviceMemory?: number;
  getBattery?: () => Promise<BatteryManagerLike>;
};
type ExportImageOptions = {
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
  watermarkLogoPath?: string;
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
  songArtwork?: string;
};
type PearWallPreviewWindow = Window & {
  PearWallExportImage?: (
    options: ExportImageOptions,
  ) => string | Promise<string>;
};
type UpdateSetting = <Key extends keyof Settings>(
  key: Key,
  value: Settings[Key],
) => void;

const flowSpeeds: SelectOption<FlowSpeed>[] = [
  { value: "SLOW", label: "舒缓" },
  { value: "NORMAL", label: "标准" },
  { value: "FAST", label: "活跃" },
];

const moruStyles: SelectOption<MoruStyle>[] = [
  { value: "OFF", label: "关闭" },
  { value: "NARROW", label: "细腻" },
  { value: "WIDE", label: "宽阔" },
  { value: "SMOOTH", label: "柔和" },
];

const renderScales: SelectOption<number | "AUTO">[] = [
  { value: 0.5, label: "省电" },
  { value: 0.75, label: "均衡" },
  { value: 1, label: "清晰" },
  { value: "AUTO", label: "自动" },
];

const autoQualityLabels: Record<AutoQuality, string> = {
  POWER_SAVING: "省电",
  BALANCED: "均衡",
  CLEAR: "清晰",
};

const exportResolutions: SelectOption<ExportResolution>[] = [
  { value: "1920x1080", label: "1080p" },
  { value: "2560x1440", label: "2K" },
  { value: "3840x2160", label: "4K" },
  { value: "custom", label: "自定义" },
];

const exportAspectRatios: SelectOption<ExportAspectRatio>[] = [
  { value: "16:9", label: "16:9" },
  { value: "16:10", label: "16:10" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "custom", label: "自定义" },
];

const watermarkBackgrounds: SelectOption<WatermarkBackground>[] = [
  { value: "WHITE", label: "白色" },
  { value: "BLACK", label: "黑色" },
  { value: "BLUR_WHITE", label: "白色模糊" },
  { value: "BLUR_BLACK", label: "黑色模糊" },
];

const watermarkPlacements: SelectOption<WatermarkPlacement>[] = [
  { value: "BELOW", label: "下方延伸" },
  { value: "OVERLAY", label: "覆盖图片" },
];

const minimumExportLoadingDuration = 1000;

function waitForMinimumExportLoading(startedAt: number) {
  const remaining =
    minimumExportLoadingDuration - (performance.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remaining);
  });
}

function exportWatermarkHeight(width: number, height: number) {
  return Math.max(24, Math.round(Math.min(width * 0.11, height * 0.18)));
}

function dimensionsForAspectRatio(
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

function detectPerformanceTier(): "LOW" | "BALANCED" | "HIGH" {
  const runtimeNavigator = navigator as BatteryNavigator;
  const cores = Number(runtimeNavigator.hardwareConcurrency) || 0;
  const memory = Number(runtimeNavigator.deviceMemory) || 0;
  if (cores > 0 && cores <= 4) return "LOW";
  if (memory > 0 && memory <= 4 && cores <= 8) return "LOW";
  if (cores >= 8 && memory >= 8) return "HIGH";
  if (cores >= 12) return "HIGH";
  return "BALANCED";
}

function resolveAutoQuality(
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

const portraitPresets: SelectOption<number>[] = [
  { value: 0, label: "方案 1" },
  { value: 1, label: "方案 2" },
  { value: 2, label: "方案 3" },
  { value: 3, label: "方案 4" },
];

const landscapePresets: SelectOption<number>[] = [
  { value: 0, label: "方案 1" },
  { value: 1, label: "方案 2" },
  { value: 2, label: "方案 3" },
  { value: 3, label: "方案 4" },
  { value: 4, label: "方案 5" },
];

const tintLogo = new URL("./tint-logo.png", import.meta.url).href;
const projectDependencies = licenseDataJson.frontend;
const permissionNoticeStorageKey = "pearwall.permission-notice.v2";

function shouldShowPermissionNotice() {
  try {
    return (
      window.localStorage.getItem(permissionNoticeStorageKey) !== "acknowledged"
    );
  } catch {
    return true;
  }
}

function readSettingsRoute(): SettingsRoute {
  return window.location.hash === "#/export-image" ? "exportImage" : "home";
}

function acknowledgePermissionNotice() {
  try {
    window.localStorage.setItem(permissionNoticeStorageKey, "acknowledged");
  } catch {
    return;
  }
}

function ExternalSettingRow({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: IconType;
  title: string;
  description?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block"
      onClick={(event) => {
        if (!("__TAURI_INTERNALS__" in window)) return;
        event.preventDefault();
        void openUrl(href).catch(() => undefined);
      }}
    >
      <SettingRow icon={icon} title={title} description={description}>
        <GithubLogoIcon aria-hidden size={18} className="text-white/55" />
      </SettingRow>
    </a>
  );
}

function RangeSetting({
  label,
  value,
  minValue,
  maxValue,
  step,
  onChange,
  icon: Icon,
}: {
  icon: IconType;
  label: string;
  value: number;
  minValue: number;
  maxValue: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="px-4 py-4">
      <div className="mb-3 gap-3 flex items-center justify-between text-sm font-medium text-white/80">
        <Icon
          aria-hidden
          size={20}
          weight="regular"
          className="shrink-0 text-white/90"
        />
        <span className="w-full text-[14px] font-semibold text-white">
          {label}
        </span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <Slider
        aria-label={label}
        value={value}
        minValue={minValue}
        maxValue={maxValue}
        step={step}
        onChange={(next) => onChange(Number(next))}
      >
        <Slider.Track className="bg-white/20">
          <Slider.Fill />
          <Slider.Thumb className="border-0 bg-white shadow-md" />
        </Slider.Track>
      </Slider>
    </div>
  );
}

function BatteryRangeSetting({
  values,
  currentQuality,
  onChange,
  icon: Icon,
}: {
  icon: IconType;
  values: [number, number];
  currentQuality: AutoQuality;
  onChange: (values: [number, number]) => void;
}) {
  const [saverMax, balancedMax] = values;

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm font-medium text-white/80">
        <Icon
          aria-hidden
          size={20}
          weight="regular"
          className="shrink-0 text-white/90"
        />
        <span className="w-full text-[14px] font-semibold text-white">
          自动电量范围
        </span>
        <span className="whitespace-nowrap text-white/75">
          {saverMax}% / {balancedMax}%
        </span>
      </div>
      <div className="relative">
        <Slider
          aria-label="自动电量范围"
          value={[saverMax / 100, balancedMax / 100]}
          minValue={0}
          maxValue={1}
          step={0.01}
          onChange={(next) => {
            if (!Array.isArray(next) || next.length < 2) return;
            const ordered = next
              .map((value) => Math.round(Number(value) * 100))
              .sort((left, right) => left - right);
            const nextSaverMax = Math.min(98, Math.max(1, ordered[0]));
            const nextBalancedMax = Math.min(
              99,
              Math.max(nextSaverMax + 1, ordered[1]),
            );
            onChange([nextSaverMax, nextBalancedMax]);
          }}
        >
          <Slider.Track className="bg-white/20">
            <Slider.Fill />
            <Slider.Thumb
              index={0}
              aria-label="省电上限"
              className="border-0 bg-white shadow-md"
            />
            <Slider.Thumb
              index={1}
              aria-label="均衡上限"
              className="border-0 bg-white shadow-md"
            />
          </Slider.Track>
        </Slider>
      </div>
      <div className="mt-1 flex justify-between text-xs text-white/55">
        <span>省电 &lt; {saverMax}%</span>
        <span>
          均衡 {saverMax}–{balancedMax - 1}%
        </span>
        <span>清晰 ≥ {balancedMax}%</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-white/65">
        <span>当前档位</span>
        <span className="font-semibold text-white">
          {autoQualityLabels[currentQuality]}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/45">
        自动模式参考：设备性能档位、电池电量、供电状态和系统低电量模式
      </p>
    </div>
  );
}

function ChoiceTabs<T extends string | number>({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  variant = "default",
  showLabel = true,
}: {
  icon: IconType;
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  variant?: "default" | "drawer";
  showLabel?: boolean;
}) {
  const isDrawerVariant = variant === "drawer";

  return (
    <div className="px-4 py-4">
      {showLabel && (
        <div className="mb-3 flex items-center gap-3">
          <Icon
            aria-hidden
            size={20}
            weight="regular"
            className="shrink-0 text-white/90"
          />
          <span className="text-[14px] font-semibold text-white">{label}</span>
        </div>
      )}
      <Tabs
        selectedKey={String(value)}
        onSelectionChange={(key) => {
          const selected = options.find(
            (option) => String(option.value) === String(key),
          );
          if (selected) onChange(selected.value);
        }}
        className={`w-[calc(100%+0.5rem)] -mx-1 ${isDrawerVariant ? "rounded-[18px]" : ""}`}
      >
        <Tabs.ListContainer
          className={`w-full ${isDrawerVariant ? "!bg-white/8" : "!bg-white/10"}`}
        >
          <Tabs.List aria-label={label} className="w-full">
            {options.map((option) => (
              <Tabs.Tab
                id={String(option.value)}
                key={String(option.value)}
                className="!text-white/65 data-[selected=true]:!text-neutral-900"
              >
                <Tabs.Indicator className="!bg-white shadow-none" />
                {option.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
    </div>
  );
}

function aspectRatioLabel(width: number, height: number) {
  const ratio = width / Math.max(1, height);
  const commonRatios = [
    { width: 16, height: 9 },
    { width: 16, height: 10 },
    { width: 3, height: 2 },
    { width: 4, height: 3 },
    { width: 21, height: 9 },
    { width: 32, height: 9 },
  ];
  const common = commonRatios.find(
    (value) => Math.abs(ratio - value.width / value.height) < 0.015,
  );
  return common ? `${common.width}:${common.height}` : `${ratio.toFixed(2)}:1`;
}

function displayName(display: ConnectedDisplay, index: number) {
  return display.name.startsWith("Monitor #")
    ? `显示器 ${index + 1}`
    : display.name;
}

function physicalSizeLabel(display: ConnectedDisplay) {
  if (!display.physicalWidthMm || !display.physicalHeightMm) return null;
  const diagonalInches =
    Math.hypot(display.physicalWidthMm, display.physicalHeightMm) / 25.4;
  return `${diagonalInches.toFixed(1)} 英寸`;
}

function densityLabel(display: ConnectedDisplay) {
  if (display.scaleFactor > 1) {
    return `${display.isBuiltin ? "Retina" : "HiDPI"} ${display.scaleFactor}×`;
  }
  return "标准分辨率 1×";
}

function DisplayArrangement({
  displays,
  selectedIds,
}: {
  displays: ConnectedDisplay[];
  selectedIds: string[];
}) {
  const previewRef = useRef<SVGSVGElement>(null);
  const [previewViewport, setPreviewViewport] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const updateViewport = () => {
      const bounds = preview.getBoundingClientRect();
      setPreviewViewport({ width: bounds.width, height: bounds.height });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [displays.length]);

  if (displays.length === 0) return null;
  const logicalFrames = displays.map((display) => ({
    ...display,
    logicalWidth: display.width / Math.max(1, display.scaleFactor),
    logicalHeight: display.height / Math.max(1, display.scaleFactor),
  }));
  const anchor =
    logicalFrames.find((display) => display.isPrimary) ?? logicalFrames[0];
  const usePhysicalSize = logicalFrames.every(
    (display) => display.physicalWidthMm && display.physicalHeightMm,
  );
  const horizontalScale = usePhysicalSize
    ? anchor.physicalWidthMm! / anchor.logicalWidth
    : 1;
  const verticalScale = usePhysicalSize
    ? anchor.physicalHeightMm! / anchor.logicalHeight
    : 1;
  const anchorCenterX = anchor.positionX + anchor.logicalWidth / 2;
  const anchorCenterY = anchor.positionY + anchor.logicalHeight / 2;
  const frames = logicalFrames.map((display) => {
    const visualWidth = usePhysicalSize
      ? display.physicalWidthMm!
      : display.logicalWidth;
    const visualHeight = usePhysicalSize
      ? display.physicalHeightMm!
      : display.logicalHeight;
    return {
      ...display,
      visualWidth,
      visualHeight,
      visualX:
        (display.positionX + display.logicalWidth / 2 - anchorCenterX) *
          horizontalScale -
        visualWidth / 2,
      visualY:
        (display.positionY + display.logicalHeight / 2 - anchorCenterY) *
          verticalScale -
        visualHeight / 2,
    };
  });
  const displayGap =
    Math.max(
      ...frames.flatMap((display) => [
        display.visualWidth,
        display.visualHeight,
      ]),
    ) * 0.012;
  const relationTolerance = 0.5;

  for (let pass = 0; pass < frames.length * frames.length; pass += 1) {
    let adjusted = false;
    for (let firstIndex = 0; firstIndex < frames.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < frames.length;
        secondIndex += 1
      ) {
        const first = frames[firstIndex];
        const second = frames[secondIndex];
        const overlapsHorizontally =
          first.visualX < second.visualX + second.visualWidth &&
          second.visualX < first.visualX + first.visualWidth;
        const overlapsVertically =
          first.visualY < second.visualY + second.visualHeight &&
          second.visualY < first.visualY + first.visualHeight;
        if (!overlapsHorizontally || !overlapsVertically) continue;

        const adjustments: Array<{
          distance: number;
          apply: () => void;
        }> = [];
        if (
          first.positionX + first.logicalWidth <=
          second.positionX + relationTolerance
        ) {
          const distance =
            first.visualX + first.visualWidth + displayGap - second.visualX;
          adjustments.push({
            distance,
            apply: () => {
              second.visualX += distance;
            },
          });
        }
        if (
          second.positionX + second.logicalWidth <=
          first.positionX + relationTolerance
        ) {
          const distance =
            second.visualX + second.visualWidth + displayGap - first.visualX;
          adjustments.push({
            distance,
            apply: () => {
              first.visualX += distance;
            },
          });
        }
        if (
          first.positionY + first.logicalHeight <=
          second.positionY + relationTolerance
        ) {
          const distance =
            first.visualY + first.visualHeight + displayGap - second.visualY;
          adjustments.push({
            distance,
            apply: () => {
              second.visualY += distance;
            },
          });
        }
        if (
          second.positionY + second.logicalHeight <=
          first.positionY + relationTolerance
        ) {
          const distance =
            second.visualY + second.visualHeight + displayGap - first.visualY;
          adjustments.push({
            distance,
            apply: () => {
              first.visualY += distance;
            },
          });
        }

        const smallestAdjustment = adjustments
          .filter((value) => value.distance > 0)
          .sort((left, right) => left.distance - right.distance)[0];
        if (smallestAdjustment) {
          smallestAdjustment.apply();
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }
  const minX = Math.min(...frames.map((display) => display.visualX));
  const minY = Math.min(...frames.map((display) => display.visualY));
  const maxX = Math.max(
    ...frames.map((display) => display.visualX + display.visualWidth),
  );
  const maxY = Math.max(
    ...frames.map((display) => display.visualY + display.visualHeight),
  );
  const padding = Math.max(maxX - minX, maxY - minY) * 0.04;
  const viewBoxWidth = maxX - minX + padding * 2;
  const viewBoxHeight = maxY - minY + padding * 2;
  const previewScale =
    previewViewport.width > 0 && previewViewport.height > 0
      ? Math.min(
          previewViewport.width / viewBoxWidth,
          previewViewport.height / viewBoxHeight,
        )
      : 1;
  const labelSize = 14 / Math.max(previewScale, 0.01);
  const primaryIconSize = 12 / Math.max(previewScale, 0.01);
  const cornerRadius = 8 / Math.max(previewScale, 0.01);
  const strokeWidth = 1.5 / Math.max(previewScale, 0.01);

  return (
    <>
      <SmoothCorners
        asChild
        autoEffects={false}
        corners={{ radius: 16, smoothing: 0.7 }}
      >
        <div className="mt-4 h-44 w-full bg-white/5 p-4">
          <svg
            ref={previewRef}
            aria-label="显示器排列预览"
            className="h-full w-full"
            viewBox={`${minX - padding} ${minY - padding} ${viewBoxWidth} ${viewBoxHeight}`}
          >
            {frames.map((display, index) => {
              const enabled = selectedIds.includes(display.id);
              return (
                <g key={display.id}>
                  <rect
                    x={display.visualX}
                    y={display.visualY}
                    width={display.visualWidth}
                    height={display.visualHeight}
                    rx={cornerRadius}
                    fill={
                      enabled
                        ? "rgba(255,255,255,0.18)"
                        : "rgba(255,255,255,0.04)"
                    }
                    stroke={
                      enabled
                        ? "rgba(255,255,255,0.9)"
                        : "rgba(255,255,255,0.3)"
                    }
                    strokeWidth={strokeWidth}
                  />
                  <text
                    x={display.visualX + display.visualWidth / 2}
                    y={display.visualY + display.visualHeight / 2}
                    dy="0.12em"
                    fill={
                      enabled
                        ? "rgba(255,255,255,0.95)"
                        : "rgba(255,255,255,0.45)"
                    }
                    fontSize={labelSize}
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {index + 1}
                  </text>
                  {display.isPrimary && (
                    <HouseIcon
                      aria-label="主屏幕"
                      x={
                        display.visualX +
                        display.visualWidth / 2 -
                        primaryIconSize / 2
                      }
                      y={display.visualY + display.visualHeight * 0.7}
                      width={primaryIconSize}
                      height={primaryIconSize}
                      color="rgba(255,255,255,0.7)"
                      weight="fill"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </SmoothCorners>
      <p className="mt-2 px-1 text-center text-[11px] text-white/45">
        屏幕位置、序号与尺寸仅用于参考
      </p>
    </>
  );
}

function DisplaySelector({
  title,
  selectionLabel,
  displays,
  selectedIds,
  loading,
  failed,
  showArrangement = true,
  onChange,
}: {
  title: string;
  selectionLabel: string;
  displays: ConnectedDisplay[];
  selectedIds: string[];
  loading: boolean;
  failed: boolean;
  showArrangement?: boolean;
  onChange: (id: string, enabled: boolean) => void;
}) {
  const enabledDisplayCount = displays.filter((display) =>
    selectedIds.includes(display.id),
  ).length;

  return (
    <div className="px-4 pt-4 pb-1">
      <div className="flex items-center gap-3">
        <MonitorIcon
          aria-hidden
          size={20}
          weight="regular"
          className="shrink-0 text-white/90"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-white/65">
            {loading
              ? "正在识别已连接的显示器"
              : failed
                ? "暂时无法读取显示器信息"
                : `已连接 ${displays.length} 台，已启用 ${enabledDisplayCount} 台`}
          </div>
        </div>
      </div>

      {showArrangement && (
        <DisplayArrangement displays={displays} selectedIds={selectedIds} />
      )}

      {displays.length > 0 && (
        <div className="mt-3 divide-y divide-white/10">
          {displays.map((display, index) => (
            <Checkbox
              key={display.id}
              aria-label={`${displayName(display, index)}${selectionLabel}`}
              className="w-full"
              isSelected={selectedIds.includes(display.id)}
              onChange={(enabled) => onChange(display.id, enabled)}
            >
              {({ isSelected }) => (
                <Checkbox.Content className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
                  <Checkbox.Control className="!size-7 !rounded-full !border-white/25 !bg-white/10 before:!rounded-full">
                    <span
                      aria-hidden
                      className={`relative z-10 text-[11px] font-semibold transition-opacity ${isSelected ? "opacity-0" : "opacity-100"}`}
                    >
                      {index + 1}
                    </span>
                    <Checkbox.Indicator className="absolute z-10 !size-4 [&_svg]:!stroke-[3px]" />
                  </Checkbox.Control>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">
                        {displayName(display, index)}
                      </span>
                      {display.isPrimary && (
                        <SmoothCorners
                          asChild
                          autoEffects={false}
                          corners={{ radius: 12, smoothing: 1 }}
                        >
                          <span className="bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white/85">
                            主屏幕
                          </span>
                        </SmoothCorners>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      {[
                        `${display.width} × ${display.height}`,
                        aspectRatioLabel(display.width, display.height),
                        physicalSizeLabel(display),
                        densityLabel(display),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </Checkbox.Content>
              )}
            </Checkbox>
          ))}
        </div>
      )}
    </div>
  );
}

function DrawerHeader({
  title,
  progress,
  onBack,
  className,
}: {
  title: string;
  progress: number;
  onBack?: () => void;
  className?: string;
}) {
  const backButton = (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      aria-label="返回"
      onPress={onBack}
      className="z-30 !bg-white/8 text-white/75 hover:!bg-white/20 hover:text-white !p-0 backdrop-blur-[10px] backdrop-saturate-150 min-w-9 min-h-9 -m-1"
    >
      <CaretLeft aria-hidden size={24} className="absolute min-w-6 min-h-6" />
    </Button>
  );

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-16 ${className ?? ""}`}
    >
      <div className="relative flex h-16 items-center justify-between px-5 pt-2">
        <div className="pointer-events-auto">
          {onBack ? (
            backButton
          ) : (
            <Drawer.Close asChild>{backButton}</Drawer.Close>
          )}
        </div>
        {onBack ? (
          <h1 className="z-30 pointer-events-none absolute inset-x-20 truncate text-center text-base font-semibold text-white -mt-1">
            {title}
          </h1>
        ) : (
          <span
            aria-hidden
            className="z-30 pointer-events-none absolute inset-x-20 truncate text-center text-base font-semibold text-white transition-opacity duration-200 -mt-1"
            style={{ opacity: progress }}
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

function DrawerHero({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: IconType;
}) {
  return (
    <div className="px-4 pb-5 pt-18">
      <SmoothCorners
        asChild
        autoEffects={false}
        corners={{ radius: 18, smoothing: 0.6 }}
      >
        <div className=" bg-white/8 px-5 pb-6 pt-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white/85">
            <Icon aria-hidden size={24} weight="regular" />
          </div>
          <Drawer.Title className="mt-2 text-[18px] font-semibold text-white">
            {title}
          </Drawer.Title>
          <Drawer.Description className="mt-1 text-[12px] leading-relaxed text-white/65">
            {description}
          </Drawer.Description>
        </div>
      </SmoothCorners>
    </div>
  );
}

function ExportImagePreview({
  previewUrl,
  previewPending,
  previewFailed,
  width,
  height,
  watermarkHeight,
  previewScale,
  availableWidth,
  onResize,
}: {
  previewUrl: string;
  previewPending: boolean;
  previewFailed: boolean;
  width: number;
  height: number;
  watermarkHeight: number;
  previewScale: number;
  availableWidth: number;
  onResize: (scale: number) => void;
}) {
  const previewHeight = 256;
  const previewHorizontalPadding = 24;
  const basePreviewWidth = Math.max(
    1,
    Math.round((previewHeight * width) / Math.max(1, height + watermarkHeight)),
  );
  const displayScale = Math.min(
    previewScale,
    availableWidth > 0
      ? Math.max(1, availableWidth - previewHorizontalPadding) /
        basePreviewWidth
      : previewScale,
  );
  const previewWidth = Math.max(1, Math.round(basePreviewWidth * displayScale));
  const scaledPreviewHeight = Math.max(
    1,
    Math.round(previewHeight * displayScale),
  );

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startScale = previewScale;
    const scalePerPixel = 1 / Math.max(1, previewHeight);
    const handleMove = (moveEvent: PointerEvent) => {
      const nextScale = Math.max(
        0.75,
        Math.min(
          1.5,
          startScale + (moveEvent.clientX - startX) * scalePerPixel,
        ),
      );
      onResize(nextScale);
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize, { once: true });
  };

  return (
    <div className="flex min-h-100 w-full min-w-0 items-center justify-center">
      <SettingsCard className="!mx-auto !w-fit min-w-0 max-w-full">
        <div className="flex min-w-0 max-w-full justify-center px-3 py-3">
          <SmoothCorners
            asChild
            autoEffects={false}
            corners={{ radius: 12, smoothing: 0.6 }}
          >
            <div
              className="relative flex min-w-0 max-w-full shrink-0 items-center justify-center overflow-hidden bg-black/35"
              style={{
                width: `${previewWidth}px`,
                height: `${scaledPreviewHeight}px`,
              }}
            >
              {previewUrl && (
                <SmoothCorners
                  asChild
                  autoEffects={false}
                  corners={{ radius: 12, smoothing: 0.6 }}
                >
                  <img
                    src={previewUrl}
                    alt="导出效果预览"
                    className={`absolute left-1/2 top-1/2 max-w-none object-contain transition-opacity ${previewPending ? "opacity-60" : "opacity-100"}`}
                    style={{
                      width: `${previewWidth}px`,
                      height: `${scaledPreviewHeight}px`,
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                </SmoothCorners>
              )}
              {!previewUrl && (
                <p className="px-4 text-center text-xs text-white/55">
                  {previewFailed ? "暂时无法生成效果预览" : "正在生成效果预览…"}
                </p>
              )}
              {previewUrl && previewPending && (
                <p className="absolute bottom-3 right-3 text-xs text-white/65">
                  正在更新预览…
                </p>
              )}
              <button
                type="button"
                aria-label="调整预览大小"
                className="absolute inset-y-0 right-0 flex w-5 cursor-ew-resize items-center justify-center text-white/70 opacity-75 transition-opacity hover:opacity-100"
                onPointerDown={startResize}
              >
                <DotsSixVerticalIcon aria-hidden size={16} weight="bold" />
              </button>
            </div>
          </SmoothCorners>
        </div>
      </SettingsCard>
    </div>
  );
}

function ExportImagePage({
  onPreview,
  onExport,
  onCopy,
  onChooseDefaultDirectory,
  isTauriRuntime,
  onBack,
}: {
  onPreview: (options: ExportImageOptions) => string | Promise<string>;
  onExport: (
    options: ExportImageOptions,
    destination: Pick<ExportSettings, "askForLocation" | "defaultDirectory">,
  ) => Promise<string>;
  onCopy: (options: ExportImageOptions) => Promise<string>;
  onChooseDefaultDirectory: (
    currentDirectory: string,
  ) => Promise<string | null>;
  isTauriRuntime: boolean;
  onBack: () => void;
}) {
  const [exportSettings, setExportSettings] =
    useState<ExportSettings>(loadExportSettings);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewPending, setPreviewPending] = useState(true);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewContainerWidth, setPreviewContainerWidth] = useState(0);
  const {
    resolution,
    aspectRatio,
    width,
    height,
    distortionPreset,
    distortionStrength,
    distortionProgress,
    blurMultiplier,
    scrimAlpha,
    watermark,
    watermarkBackground,
    watermarkPlacement,
    previewScale,
    askForLocation,
    defaultDirectory,
  } = exportSettings;
  const updateExportSetting = <Key extends keyof ExportSettings>(
    key: Key,
    value: ExportSettings[Key],
  ) => {
    setExportSettings((current) => ({ ...current, [key]: value }));
  };
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    const updateWidth = () => {
      const styles = window.getComputedStyle(container);
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft) +
        Number.parseFloat(styles.paddingRight);
      setPreviewContainerWidth(
        Math.max(1, Math.floor(container.clientWidth - horizontalPadding)),
      );
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const portrait = height >= width;
  const presetOptions = portrait ? portraitPresets : landscapePresets;
  const selectedPreset = Math.min(distortionPreset, presetOptions.length - 1);
  const watermarkHeight =
    watermark && watermarkPlacement === "BELOW"
      ? exportWatermarkHeight(width, height)
      : 0;

  useEffect(() => {
    saveExportSettings(exportSettings);
  }, [exportSettings]);

  useEffect(() => {
    let disposed = false;
    setPreviewPending(true);
    const timer = window.setTimeout(() => {
      const renderPreview = async () => {
        try {
          const scale = Math.min(1, 720 / Math.max(width, height));
          const nextPreviewUrl = await onPreview({
            width: Math.max(64, Math.round(width * scale)),
            height: Math.max(64, Math.round(height * scale)),
            distortionPreset: selectedPreset,
            distortionStrength,
            distortionProgress,
            blurMultiplier,
            scrimAlpha,
            watermark,
            watermarkBackground,
            watermarkPlacement,
          });
          if (disposed) return;
          setPreviewUrl(nextPreviewUrl);
          setPreviewFailed(false);
        } catch {
          if (disposed) return;
          setPreviewFailed(true);
        } finally {
          if (!disposed) setPreviewPending(false);
        }
      };
      void renderPreview();
    }, 120);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [
    blurMultiplier,
    distortionProgress,
    distortionStrength,
    height,
    onPreview,
    scrimAlpha,
    selectedPreset,
    watermark,
    watermarkBackground,
    watermarkPlacement,
    width,
  ]);

  const selectResolution = (value: ExportResolution) => {
    setExportSettings((current) => {
      if (value === "custom") {
        return { ...current, resolution: value };
      }
      const [nextWidth, nextHeight] = value.split("x").map(Number);
      return {
        ...current,
        resolution: value,
        width: nextWidth,
        height: nextHeight,
        aspectRatio: "16:9",
        distortionPreset: Math.min(current.distortionPreset, 4),
      };
    });
  };

  const selectAspectRatio = (value: ExportAspectRatio) => {
    setExportSettings((current) => {
      if (value === "custom") {
        return { ...current, aspectRatio: value };
      }
      const nextDimensions = dimensionsForAspectRatio(
        value,
        current.width,
        current.height,
      );
      const matchingResolution = exportResolutions.find(
        (option) =>
          option.value !== "custom" &&
          option.value === `${nextDimensions.width}x${nextDimensions.height}`,
      )?.value;
      return {
        ...current,
        aspectRatio: value,
        width: nextDimensions.width,
        height: nextDimensions.height,
        resolution: matchingResolution ?? "custom",
      };
    });
  };

  const changeWidth = (value: number) => {
    if (!Number.isFinite(value)) return;
    setExportSettings((current) => ({
      ...current,
      resolution: "custom",
      aspectRatio: "custom",
      width: Math.round(value),
    }));
  };

  const changeHeight = (value: number) => {
    if (!Number.isFinite(value)) return;
    setExportSettings((current) => ({
      ...current,
      resolution: "custom",
      aspectRatio: "custom",
      height: Math.round(value),
    }));
  };

  const swapDimensions = () => {
    setExportSettings((current) => ({
      ...current,
      resolution: "custom",
      aspectRatio: "custom",
      width: current.height,
      height: current.width,
    }));
  };

  const currentExportOptions = (): ExportImageOptions => ({
    width: Math.max(320, Math.min(4096, width)),
    height: Math.max(320, Math.min(4096, height)),
    distortionPreset: selectedPreset,
    distortionStrength,
    distortionProgress,
    blurMultiplier,
    scrimAlpha,
    watermark,
    watermarkBackground,
    watermarkPlacement,
  });

  const exportImage = async () => {
    const startedAt = performance.now();
    setExporting(true);
    try {
      const result = await onExport(currentExportOptions(), {
        askForLocation,
        defaultDirectory,
      });
      if (result) toast.success(result);
    } catch (error) {
      toast.error(String(error));
    } finally {
      await waitForMinimumExportLoading(startedAt);
      setExporting(false);
    }
  };

  const copyImage = async () => {
    const startedAt = performance.now();
    setCopying(true);
    try {
      const result = await onCopy(currentExportOptions());
      if (result) toast.success(result);
    } catch (error) {
      toast.error(String(error));
    } finally {
      await waitForMinimumExportLoading(startedAt);
      setCopying(false);
    }
  };

  const chooseDefaultDirectory = async () => {
    try {
      const directory = await onChooseDefaultDirectory(defaultDirectory);
      if (directory) updateExportSetting("defaultDirectory", directory);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <DrawerHeader
        title="导出图片"
        progress={1}
        onBack={onBack}
        className="top-12 z-[60]"
      />
      <div
        ref={previewContainerRef}
        className="flex w-full min-w-0 shrink-0 justify-center px-4 pb-5 z-50 pt-32"
      >
        <ExportImagePreview
          previewUrl={previewUrl}
          previewPending={previewPending}
          previewFailed={previewFailed}
          width={width}
          height={height}
          watermarkHeight={watermarkHeight}
          previewScale={previewScale}
          availableWidth={previewContainerWidth}
          onResize={(value) => updateExportSetting("previewScale", value)}
        />
      </div>
      <OverlayScrollbarsComponent
        defer
        className="export-image-scrollbar min-h-0 flex-1 -my-32 overscroll-contain"
        options={{
          overflow: { x: "hidden", y: "scroll" },
          scrollbars: {
            theme: "os-theme-light",
            autoHide: "scroll",
            autoHideDelay: 700,
          },
        }}
      >
        <div className="flex flex-col gap-5 px-4 pt-30 pb-34 box-border">
          <div className="order-2">
            <SettingsCard>
              <ChoiceTabs
                icon={MagicWandIcon}
                label="封面扭曲方案"
                value={selectedPreset}
                options={presetOptions}
                onChange={(value) =>
                  updateExportSetting("distortionPreset", value)
                }
                variant="drawer"
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <RangeSetting
                icon={FrameCornersIcon}
                label="扭曲强度"
                value={distortionStrength}
                minValue={0}
                maxValue={1.5}
                step={0.05}
                onChange={(value) =>
                  updateExportSetting("distortionStrength", value)
                }
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <RangeSetting
                icon={PlayIcon}
                label="扭曲位置"
                value={distortionProgress}
                minValue={0}
                maxValue={1}
                step={0.01}
                onChange={(value) =>
                  updateExportSetting("distortionProgress", value)
                }
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <RangeSetting
                icon={DropIcon}
                label="导出模糊强度"
                value={blurMultiplier}
                minValue={0}
                maxValue={2}
                step={0.05}
                onChange={(value) =>
                  updateExportSetting("blurMultiplier", value)
                }
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <RangeSetting
                icon={CircleHalfIcon}
                label="导出画面遮罩"
                value={scrimAlpha}
                minValue={0}
                maxValue={0.8}
                step={0.05}
                onChange={(value) => updateExportSetting("scrimAlpha", value)}
              />
            </SettingsCard>
          </div>
          <div className="order-1">
            <SettingsCard>
              <ChoiceTabs
                icon={CornersOutIcon}
                label="导出分辨率"
                value={resolution}
                options={exportResolutions}
                onChange={selectResolution}
                variant="drawer"
                showLabel={false}
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <ChoiceTabs
                icon={FrameCornersIcon}
                label="图片比例"
                value={aspectRatio}
                options={exportAspectRatios}
                onChange={selectAspectRatio}
                variant="drawer"
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <div className="grid grid-cols-2 gap-3 px-4 py-4">
                <div className="min-w-0">
                  <div className="mb-2 text-xs font-medium text-white/65">
                    宽度
                  </div>
                  <NumberField
                    aria-label="导出宽度"
                    value={width}
                    minValue={320}
                    maxValue={4096}
                    step={1}
                    onChange={changeWidth}
                    fullWidth
                  >
                    <NumberField.Group className="!w-full !grid-cols-1 !bg-white/8">
                      <NumberField.Input className="!w-full min-w-0 text-white" />
                    </NumberField.Group>
                  </NumberField>
                </div>
                <div className="min-w-0">
                  <div className="mb-2 text-xs font-medium text-white/65">
                    高度
                  </div>
                  <NumberField
                    aria-label="导出高度"
                    value={height}
                    minValue={320}
                    maxValue={4096}
                    step={1}
                    onChange={changeHeight}
                    fullWidth
                  >
                    <NumberField.Group className="!w-full !grid-cols-1 !bg-white/8">
                      <NumberField.Input className="!w-full min-w-0 text-white" />
                    </NumberField.Group>
                  </NumberField>
                </div>
                <div className="col-span-2 flex justify-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={swapDimensions}
                    className="gap-2 bg-white/8 px-3 text-white/75 hover:bg-white/15 hover:text-white"
                  >
                    <SwapIcon aria-hidden size={18} weight="bold" />
                    <span>交换宽高</span>
                  </Button>
                </div>
                <p className="col-span-2 text-xs text-white/45">
                  单边范围为 320–4096 像素，图片最大为 2000 万像素
                </p>
              </div>
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <SettingRow
                icon={ImageIcon}
                title="添加歌曲水印"
                description="添加 Logo 与歌曲信息"
              >
                <Toggle
                  label="添加歌曲水印"
                  value={watermark}
                  onChange={(value) => updateExportSetting("watermark", value)}
                />
              </SettingRow>
              {watermark && (
                <>
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                  <ChoiceTabs
                    icon={FrameCornersIcon}
                    label="水印位置"
                    value={watermarkPlacement}
                    options={watermarkPlacements}
                    onChange={(value) =>
                      updateExportSetting("watermarkPlacement", value)
                    }
                    variant="drawer"
                  />
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                  <ChoiceTabs
                    icon={CircleHalfIcon}
                    label="水印背景"
                    value={watermarkBackground}
                    options={watermarkBackgrounds}
                    onChange={(value) =>
                      updateExportSetting("watermarkBackground", value)
                    }
                    variant="drawer"
                  />
                </>
              )}
            </SettingsCard>
          </div>
          <div className="order-3">
            <SettingsCard>
              <SettingRow
                icon={DownloadSimpleIcon}
                title="导出时询问导出位置"
                description="每次导出前选择保存位置和文件名"
              >
                <Toggle
                  label="导出时询问导出位置"
                  value={askForLocation}
                  onChange={(value) =>
                    updateExportSetting("askForLocation", value)
                  }
                />
              </SettingRow>
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <SettingRow
                icon={FolderOpenIcon}
                title="默认导出目录"
                description={
                  defaultDirectory ||
                  (isTauriRuntime
                    ? "未设置时使用图片/Pear Wall"
                    : "桌面版可设置默认目录")
                }
              >
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={!isTauriRuntime}
                  onPress={() => void chooseDefaultDirectory()}
                  className="bg-white/10 text-white"
                >
                  <FolderOpenIcon aria-hidden size={18} />
                  选择
                </Button>
              </SettingRow>
            </SettingsCard>
          </div>
        </div>
      </OverlayScrollbarsComponent>

      <div className="shrink-0 px-4 pb-0 pt-6 min-h-24">
        <div className="grid grid-cols-2 gap-3">
          <SmoothCorners
            asChild
            autoEffects={false}
            corners={{ radius: 28, smoothing: 1 }}
            shadow={{
              offsetX: 0,
              offsetY: 4,
              blur: 12,
              spread: 0,
              color: "#000000",
              opacity: 0.1,
            }}
            shadowStrategy="box-shadow"
          >
            <Button
              fullWidth
              size="lg"
              isDisabled={exporting || copying}
              onPress={() => void copyImage()}
              className="flex h-13 bg-white/80 backdrop-blur-[10px] backdrop-saturate-150 text-base font-semibold !text-neutral-900"
            >
              {copying ? (
                <div className="w-4.5 h-4.5 flex items-center justify-center">
                  <Spinner color="current" className="scale-90" />
                </div>
              ) : (
                <CopyIcon aria-hidden size={18} weight="bold" />
              )}
              {copying ? "正在复制…" : "复制图片"}
            </Button>
          </SmoothCorners>
          <SmoothCorners
            asChild
            autoEffects={false}
            corners={{ radius: 28, smoothing: 1 }}
            shadow={{
              offsetX: 0,
              offsetY: 4,
              blur: 12,
              spread: 0,
              color: "#000000",
              opacity: 0.1,
            }}
            shadowStrategy="box-shadow"
          >
            <Button
              fullWidth
              size="lg"
              isDisabled={exporting || copying}
              onPress={() => void exportImage()}
              className="flex h-13 bg-white/80 backdrop-blur-[10px] backdrop-saturate-150 text-base font-semibold !text-neutral-900"
            >
              {exporting ? (
                <div className="w-4.5 h-4.5 flex items-center justify-center">
                  <Spinner color="current" className="scale-90" />
                </div>
              ) : (
                <DownloadSimpleIcon aria-hidden size={18} weight="bold" />
              )}
              {exporting ? "正在导出…" : "导出 PNG"}
            </Button>
          </SmoothCorners>
        </div>
      </div>
    </div>
  );
}

function DrawerPageContent({
  page,
  settings,
  currentAutoQuality,
  update,
  isMacOSRuntime,
  supportsScreenSaverDisplays,
  connectedDisplays,
  displayLoading,
  displayDiscoveryFailed,
  onDynamicWallpaperDisplayChange,
  onScreenSaverDisplayChange,
}: {
  page: DrawerPage;
  settings: Settings;
  currentAutoQuality: AutoQuality;
  update: UpdateSetting;
  isMacOSRuntime: boolean;
  supportsScreenSaverDisplays: boolean;
  connectedDisplays: ConnectedDisplay[];
  displayLoading: boolean;
  displayDiscoveryFailed: boolean;
  onDynamicWallpaperDisplayChange: (id: string, enabled: boolean) => void;
  onScreenSaverDisplayChange: (id: string, enabled: boolean) => void;
}) {
  const titles: Record<DrawerPage, string> = {
    advanced: "高级设置",
    dynamicWallpaperDisplays: "动态壁纸显示器",
    screenSaverDisplays: "屏保显示器",
    licenses: "开源许可",
  };
  const descriptions: Record<DrawerPage, string> = {
    advanced: isMacOSRuntime
      ? "调整渲染质量、屏幕方向方案和屏保配置详情。"
      : "调整渲染质量与屏幕方向方案，也可以让 Pear Wall 自动随机切换。",
    dynamicWallpaperDisplays: "选择用于显示动态壁纸的显示器。",
    screenSaverDisplays:
      "选择用于显示动态屏保画面的显示器，未启用的显示器将保持纯黑。",
    licenses: "Pear Wall 能够顺利运行，离不开这些优秀的开源库。",
  };
  const icons: Record<DrawerPage, IconType> = {
    advanced: SlidersHorizontalIcon,
    dynamicWallpaperDisplays: DesktopIcon,
    screenSaverDisplays: MonitorIcon,
    licenses: FileTextIcon,
  };
  const [scrollTop, setScrollTop] = useState(0);
  const titleProgress = Math.min(scrollTop / 56, 1);

  useEffect(() => {
    setScrollTop(0);
  }, [page]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <DrawerHeader title={titles[page]} progress={titleProgress} />
      <OverlayScrollbarsComponent
        defer
        className="drawer-scrollbar min-h-0 flex-1 overscroll-contain"
        options={{
          overflow: { x: "hidden", y: "scroll" },
          scrollbars: {
            theme: "os-theme-light",
            autoHide: "scroll",
            autoHideDelay: 700,
          },
        }}
        events={{
          scroll: (instance) => {
            setScrollTop(instance.elements().scrollOffsetElement.scrollTop);
          },
        }}
      >
        <div className="pb-8">
          <DrawerHero
            title={titles[page]}
            description={descriptions[page]}
            icon={icons[page]}
          />
          {page === "advanced" && (
            <div className="px-4 space-y-5">
              <DrawerCard>
                <ChoiceTabs
                  icon={GaugeIcon}
                  label="渲染质量"
                  value={
                    settings.performanceMode === "AUTO"
                      ? "AUTO"
                      : settings.renderScale
                  }
                  options={renderScales}
                  onChange={(value) => {
                    if (value === "AUTO") {
                      update("performanceMode", "AUTO");
                      return;
                    }
                    update("renderScale", value as number);
                    update("performanceMode", "MANUAL");
                  }}
                  variant="drawer"
                />
                {settings.performanceMode === "AUTO" && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <BatteryRangeSetting
                      icon={BatteryMediumIcon}
                      values={[
                        settings.autoBatterySaverMax,
                        settings.autoBatteryBalancedMax,
                      ]}
                      currentQuality={currentAutoQuality}
                      onChange={([saverMax, balancedMax]) => {
                        update("autoBatterySaverMax", saverMax);
                        update("autoBatteryBalancedMax", balancedMax);
                      }}
                    />
                  </>
                )}
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={DeviceMobileIcon}
                  label="竖屏方案"
                  value={settings.portraitPreset}
                  options={portraitPresets}
                  onChange={(value) => update("portraitPreset", value)}
                  variant="drawer"
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={MonitorIcon}
                  label="横屏方案"
                  value={settings.landscapePreset}
                  options={landscapePresets}
                  onChange={(value) => update("landscapePreset", value)}
                  variant="drawer"
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <SettingRow
                  icon={ShuffleIcon}
                  title="随机切换"
                  description="根据屏幕方向随机选择流动方案"
                >
                  <Toggle
                    label="随机切换"
                    value={settings.randomPreset}
                    onChange={(value) => update("randomPreset", value)}
                  />
                </SettingRow>
                {isMacOSRuntime && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <SettingRow
                      icon={InfoIcon}
                      title="显示配置详情"
                      description="在屏幕保护程序中显示当前画面参数"
                    >
                      <Toggle
                        label="显示配置详情"
                        value={settings.showConfigurationDetails}
                        onChange={(value) =>
                          update("showConfigurationDetails", value)
                        }
                      />
                    </SettingRow>
                  </>
                )}
              </DrawerCard>
            </div>
          )}

          {page === "dynamicWallpaperDisplays" && (
            <div className="px-4">
              <DrawerCard>
                <DisplaySelector
                  title="动态壁纸显示器"
                  selectionLabel="启用动态壁纸"
                  displays={connectedDisplays}
                  selectedIds={
                    settings.dynamicWallpaperDisplayIds ??
                    connectedDisplays.map((display) => display.id)
                  }
                  loading={displayLoading}
                  failed={displayDiscoveryFailed}
                  onChange={onDynamicWallpaperDisplayChange}
                />
              </DrawerCard>
            </div>
          )}

          {page === "screenSaverDisplays" && (
            <div className="px-4">
              <DrawerCard>
                <DisplaySelector
                  title="屏保显示器"
                  selectionLabel="显示动态画面"
                  displays={connectedDisplays}
                  selectedIds={settings.screenSaverDisplayIds ?? []}
                  loading={displayLoading}
                  failed={displayDiscoveryFailed}
                  onChange={onScreenSaverDisplayChange}
                />
              </DrawerCard>
            </div>
          )}

          {page === "licenses" && (
            <div className="space-y-3 px-4">
              <p className="!px-3 text-sm leading-relaxed text-white/65">
                Pear Wall 使用了以下开源依赖：
              </p>
              <DrawerCard>
                {projectDependencies.map((dependency, index) => (
                  <div
                    key={dependency.id}
                    className={`flex items-center gap-4 px-4 py-3.5 ${index > 0 ? "border-t border-white/10" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {dependency.name}
                      </p>
                      <p className="mt-1 truncate text-xs text-white/45">
                        {dependency.version}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-white/65">
                      {dependency.license}
                    </span>
                  </div>
                ))}
              </DrawerCard>
            </div>
          )}
        </div>
      </OverlayScrollbarsComponent>
    </div>
  );
}

function PermissionNotice({
  open,
  onOpenChange,
  onAcknowledge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => void;
}) {
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop
        variant="blur"
        isDismissable={false}
        isKeyboardDismissDisabled
        className="dark"
      >
        <Modal.Container size="md" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <SpeakerHighIcon aria-hidden size={22} weight="regular" />
              </Modal.Icon>
              <Modal.Heading>音频可视化需要系统权限</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>
                为了让画面跟随当前播放的声音律动，macOS 要求 Pear Wall
                获得系统音频录制权限。该权限由 macOS
                归类在“屏幕与系统音频录制”中，但 Pear Wall
                不会读取屏幕画面，也不会保存音频内容。
              </p>
              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <SpeakerHighIcon
                    aria-hidden
                    size={20}
                    className="mt-0.5 shrink-0 text-foreground"
                  />
                  <div>
                    <p className="font-medium text-foreground">音频可视化</p>
                    <p>让主界面和纯享模式根据系统声音实时律动。</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <MonitorIcon
                    aria-hidden
                    size={20}
                    className="mt-0.5 shrink-0 text-foreground"
                  />
                  <div>
                    <p className="font-medium text-foreground">
                      屏幕保护程序与动态壁纸
                    </p>
                    <p>由 Pear Wall 在后台持续提供声音节奏数据。</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-surface-secondary p-4">
                <p className="font-medium text-surface-secondary-foreground">
                  授予权限后需要彻底重启
                </p>
                <ol className="mt-2 list-decimal space-y-2 pl-5">
                  <li>
                    在“系统设置 &gt; 隐私与安全性 &gt; 屏幕与系统音频录制”中允许
                    Pear Wall。
                  </li>
                  <li>若 macOS 显示“退出并重新打开”，请选择该操作。</li>
                  <li>
                    如果没有出现提示，从菜单栏的 Pear Wall 图标中选择“退出 Pear
                    Wall”，然后重新打开。
                  </li>
                </ol>
                <p className="mt-3 text-xs">只关闭窗口不算完全退出。</p>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={onAcknowledge}>我知道了</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export function SettingsApp() {
  const isTauriRuntime = isTauri();
  const isWindowsRuntime =
    isTauriRuntime && document.documentElement.classList.contains("windows");
  const isMacOSRuntime = isTauriRuntime && !isWindowsRuntime;
  const supportsDynamicWallpaper = isMacOSRuntime || isWindowsRuntime;
  const supportsScreenSaverDisplays = isMacOSRuntime || isWindowsRuntime;
  const usesSharedSettings = isTauriRuntime;
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [powerStatus, setPowerStatus] = useState<PowerStatus | null>(null);
  const [connectedDisplays, setConnectedDisplays] = useState<
    ConnectedDisplay[]
  >([]);
  const [displayLoading, setDisplayLoading] = useState(
    supportsDynamicWallpaper,
  );
  const [displayDiscoveryFailed, setDisplayDiscoveryFailed] = useState(false);
  const [wallpaperStatus, setWallpaperStatus] =
    useState<WallpaperRuntimeStatus>({
      supported: supportsDynamicWallpaper,
      running: settings.dynamicWallpaperEnabled,
      displayCount: 0,
    });
  const [wallpaperLoading, setWallpaperLoading] = useState(
    supportsDynamicWallpaper,
  );
  const [wallpaperFailed, setWallpaperFailed] = useState(false);
  const [wallpaperError, setWallpaperError] = useState("");
  const [permissionNoticeOpen, setPermissionNoticeOpen] = useState(
    () =>
      isMacOSRuntime &&
      settings.audioVisualization &&
      shouldShowPermissionNotice(),
  );
  const [resetSettingsOpen, setResetSettingsOpen] = useState(false);
  const [sharedSettingsReady, setSharedSettingsReady] =
    useState(!usesSharedSettings);
  const [previewReady, setPreviewReady] = useState(false);
  const [mediaArtwork, setMediaArtwork] = useState<MediaArtwork | null>(null);
  const [contentVisible, setContentVisible] = useState(true);
  const [pureMode, setPureMode] = useState(false);
  const [route, setRoute] = useState<SettingsRoute>(readSettingsRoute);
  const [drawerPage, setDrawerPage] = useState<DrawerPage | null>(null);
  const [drawerHandleProgress, setDrawerHandleProgress] = useState(0);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sharedSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const mediaArtworkCache = useRef<MediaArtwork | null>(null);

  useEffect(() => {
    const handleHashChange = () => setRoute(readSettingsRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const openExportImagePage = () => {
    setDrawerPage(null);
    if (window.location.hash === "#/export-image") {
      setRoute("exportImage");
      return;
    }
    window.location.hash = "#/export-image";
  };

  const closeExportImagePage = () => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    setRoute("home");
  };

  useEffect(() => {
    if (settings.performanceMode !== "AUTO") {
      setPowerStatus(null);
      return;
    }
    let disposed = false;
    let pending = false;
    let battery: BatteryManagerLike | null = null;

    const updateFromBattery = () => {
      if (disposed || !battery) return;
      setPowerStatus({
        available: true,
        batteryPercent: Math.round(battery.level * 100),
        onBattery: !battery.charging,
        lowPowerMode: false,
      });
    };

    const readPowerStatus = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        let nextStatus: PowerStatus | null = null;
        if (isTauriRuntime) {
          try {
            const nativeStatus = await invoke<PowerStatus>("get_power_status");
            if (nativeStatus.available) nextStatus = nativeStatus;
          } catch {
            nextStatus = null;
          }
        }
        if (!nextStatus) {
          const batteryNavigator = navigator as BatteryNavigator;
          if (batteryNavigator.getBattery) {
            const nextBattery =
              battery ?? (await batteryNavigator.getBattery());
            if (disposed) return;
            if (!battery) {
              battery = nextBattery;
              battery.addEventListener("levelchange", updateFromBattery);
              battery.addEventListener("chargingchange", updateFromBattery);
            }
            nextStatus = {
              available: true,
              batteryPercent: Math.round(nextBattery.level * 100),
              onBattery: !nextBattery.charging,
              lowPowerMode: false,
            };
          }
        }
        if (!disposed) {
          setPowerStatus(
            nextStatus ?? {
              available: false,
              batteryPercent: null,
              onBattery: null,
              lowPowerMode: false,
            },
          );
        }
      } catch {
        if (!disposed) {
          setPowerStatus({
            available: false,
            batteryPercent: null,
            onBattery: null,
            lowPowerMode: false,
          });
        }
      } finally {
        pending = false;
      }
    };

    void readPowerStatus();
    const timer = window.setInterval(() => {
      void readPowerStatus();
    }, 60 * 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      battery?.removeEventListener("levelchange", updateFromBattery);
      battery?.removeEventListener("chargingchange", updateFromBattery);
    };
  }, [isTauriRuntime, settings.performanceMode]);

  const currentAutoQuality = resolveAutoQuality(
    powerStatus,
    settings.autoBatterySaverMax,
    settings.autoBatteryBalancedMax,
  );

  const update: UpdateSetting = (key, value) => {
    if (
      key === "audioVisualization" &&
      value === true &&
      isMacOSRuntime &&
      shouldShowPermissionNotice()
    ) {
      setPermissionNoticeOpen(true);
    }
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handlePermissionNoticeAcknowledgement = () => {
    acknowledgePermissionNotice();
    setPermissionNoticeOpen(false);
  };

  const resetToDefaultSettings = () => {
    setSettings(defaultSettings);
    setResetSettingsOpen(false);
  };

  const syncPreview = () => {
    previewRef.current?.contentWindow?.postMessage(
      { type: "pearwall:settings", settings: wallpaperSettings(settings) },
      window.location.protocol === "file:" ? "*" : window.location.origin,
    );
  };

  useEffect(() => {
    saveSettings(settings);
    syncPreview();
    if (!usesSharedSettings || !sharedSettingsReady) return;
    const json = JSON.stringify(settings);
    sharedSaveQueue.current = sharedSaveQueue.current
      .catch(() => undefined)
      .then(() => invoke("save_shared_settings", { settings: json }));
  }, [settings, sharedSettingsReady, usesSharedSettings]);

  useEffect(() => {
    if (!usesSharedSettings) return;
    let disposed = false;
    void invoke<string | null>("load_shared_settings")
      .then((json) => {
        if (!disposed && json) setSettings(settingsFromJSON(json));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setSharedSettingsReady(true);
      });
    return () => {
      disposed = true;
    };
  }, [usesSharedSettings]);

  useEffect(() => {
    if (!supportsDynamicWallpaper) return;
    let disposed = false;

    const refreshDisplays = async () => {
      try {
        const displays = await invoke<ConnectedDisplay[]>(
          "get_connected_displays",
        );
        if (disposed) return;
        setConnectedDisplays(displays);
        setDisplayDiscoveryFailed(false);
      } catch {
        if (!disposed) setDisplayDiscoveryFailed(true);
      } finally {
        if (!disposed) setDisplayLoading(false);
      }
    };

    void refreshDisplays();
    const timer = window.setInterval(() => {
      void refreshDisplays();
    }, 4000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [supportsDynamicWallpaper]);

  useEffect(() => {
    if (!supportsDynamicWallpaper) return;
    let disposed = false;
    let pending = false;

    const refreshWallpaperStatus = async () => {
      if (pending) return;
      pending = true;
      try {
        const status = await invoke<WallpaperRuntimeStatus>(
          "plugin:pearwall-wallpaper|status",
        );
        if (disposed) return;
        setWallpaperStatus(status);
        if (status.running) {
          setWallpaperFailed(false);
          setWallpaperError("");
        }
      } catch {
        if (!disposed) setWallpaperFailed(true);
      } finally {
        pending = false;
        if (!disposed) setWallpaperLoading(false);
      }
    };

    void refreshWallpaperStatus();
    const timer = window.setInterval(() => {
      void refreshWallpaperStatus();
    }, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [supportsDynamicWallpaper]);

  const setWallpaperEnabled = async (enabled: boolean) => {
    setWallpaperLoading(true);
    setWallpaperFailed(false);
    setWallpaperError("");
    try {
      const status = await invoke<WallpaperRuntimeStatus>(
        "set_dynamic_wallpaper_enabled",
        { enabled },
      );
      setWallpaperStatus(status);
      update("dynamicWallpaperEnabled", status.running);
    } catch (error) {
      setWallpaperFailed(true);
      setWallpaperError(String(error));
    } finally {
      setWallpaperLoading(false);
    }
  };

  useEffect(() => {
    if (
      !supportsScreenSaverDisplays ||
      !sharedSettingsReady ||
      connectedDisplays.length === 0
    )
      return;
    setSettings((current) => {
      if (current.screenSaverDisplayIds !== null) return current;
      const primary = connectedDisplays.find((display) => display.isPrimary);
      const legacyTarget =
        current.screenSaverDisplay === "SECONDARY"
          ? (connectedDisplays.find((display) => !display.isPrimary) ?? primary)
          : (primary ?? connectedDisplays[0]);
      return {
        ...current,
        screenSaverDisplayIds: legacyTarget ? [legacyTarget.id] : [],
      };
    });
  }, [connectedDisplays, sharedSettingsReady, supportsScreenSaverDisplays]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (
        window.location.protocol !== "file:" &&
        event.origin !== window.location.origin
      )
        return;
      if (event.data?.type !== "pearwall:ready") return;
      setPreviewReady(true);
      const artwork = mediaArtworkCache.current;
      if (!artwork) return;
      previewRef.current?.contentWindow?.postMessage(
        { type: "pearwall:media-artwork", artwork },
        window.location.protocol === "file:" ? "*" : window.location.origin,
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime || !previewReady) return;
    let disposed = false;
    let pending = false;
    let currentKey = "";

    const pollArtwork = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const artwork = await invoke<MediaArtwork>("get_media_artwork", {
          currentKey,
        });
        if (disposed) return;
        currentKey = artwork.key;
        const cached = mediaArtworkCache.current;
        const nextArtwork =
          artwork.data_url || cached?.key !== artwork.key
            ? artwork
            : { ...artwork, data_url: cached.data_url };
        mediaArtworkCache.current = nextArtwork;
        setMediaArtwork((current) => {
          if (
            current?.key === nextArtwork.key &&
            current.title === nextArtwork.title &&
            current.artist === nextArtwork.artist &&
            current.album === nextArtwork.album &&
            current.data_url === nextArtwork.data_url
          )
            return current;
          return nextArtwork;
        });
        previewRef.current?.contentWindow?.postMessage(
          { type: "pearwall:media-artwork", artwork: nextArtwork },
          window.location.protocol === "file:" ? "*" : window.location.origin,
        );
      } catch {
        return;
      } finally {
        pending = false;
      }
    };

    void pollArtwork();
    const timer = window.setInterval(() => {
      void pollArtwork();
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [isTauriRuntime, previewReady]);

  useEffect(() => {
    if (!isTauriRuntime || !previewReady || !settings.audioVisualization)
      return;
    let disposed = false;
    let pending = false;

    const sendPulse = (pulse: number) => {
      previewRef.current?.contentWindow?.postMessage(
        { type: "pearwall:audio-pulse", pulse },
        window.location.protocol === "file:" ? "*" : window.location.origin,
      );
    };

    const pollAudio = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const pulse = await invoke<number>("get_audio_pulse", {
          timestampSeconds: Date.now() / 1000,
        });
        if (!disposed) sendPulse(pulse);
      } catch {
        return;
      } finally {
        pending = false;
      }
    };

    void pollAudio();
    const timer = window.setInterval(() => {
      void pollAudio();
    }, 33);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      sendPulse(0);
    };
  }, [isTauriRuntime, previewReady, settings.audioVisualization]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const appWindow = getCurrentWindow();
    const syncFullscreenState = () => {
      void appWindow
        .isFullscreen()
        .then(setPureMode)
        .catch(() => setPureMode(false));
    };
    syncFullscreenState();
    const unlistenPromise = appWindow.onResized(syncFullscreenState);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isTauriRuntime]);

  const handleArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setSettings((current) => ({
        ...current,
        artworkFallback: "CUSTOM",
        customArtwork: reader.result as string,
        customArtworkName: file.name,
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const enterPureMode = () => {
    if (!isTauriRuntime) return;
    setContentVisible(false);
    void getCurrentWindow()
      .setFullscreen(true)
      .then(() => setPureMode(true))
      .catch(() => undefined);
  };

  const toggleScreenSaverDisplay = (id: string, enabled: boolean) => {
    setSettings((current) => {
      const selected = current.screenSaverDisplayIds ?? [];
      const screenSaverDisplayIds = enabled
        ? Array.from(new Set([...selected, id]))
        : selected.filter((value) => value !== id);
      return { ...current, screenSaverDisplayIds };
    });
  };

  const toggleDynamicWallpaperDisplay = (id: string, enabled: boolean) => {
    setSettings((current) => {
      const selected =
        current.dynamicWallpaperDisplayIds ??
        connectedDisplays.map((display) => display.id);
      const dynamicWallpaperDisplayIds = enabled
        ? Array.from(new Set([...selected, id]))
        : selected.filter((value) => value !== id);
      if (dynamicWallpaperDisplayIds.length === 0) return current;
      return { ...current, dynamicWallpaperDisplayIds };
    });
  };

  const renderCurrentImage = useCallback(
    async (options: ExportImageOptions) => {
      const previewWindow = previewRef.current
        ?.contentWindow as PearWallPreviewWindow | null;
      const exportImage = previewWindow?.PearWallExportImage;
      if (!exportImage) {
        throw new Error("实时画面尚未准备好，请稍后重试");
      }
      const logoPath = document
        .querySelector<SVGPathElement>('svg[aria-label="Pear Wall"] path')
        ?.getAttribute("d");
      const dataUrl = await exportImage({
        ...options,
        watermarkLogoPath: logoPath ?? undefined,
        songTitle: mediaArtwork?.title,
        songArtist: mediaArtwork?.artist,
        songAlbum: mediaArtwork?.album,
        songArtwork: mediaArtwork?.data_url ?? undefined,
      });
      if (!dataUrl.startsWith("data:image/png;base64,")) {
        throw new Error("无法生成 PNG 图片");
      }
      return dataUrl;
    },
    [mediaArtwork],
  );

  const exportCurrentImage = async (
    options: ExportImageOptions,
    destination: Pick<ExportSettings, "askForLocation" | "defaultDirectory">,
  ) => {
    const dataUrl = await renderCurrentImage(options);
    if (isTauriRuntime) {
      const fileName = destination.askForLocation
        ? `Pear-Wall-${options.width}x${options.height}.png`
        : `Pear-Wall-${Date.now()}.png`;
      let defaultDirectory = destination.defaultDirectory;
      if (destination.askForLocation && !defaultDirectory) {
        try {
          defaultDirectory = await invoke<string>(
            "get_default_export_directory",
          );
        } catch {
          defaultDirectory = "";
        }
      }
      const path = destination.askForLocation
        ? await saveFile({
            title: "导出 PNG 图片",
            defaultPath: defaultDirectory
              ? `${defaultDirectory.replace(/[\\/]+$/, "")}/${fileName}`
              : fileName,
            filters: [{ name: "PNG 图片", extensions: ["png"] }],
          })
        : defaultDirectory
          ? `${defaultDirectory.replace(/[\\/]+$/, "")}/${fileName}`
          : null;
      if (!path) {
        return destination.askForLocation ? "已取消导出" : "";
      }
      const savedPath = await invoke<string>("save_exported_image", {
        dataUrl,
        path,
      });
      return `图片已保存至 ${savedPath}`;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `Pear-Wall-${options.width}x${options.height}.png`;
    link.click();
    return "图片已开始下载";
  };

  const copyCurrentImage = async (options: ExportImageOptions) => {
    const dataUrl = await renderCurrentImage(options);
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      throw new Error("当前环境不支持复制图片");
    }
    const encoded = dataUrl.slice("data:image/png;base64,".length);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "图片已复制到剪贴板";
  };

  const chooseDefaultExportDirectory = async (currentDirectory: string) => {
    if (!isTauriRuntime) return null;
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "选择默认导出目录",
      ...(currentDirectory ? { defaultPath: currentDirectory } : {}),
    });
    return typeof selected === "string" ? selected : null;
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-black text-white ${settings.hideCursor && pureMode && !contentVisible ? "hide-cursor" : ""}`}
    >
      <Toaster
        position="top-center"
        theme="dark"
        offset={{ top: "3.5rem" }}
        mobileOffset={{ top: "3.5rem" }}
        toastOptions={{
          style: {
            borderRadius: "1.25rem",
            background: "rgba(0, 0, 0, 0.68)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            backdropFilter: "blur(16px) saturate(150%)",
            WebkitBackdropFilter: "blur(16px) saturate(150%)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
          },
        }}
      />
      {isTauriRuntime && <WindowTitleBar contentVisible={contentVisible} />}
      <img
        src={settings.customArtwork || "./assets/default_artwork.svg"}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
      />
      <iframe
        ref={previewRef}
        title="屏幕保护程序实时预览"
        src="./index.html"
        onLoad={syncPreview}
        className={`pointer-events-none absolute inset-0 h-full w-full border-0 ${!isTauriRuntime || previewReady ? "opacity-100" : "opacity-0"}`}
      />

      <OverlayScrollbarsComponent
        defer
        className={`settings-scrollbar absolute inset-0 overscroll-contain transition-[translate,opacity] duration-300 ease-out ${route === "exportImage" ? "-translate-x-8 opacity-0" : "translate-x-0 opacity-100"}`}
        options={{
          overflow: { x: "hidden", y: "scroll" },
          scrollbars: {
            theme: "os-theme-light",
            autoHide: "scroll",
            autoHideDelay: 700,
          },
        }}
        onClick={(event) => {
          if (!isTauriRuntime) return;
          const viewport = event.currentTarget.querySelector(
            "[data-overlayscrollbars-viewport]",
          );
          if (event.target === viewport) {
            setContentVisible((visible) => !visible);
          }
        }}
      >
        <main
          aria-hidden={route !== "home" || !contentVisible}
          className={`mx-auto w-full max-w-lg px-4 pb-12 pt-10 sm:px-6 sm:pt-12 transition-opacity duration-200 ease-out ${contentVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <header className="mb-6 mt-[35dvh]">
            <PearWallLogo className="mb-4 block h-auto w-56 text-white/80 saturate-200 mx-4" />
            {isTauriRuntime && (
              <SmoothCorners
                asChild
                autoEffects={false}
                corners={{ radius: 28, smoothing: 1 }}
                shadow={{
                  offsetX: 0,
                  offsetY: 4,
                  blur: 12,
                  spread: 0,
                  color: "#000000",
                  opacity: 0.1,
                }}
                shadowStrategy="box-shadow"
              >
                <Button
                  fullWidth
                  size="lg"
                  onPress={enterPureMode}
                  className="h-14 bg-white/80 backdrop-blur-[10px] backdrop-saturate-150 text-base font-semibold !text-neutral-900"
                >
                  <CornersOutIcon aria-hidden size={20} weight="bold" />
                  进入纯享模式
                </Button>
              </SmoothCorners>
            )}
          </header>

          <section className="mb-5">
            <SectionTitle>未获取到封面时</SectionTitle>
            <SettingsCard>
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => {
                  setSettings((current) => ({
                    ...current,
                    artworkFallback: "DEFAULT",
                    customArtwork: "",
                    customArtworkName: "",
                  }));
                }}
              >
                <SettingRow
                  icon={ImageIcon}
                  title="使用默认封面"
                  className="max-h-16 !min-h-16"
                >
                  {settings.artworkFallback === "DEFAULT" && (
                    <CheckIcon aria-label="已选择" size={18} weight="bold" />
                  )}
                </SettingRow>
              </button>
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => {
                  setSettings((current) => ({
                    ...current,
                    artworkFallback: "DESKTOP",
                    customArtwork: "",
                    customArtworkName: "",
                  }));
                }}
              >
                <SettingRow
                  icon={DesktopIcon}
                  title="使用桌面壁纸"
                  description="直接提取当前系统桌面壁纸"
                >
                  {settings.artworkFallback === "DESKTOP" && (
                    <CheckIcon aria-label="已选择" size={18} weight="bold" />
                  )}
                </SettingRow>
              </button>
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => fileInputRef.current?.click()}
              >
                <SettingRow
                  icon={UploadSimpleIcon}
                  title="使用自选图片"
                  description="选择本地图片作为备用封面"
                >
                  {settings.artworkFallback === "CUSTOM" && (
                    <CheckIcon aria-label="已选择" size={18} weight="bold" />
                  )}
                </SettingRow>
              </button>
              {settings.artworkFallback === "CUSTOM" &&
                settings.customArtwork && (
                  <div className="flex items-center gap-1.5 pr-4 pl-11.5 pb-3 pt-0">
                    <SmoothCorners
                      asChild
                      autoEffects={false}
                      corners={{ radius: 8, smoothing: 0.6 }}
                      outerBorder={{ width: 1, color: "#ffffff", opacity: 0.3 }}
                    >
                      <img
                        src={settings.customArtwork}
                        alt={`${settings.customArtworkName || "自选图片"}预览`}
                        className="h-14 w-14 shrink-0 object-cover"
                      />
                    </SmoothCorners>
                    <div className="min-w-0 flex-1">
                      <div className="px-2 pt-1 truncate text-sm text-white/85">
                        {settings.customArtworkName || "自选图片"}
                      </div>
                      <SmoothCorners
                        asChild
                        autoEffects={false}
                        corners={{ radius: 28, smoothing: 1 }}
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => fileInputRef.current?.click()}
                          className="-mx-1 bg-white/0 text-white/75 transition-colors hover:bg-white/15 hover:text-white"
                        >
                          重新选择
                        </Button>
                      </SmoothCorners>
                    </div>
                  </div>
                )}
              {settings.artworkFallback === "CUSTOM" &&
                settings.customArtwork && (
                  <div className="px-4 pb-3 text-right">
                    <SmoothCorners
                      asChild
                      autoEffects={false}
                      corners={{ radius: 28, smoothing: 1 }}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          setSettings((current) => ({
                            ...current,
                            artworkFallback: "DEFAULT",
                            customArtwork: "",
                            customArtworkName: "",
                          }));
                        }}
                        className="-mx-1 bg-white/0 text-white/75 transition-colors hover:bg-white/15 hover:text-white"
                      >
                        恢复默认封面
                      </Button>
                    </SmoothCorners>
                  </div>
                )}
            </SettingsCard>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleArtwork}
            />
          </section>

          <section className="mb-5">
            <SectionTitle>暂停时</SectionTitle>
            <SettingsCard>
              <SettingRow
                icon={PauseIcon}
                title="暂停流动效果"
                description="暂停播放后冻结动画，恢复播放时继续"
              >
                <Toggle
                  label="暂停流动效果"
                  value={settings.pauseFlow}
                  onChange={(value) => update("pauseFlow", value)}
                />
              </SettingRow>
            </SettingsCard>
          </section>

          <section className="mb-5">
            <SectionTitle>纯享、屏保与壁纸</SectionTitle>
            <SettingsCard>
              {supportsDynamicWallpaper && (
                <>
                  <SettingRow
                    icon={DesktopIcon}
                    title="动态壁纸"
                    description={
                      wallpaperFailed
                        ? wallpaperError || "无法更新动态壁纸，请重试"
                        : wallpaperStatus.running
                          ? `已在 ${wallpaperStatus.displayCount} 台显示器上运行`
                          : "在桌面图标下方显示当前流动画面"
                    }
                  >
                    <Toggle
                      label="动态壁纸"
                      value={wallpaperStatus.running}
                      onChange={(value) => void setWallpaperEnabled(value)}
                      disabled={wallpaperLoading}
                    />
                  </SettingRow>
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setDrawerPage("dynamicWallpaperDisplays")}
                  >
                    <SettingRow
                      icon={DesktopIcon}
                      title="动态壁纸显示器"
                      description="选择显示动态壁纸的显示器"
                    >
                      <CaretRightIcon
                        aria-hidden
                        size={18}
                        className="text-white/55"
                      />
                    </SettingRow>
                  </button>
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                </>
              )}
              <SettingRow
                icon={CursorIcon}
                title="隐藏鼠标指针"
                description="纯享模式及屏幕保护程序运行时隐藏"
              >
                <Toggle
                  label="隐藏鼠标指针"
                  value={settings.hideCursor}
                  onChange={(value) => update("hideCursor", value)}
                />
              </SettingRow>
              {supportsScreenSaverDisplays && (
                <>
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setDrawerPage("screenSaverDisplays")}
                  >
                    <SettingRow
                      icon={MonitorIcon}
                      title="屏保显示器"
                      description="选择显示动态屏保画面的显示器"
                    >
                      <CaretRightIcon
                        aria-hidden
                        size={18}
                        className="text-white/55"
                      />
                    </SettingRow>
                  </button>
                </>
              )}
            </SettingsCard>
          </section>

          <section className="mb-5">
            <SectionTitle>画面效果</SectionTitle>
            <SettingsCard>
              <SettingRow
                icon={SpeakerHighIcon}
                title="开启音频可视化"
                badge="实验性"
                description="画面会跟随正在播放的声音律动"
              >
                <Toggle
                  label="开启音频可视化"
                  value={settings.audioVisualization}
                  onChange={(value) => update("audioVisualization", value)}
                />
              </SettingRow>
              {settings.audioVisualization && (
                <>
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                  <RangeSetting
                    icon={WaveformIcon}
                    label="音频律动强度"
                    value={settings.audioIntensity}
                    minValue={0.5}
                    maxValue={3}
                    step={0.1}
                    onChange={(value) => update("audioIntensity", value)}
                  />
                </>
              )}
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <SettingRow
                icon={MagicWandIcon}
                title="背景模糊"
                description="柔化封面细节并突出流动层次"
              >
                <Toggle
                  label="背景模糊"
                  value={settings.blurEnabled}
                  onChange={(value) => update("blurEnabled", value)}
                />
              </SettingRow>
              {settings.blurEnabled && (
                <>
                  <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                  <RangeSetting
                    icon={DropIcon}
                    label="模糊强度"
                    value={settings.blurMultiplier}
                    minValue={0}
                    maxValue={2}
                    step={0.05}
                    onChange={(value) => update("blurMultiplier", value)}
                  />
                </>
              )}
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <RangeSetting
                icon={CircleHalfIcon}
                label="画面遮罩"
                value={settings.scrimAlpha}
                minValue={0}
                maxValue={0.8}
                step={0.05}
                onChange={(value) => update("scrimAlpha", value)}
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <ChoiceTabs
                icon={PlayIcon}
                label="流动速度"
                value={settings.flowSpeed}
                options={flowSpeeds}
                onChange={(value) => update("flowSpeed", value)}
              />
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <ChoiceTabs
                icon={MagicWandIcon}
                label="光栅玻璃"
                value={settings.moruStyle}
                options={moruStyles}
                onChange={(value) => update("moruStyle", value)}
              />
            </SettingsCard>
          </section>

          <section className="mb-5">
            <SettingsCard>
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => setDrawerPage("advanced")}
              >
                <SettingRow
                  icon={SlidersHorizontalIcon}
                  title="高级设置"
                  description={
                    isMacOSRuntime
                      ? "调整渲染质量、屏幕方向方案和屏保选项"
                      : "调整渲染质量、屏幕方向方案和随机切换"
                  }
                >
                  <CaretRightIcon
                    aria-hidden
                    size={18}
                    className="text-white/55"
                  />
                </SettingRow>
              </button>
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <button
                type="button"
                className="block w-full text-left"
                onClick={openExportImagePage}
              >
                <SettingRow
                  icon={DownloadSimpleIcon}
                  title="导出图片"
                  description="自定义画面参数并导出 PNG 图片"
                >
                  <CaretRightIcon
                    aria-hidden
                    size={18}
                    className="text-white/55"
                  />
                </SettingRow>
              </button>
            </SettingsCard>
          </section>
          <section className="mb-5">
            <SectionTitle>更多</SectionTitle>
            <SettingsCard>
              <SettingRow
                avatar={tintLogo}
                title="Pear Wall"
                description="版本 0.1.2"
              />
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <ExternalSettingRow
                href="https://github.com/Nevodev"
                icon={PawPrintIcon}
                title="Nevoit"
                description="原 Compose 项目开发者"
              />
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <ExternalSettingRow
                href="https://github.com/aurysian-yan"
                icon={PawPrintIcon}
                title="Aurysian"
                description="主要开发者"
              />
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <ExternalSettingRow
                href="https://github.com/WXRIW"
                icon={PawPrintIcon}
                title="WXRIW"
                description="特别感谢"
              />
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <ExternalSettingRow
                href="https://github.com/raspberry-monster"
                icon={PawPrintIcon}
                title="Raspberry Monster"
                description="特别感谢"
              />
              <Separator className="ml-12 mr-2 w-[calc(100%-3.5rem)] bg-white/15" />
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => setDrawerPage("licenses")}
              >
                <SettingRow
                  icon={FileTextIcon}
                  title="开源许可"
                  description="查看 Pear Wall 使用的开源许可"
                >
                  <CaretRightIcon
                    aria-hidden
                    size={18}
                    className="text-white/55"
                  />
                </SettingRow>
              </button>
            </SettingsCard>
          </section>

          <div className="flex justify-center">
            <SmoothCorners
              asChild
              autoEffects={false}
              corners={{ radius: 28, smoothing: 1 }}
            >
              <Button
                variant="ghost"
                onPress={() => setResetSettingsOpen(true)}
                className="bg-white/10 text-white/75 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white"
              >
                恢复默认设置
              </Button>
            </SmoothCorners>
          </div>
        </main>
      </OverlayScrollbarsComponent>
      <Drawer.Root
        open={route === "home" && drawerPage !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerPage(null);
          setDrawerHandleProgress(0);
        }}
        onDrag={(_, progress) => {
          setDrawerHandleProgress(Math.min(Math.max(progress * 2, 0), 1));
        }}
        onRelease={() => setDrawerHandleProgress(0)}
        onAnimationEnd={() => setDrawerHandleProgress(0)}
        shouldScaleBackground={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
          <Drawer.Content className="drawer-content fixed inset-x-0 bottom-0 z-[61] mx-auto flex max-h-[88vh] min-h-[320px] w-full max-w-2xl flex-col overflow-hidden bg-neutral-950/70 text-white shadow-2xl outline-none ring-1 ring-inset ring-white/10 backdrop-blur-xl backdrop-saturate-150">
            {/*<Drawer.Handle className="!absolute !left-1/2 !top-2 !z-30 !mx-0 !flex !h-[15px] !w-16 !-translate-x-1/2 !items-center !justify-center !bg-transparent !text-white/55 !opacity-100 [&>[data-vaul-handle-hitarea]]:grid [&>[data-vaul-handle-hitarea]]:place-items-center">
                <DynamicDrawerHandle
                  progress={drawerHandleProgress}
                  direction="down"
                />
              </Drawer.Handle>*/}
            {drawerPage && (
              <DrawerPageContent
                page={drawerPage}
                settings={settings}
                currentAutoQuality={currentAutoQuality}
                update={update}
                isMacOSRuntime={isMacOSRuntime}
                supportsScreenSaverDisplays={supportsScreenSaverDisplays}
                connectedDisplays={connectedDisplays}
                displayLoading={displayLoading}
                displayDiscoveryFailed={displayDiscoveryFailed}
                onDynamicWallpaperDisplayChange={toggleDynamicWallpaperDisplay}
                onScreenSaverDisplayChange={toggleScreenSaverDisplay}
              />
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <div
        aria-hidden={route !== "exportImage"}
        className={`fixed inset-0 z-[70] h-full w-full bg-black/50 text-white backdrop-blur-sm transition-opacity duration-300 ease-out ${route === "exportImage" ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div
          className={`mx-auto h-full w-full max-w-lg transition-[translate,opacity] duration-300 ease-out ${route === "exportImage" ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0"}`}
        >
          <ExportImagePage
            onPreview={renderCurrentImage}
            onExport={exportCurrentImage}
            onCopy={copyCurrentImage}
            onChooseDefaultDirectory={chooseDefaultExportDirectory}
            isTauriRuntime={isTauriRuntime}
            onBack={closeExportImagePage}
          />
        </div>
      </div>
      <PermissionNotice
        open={permissionNoticeOpen}
        onOpenChange={setPermissionNoticeOpen}
        onAcknowledge={handlePermissionNoticeAcknowledgement}
      />
      <Modal isOpen={resetSettingsOpen} onOpenChange={setResetSettingsOpen}>
        <Modal.Backdrop variant="blur" className="!bg-backdrop/35">
          <Modal.Container size="sm" placement="center" className="!p-0">
            <div className="my-auto">
              <SmoothCorners
                asChild
                autoEffects={false}
                corners={{ radius: 37, smoothing: 0.6 }}
                innerBorder={{
                  width: 1,
                  color: "currentColor",
                  opacity: 0.1,
                }}
              >
                <Modal.Dialog className="!w-[299px] !max-w-[299px] !overflow-hidden !bg-background/30 !p-0 !text-overlay-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
                  <Modal.Header className="!gap-0 !px-[25px] !pt-[23px] !text-left">
                    <Modal.Heading className="!text-[15px] !font-bold !leading-[18px] !text-overlay-foreground">
                      恢复默认设置？
                    </Modal.Heading>
                  </Modal.Header>
                  <Modal.Body className="!-m-0 !mt-3 !px-[25px] !pb-0 !text-[14px] !font-normal !leading-5.5 !text-muted">
                    <p>这会将主页中的所有设置恢复为默认值，且无法撤销。</p>
                  </Modal.Body>
                  <Modal.Footer className="!mt-[18px] !flex-col !items-stretch !gap-[7px] !px-[18px] !pb-[18px]">
                    <SmoothCorners
                      asChild
                      autoEffects={false}
                      corners={{ radius: 18, smoothing: 1 }}
                    >
                      <Button
                        variant="danger-soft"
                        size="sm"
                        fullWidth
                        onPress={resetToDefaultSettings}
                        className="!h-8 !min-h-8 !px-0 !text-[15px] !font-normal !leading-[18px]"
                      >
                        恢复默认
                      </Button>
                    </SmoothCorners>
                    <SmoothCorners
                      asChild
                      autoEffects={false}
                      corners={{ radius: 18, smoothing: 1 }}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onPress={() => setResetSettingsOpen(false)}
                        className="!h-8 !min-h-8 !bg-foreground/10 !px-0 !text-[15px] !font-normal !leading-[18px] hover:!bg-foreground/15"
                      >
                        取消
                      </Button>
                    </SmoothCorners>
                  </Modal.Footer>
                </Modal.Dialog>
              </SmoothCorners>
            </div>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
