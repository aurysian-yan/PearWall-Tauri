import { Button, Checkbox, Modal, Separator, Slider, Tabs } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import BlurEffect from "react-progressive-blur";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Drawer } from "vaul";
import {
  CaretLeft,
  CaretRightIcon,
  CheckIcon,
  CornersOutIcon,
  CursorIcon,
  DesktopIcon,
  DeviceMobileIcon,
  FileTextIcon,
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
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  settingsFromJSON,
  wallpaperSettings,
} from "./settings";
import type {
  FlowSpeed,
  MoruStyle,
  Settings,
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
  | "advanced"
  | "dynamicWallpaperDisplays"
  | "screenSaverDisplays"
  | "licenses";
type MediaArtwork = {
  key: string;
  data_url: string | null;
  playing: boolean;
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

const renderScales: SelectOption<number>[] = [
  { value: 0.5, label: "省电" },
  { value: 0.75, label: "均衡" },
  { value: 1, label: "清晰" },
];

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
    return window.localStorage.getItem(permissionNoticeStorageKey) !== "acknowledged";
  } catch {
    return true;
  }
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

function ChoiceTabs<T extends string | number>({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  variant = "default",
}: {
  icon: IconType;
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  variant?: "default" | "drawer";
}) {
  const isDrawerVariant = variant === "drawer";

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center gap-3">
        <Icon
          aria-hidden
          size={20}
          weight="regular"
          className="shrink-0 text-white/90"
        />
        <span className="text-[14px] font-semibold text-white">{label}</span>
      </div>
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
  return common
    ? `${common.width}:${common.height}`
    : `${ratio.toFixed(2)}:1`;
}

function displayName(display: ConnectedDisplay, index: number) {
  return display.name.startsWith("Monitor #")
    ? `显示器 ${index + 1}`
    : display.name;
}

function physicalSizeLabel(display: ConnectedDisplay) {
  if (!display.physicalWidthMm || !display.physicalHeightMm) return null;
  const diagonalInches = Math.hypot(
    display.physicalWidthMm,
    display.physicalHeightMm,
  ) / 25.4;
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
  const anchor = logicalFrames.find((display) => display.isPrimary)
    ?? logicalFrames[0];
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
      visualX: (
        display.positionX + display.logicalWidth / 2 - anchorCenterX
      ) * horizontalScale - visualWidth / 2,
      visualY: (
        display.positionY + display.logicalHeight / 2 - anchorCenterY
      ) * verticalScale - visualHeight / 2,
    };
  });
  const displayGap = Math.max(
    ...frames.flatMap((display) => [display.visualWidth, display.visualHeight]),
  ) * 0.012;
  const relationTolerance = 0.5;

  for (let pass = 0; pass < frames.length * frames.length; pass += 1) {
    let adjusted = false;
    for (let firstIndex = 0; firstIndex < frames.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < frames.length; secondIndex += 1) {
        const first = frames[firstIndex];
        const second = frames[secondIndex];
        const overlapsHorizontally = first.visualX < second.visualX + second.visualWidth
          && second.visualX < first.visualX + first.visualWidth;
        const overlapsVertically = first.visualY < second.visualY + second.visualHeight
          && second.visualY < first.visualY + first.visualHeight;
        if (!overlapsHorizontally || !overlapsVertically) continue;

        const adjustments: Array<{
          distance: number;
          apply: () => void;
        }> = [];
        if (
          first.positionX + first.logicalWidth
          <= second.positionX + relationTolerance
        ) {
          const distance = first.visualX + first.visualWidth + displayGap
            - second.visualX;
          adjustments.push({
            distance,
            apply: () => {
              second.visualX += distance;
            },
          });
        }
        if (
          second.positionX + second.logicalWidth
          <= first.positionX + relationTolerance
        ) {
          const distance = second.visualX + second.visualWidth + displayGap
            - first.visualX;
          adjustments.push({
            distance,
            apply: () => {
              first.visualX += distance;
            },
          });
        }
        if (
          first.positionY + first.logicalHeight
          <= second.positionY + relationTolerance
        ) {
          const distance = first.visualY + first.visualHeight + displayGap
            - second.visualY;
          adjustments.push({
            distance,
            apply: () => {
              second.visualY += distance;
            },
          });
        }
        if (
          second.positionY + second.logicalHeight
          <= first.positionY + relationTolerance
        ) {
          const distance = second.visualY + second.visualHeight + displayGap
            - first.visualY;
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
  const previewScale = previewViewport.width > 0 && previewViewport.height > 0
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
                    fill={enabled ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.04)"}
                    stroke={enabled ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)"}
                    strokeWidth={strokeWidth}
                  />
                  <text
                    x={display.visualX + display.visualWidth / 2}
                    y={display.visualY + display.visualHeight / 2}
                    dy="0.12em"
                    fill={enabled ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)"}
                    fontSize={labelSize}
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {index + 1}
                  </text>
                  {display.isPrimary && (
                    <HouseIcon
                      aria-label="主屏幕"
                      x={display.visualX + display.visualWidth / 2 - primaryIconSize / 2}
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
    selectedIds.includes(display.id)
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
}: {
  title: string;
  progress: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-20 overflow-hidden transition-opacity duration-200"
        style={{ opacity: progress }}
      >
        <BlurEffect
          position="top"
          intensity={64}
          className="!pointer-events-none !absolute !inset-x-0 !top-0 !h-20 !w-full"
        />
      </div>
      <div className="relative flex h-16 items-center justify-between px-5 pt-2">
        <div className="pointer-events-auto">
          <Drawer.Close asChild>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="返回"
              className="z-30 !bg-white/8 text-white/75 hover:!bg-white/20 hover:text-white !p-0 backdrop-blur-[10px] backdrop-saturate-150 min-w-9 min-h-9 -m-1"
            >
              <CaretLeft
                aria-hidden
                size={24}
                className="absolute min-w-6 min-h-6"
              />
            </Button>
          </Drawer.Close>
        </div>
        <span
          aria-hidden
          className="z-30 pointer-events-none absolute inset-x-20 truncate text-center text-base font-semibold text-white transition-opacity duration-200 -mt-1"
          style={{ opacity: progress }}
        >
          {title}
        </span>
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

function DrawerPageContent({
  page,
  settings,
  update,
  isMacOSRuntime,
  connectedDisplays,
  displayLoading,
  displayDiscoveryFailed,
  onDynamicWallpaperDisplayChange,
  onScreenSaverDisplayChange,
}: {
  page: DrawerPage;
  settings: Settings;
  update: UpdateSetting;
  isMacOSRuntime: boolean;
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
    screenSaverDisplays: "选择用于运行 macOS 屏幕保护程序的显示器。",
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
                  value={settings.renderScale}
                  options={renderScales}
                  onChange={(value) => update("renderScale", value)}
                  variant="drawer"
                />
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
                  selectedIds={settings.dynamicWallpaperDisplayIds
                    ?? connectedDisplays.map((display) => display.id)}
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
                  selectionLabel="启用屏保"
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
                    在“系统设置 &gt; 隐私与安全性 &gt;
                    屏幕与系统音频录制”中允许 Pear Wall。
                  </li>
                  <li>若 macOS 显示“退出并重新打开”，请选择该操作。</li>
                  <li>
                    如果没有出现提示，从菜单栏的 Pear Wall
                    图标中选择“退出 Pear Wall”，然后重新打开。
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
  const isWindowsRuntime = isTauriRuntime
    && document.documentElement.classList.contains("windows");
  const isMacOSRuntime = isTauriRuntime && !isWindowsRuntime;
  const supportsDynamicWallpaper = isMacOSRuntime || isWindowsRuntime;
  const usesSharedSettings = isTauriRuntime;
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [connectedDisplays, setConnectedDisplays] = useState<ConnectedDisplay[]>([]);
  const [displayLoading, setDisplayLoading] = useState(supportsDynamicWallpaper);
  const [displayDiscoveryFailed, setDisplayDiscoveryFailed] = useState(false);
  const [wallpaperStatus, setWallpaperStatus] = useState<WallpaperRuntimeStatus>({
    supported: supportsDynamicWallpaper,
    running: settings.dynamicWallpaperEnabled,
    displayCount: 0,
  });
  const [wallpaperLoading, setWallpaperLoading] = useState(supportsDynamicWallpaper);
  const [wallpaperFailed, setWallpaperFailed] = useState(false);
  const [wallpaperError, setWallpaperError] = useState("");
  const [permissionNoticeOpen, setPermissionNoticeOpen] = useState(
    () => isMacOSRuntime
      && settings.audioVisualization
      && shouldShowPermissionNotice(),
  );
  const [sharedSettingsReady, setSharedSettingsReady] = useState(
    !usesSharedSettings,
  );
  const [previewReady, setPreviewReady] = useState(false);
  const [contentVisible, setContentVisible] = useState(true);
  const [pureMode, setPureMode] = useState(false);
  const [drawerPage, setDrawerPage] = useState<DrawerPage | null>(null);
  const [drawerHandleProgress, setDrawerHandleProgress] = useState(0);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sharedSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const mediaArtworkCache = useRef<MediaArtwork | null>(null);

  const update: UpdateSetting = (key, value) => {
    if (
      key === "audioVisualization"
      && value === true
      && isMacOSRuntime
      && shouldShowPermissionNotice()
    ) {
      setPermissionNoticeOpen(true);
    }
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handlePermissionNoticeAcknowledgement = () => {
    acknowledgePermissionNotice();
    setPermissionNoticeOpen(false);
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
        const displays = await invoke<ConnectedDisplay[]>("get_connected_displays");
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
      !isMacOSRuntime
      || !sharedSettingsReady
      || connectedDisplays.length === 0
    ) return;
    setSettings((current) => {
      if (current.screenSaverDisplayIds !== null) return current;
      const primary = connectedDisplays.find((display) => display.isPrimary);
      const legacyTarget = current.screenSaverDisplay === "SECONDARY"
        ? connectedDisplays.find((display) => !display.isPrimary) ?? primary
        : primary ?? connectedDisplays[0];
      return {
        ...current,
        screenSaverDisplayIds: legacyTarget ? [legacyTarget.id] : [],
      };
    });
  }, [connectedDisplays, isMacOSRuntime, sharedSettingsReady]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (
        window.location.protocol !== "file:"
        && event.origin !== window.location.origin
      ) return;
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
    if (!isMacOSRuntime || !previewReady) return;
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
        const nextArtwork = artwork.data_url || cached?.key !== artwork.key
          ? artwork
          : { ...artwork, data_url: cached.data_url };
        mediaArtworkCache.current = nextArtwork;
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
  }, [isMacOSRuntime, previewReady]);

  useEffect(() => {
    if (!isTauriRuntime || !previewReady || !settings.audioVisualization) return;
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
      const selected = current.dynamicWallpaperDisplayIds
        ?? connectedDisplays.map((display) => display.id);
      const dynamicWallpaperDisplayIds = enabled
        ? Array.from(new Set([...selected, id]))
        : selected.filter((value) => value !== id);
      if (dynamicWallpaperDisplayIds.length === 0) return current;
      return { ...current, dynamicWallpaperDisplayIds };
    });
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-black text-white ${settings.hideCursor && pureMode && !contentVisible ? "hide-cursor" : ""}`}
    >
      {isTauriRuntime && (
        <WindowTitleBar contentVisible={contentVisible} />
      )}
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
        className="settings-scrollbar absolute inset-0 overscroll-contain"
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
          aria-hidden={!contentVisible}
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
              {settings.artworkFallback === "CUSTOM" && settings.customArtwork && (
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
              {settings.artworkFallback === "CUSTOM" && settings.customArtwork && (
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
                    description={wallpaperFailed
                      ? wallpaperError || "无法更新动态壁纸，请重试"
                      : wallpaperStatus.running
                        ? `已在 ${wallpaperStatus.displayCount} 台显示器上运行`
                        : "在桌面图标下方显示当前流动画面"}
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
              {isMacOSRuntime && (
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
                      description="选择运行屏幕保护程序的显示器"
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
                  description={isMacOSRuntime
                    ? "调整渲染质量、屏幕方向方案和屏保选项"
                    : "调整渲染质量、屏幕方向方案和随机切换"}
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
                description="版本 0.1.1"
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
                onPress={() => {
                  setSettings(defaultSettings);
                }}
                className="bg-white/10 text-white/75 transition-colors hover:bg-white/15 hover:text-white"
              >
                恢复默认设置
              </Button>
            </SmoothCorners>
          </div>
        </main>
      </OverlayScrollbarsComponent>
      <Drawer.Root
        open={drawerPage !== null}
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
          <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/50" />
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
                update={update}
                isMacOSRuntime={isMacOSRuntime}
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
      <PermissionNotice
        open={permissionNoticeOpen}
        onOpenChange={setPermissionNoticeOpen}
        onAcknowledge={handlePermissionNoticeAcknowledgement}
      />
    </div>
  );
}
