import { Separator } from "@heroui/react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import {
  BatteryMediumIcon,
  DesktopIcon,
  DeviceMobileIcon,
  FileTextIcon,
  GaugeIcon,
  InfoIcon,
  MonitorIcon,
  QuotesIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { DrawerCard, SettingRow, Toggle, type IconType } from "../../SettingsPrimitives";
import type { Settings } from "../../types";
import licenseDataJson from "../../generated/openSourceLicenses.json";
import { BatteryRangeSetting, ChoiceTabs } from "./SettingControls";
import { DisplaySelector } from "./DisplaySelector";
import { LyricsSettings } from "./LyricsSettings";
import { DrawerHeader, DrawerHero } from "./DrawerLayout";
import { landscapePresets, portraitPresets, renderScales } from "../model";
import type {
  AutoQuality,
  ConnectedDisplay,
  DrawerPage,
  UpdateSetting,
} from "../types";

const projectDependencies = licenseDataJson.frontend;

export function DrawerPageContent({
  page,
  settings,
  currentAutoQuality,
  update,
  isMacOSRuntime,
  connectedDisplays,
  displayLoading,
  displayDiscoveryFailed,
  onDynamicWallpaperDisplayChange,
  onScreenSaverDisplayChange,
  setSettings,
}: {
  page: DrawerPage;
  settings: Settings;
  currentAutoQuality: AutoQuality;
  update: UpdateSetting;
  isMacOSRuntime: boolean;
  connectedDisplays: ConnectedDisplay[];
  displayLoading: boolean;
  displayDiscoveryFailed: boolean;
  onDynamicWallpaperDisplayChange: (id: string, enabled: boolean) => void;
  onScreenSaverDisplayChange: (id: string, enabled: boolean) => void;
  setSettings: Dispatch<SetStateAction<Settings>>;
}) {
  const titles: Record<DrawerPage, string> = {
    advanced: "高级设置",
    lyrics: "歌词与歌曲信息",
    dynamicWallpaperDisplays: "动态壁纸显示器",
    screenSaverDisplays: "屏保显示器",
    licenses: "开源许可",
  };
  const descriptions: Record<DrawerPage, string> = {
    advanced: isMacOSRuntime
      ? "调整渲染质量、屏幕方向方案和屏保配置详情。"
      : "调整渲染质量与屏幕方向方案，也可以让 Pear Wall 自动随机切换。",
    lyrics: "设置壁纸与屏保中的 MeloX 歌词动画和歌曲信息。",
    dynamicWallpaperDisplays: "选择用于显示动态壁纸的显示器。",
    screenSaverDisplays:
      "选择用于显示动态屏保画面的显示器，未启用的显示器将保持纯黑。",
    licenses: "Pear Wall 能够顺利运行，离不开这些优秀的开源库。",
  };
  const icons: Record<DrawerPage, IconType> = {
    advanced: SlidersHorizontalIcon,
    lyrics: QuotesIcon,
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

          {page === "lyrics" && (
            <LyricsSettings
              settings={settings}
              connectedDisplays={connectedDisplays}
              setSettings={setSettings}
            />
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
                    connectedDisplays.map((display) => display.persistentId)
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
