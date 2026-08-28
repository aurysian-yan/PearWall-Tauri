import { Button, Separator } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import {
  CaretRightIcon,
  CircleHalfIcon,
  CornersOutIcon,
  CursorIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  DropIcon,
  FileTextIcon,
  MagicWandIcon,
  MonitorIcon,
  PauseIcon,
  PawPrintIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  SpeakerHighIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import type {
  ChangeEventHandler,
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { Settings } from "../types";
import { PearWallLogo } from "../PearWallLogo";
import {
  SectionTitle,
  SettingRow,
  SettingsCard,
  Toggle,
} from "../SettingsPrimitives";
import { ArtworkFallbackSection } from "./components/ArtworkFallbackSection";
import {
  ChoiceTabs,
  ExternalSettingRow,
  RangeSetting,
} from "./components/SettingControls";
import { flowSpeeds, moruStyles, tintLogo } from "./model";
import type {
  DrawerPage,
  UpdateSetting,
  WallpaperRuntimeStatus,
} from "./types";

export function HomeSettingsPage({
  isTauriRuntime,
  isMacOSRuntime,
  supportsDynamicWallpaper,
  supportsScreenSaverDisplays,
  active,
  contentVisible,
  settings,
  setSettings,
  update,
  fileInputRef,
  onArtworkChange,
  onEnterPureMode,
  wallpaperStatus,
  wallpaperLoading,
  wallpaperFailed,
  wallpaperError,
  onWallpaperEnabledChange,
  setDrawerPage,
  onOpenExportImage,
  onOpenResetSettings,
}: {
  isTauriRuntime: boolean;
  isMacOSRuntime: boolean;
  supportsDynamicWallpaper: boolean;
  supportsScreenSaverDisplays: boolean;
  active: boolean;
  contentVisible: boolean;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  update: UpdateSetting;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onArtworkChange: ChangeEventHandler<HTMLInputElement>;
  onEnterPureMode: () => void;
  wallpaperStatus: WallpaperRuntimeStatus;
  wallpaperLoading: boolean;
  wallpaperFailed: boolean;
  wallpaperError: string;
  onWallpaperEnabledChange: (enabled: boolean) => void;
  setDrawerPage: Dispatch<SetStateAction<DrawerPage | null>>;
  onOpenExportImage: () => void;
  onOpenResetSettings: () => void;
}) {
  return (
        <main
          aria-hidden={!active || !contentVisible}
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
                  onPress={onEnterPureMode}
                  className="h-14 bg-white/80 backdrop-blur-[10px] backdrop-saturate-150 text-base font-semibold !text-neutral-900"
                >
                  <CornersOutIcon aria-hidden size={20} weight="bold" />
                  进入纯享模式
                </Button>
              </SmoothCorners>
            )}
          </header>

          <ArtworkFallbackSection
            settings={settings}
            setSettings={setSettings}
            fileInputRef={fileInputRef}
            onArtworkChange={onArtworkChange}
          />

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
                      onChange={(value) => onWallpaperEnabledChange(value)}
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
                onClick={onOpenExportImage}
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
                description="版本 1.0.1"
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
                onPress={onOpenResetSettings}
                className="bg-white/10 text-white/75 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white"
              >
                恢复默认设置
              </Button>
            </SmoothCorners>
          </div>
        </main>
  );
}
