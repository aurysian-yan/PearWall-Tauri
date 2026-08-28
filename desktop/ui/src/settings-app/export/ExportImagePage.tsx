import { Button, NumberField, Separator, Spinner } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import {
  CircleHalfIcon,
  CopyIcon,
  CornersOutIcon,
  DownloadSimpleIcon,
  DropIcon,
  FolderOpenIcon,
  FrameCornersIcon,
  ImageIcon,
  MagicWandIcon,
  PlayIcon,
  SwapIcon,
} from "@phosphor-icons/react";
import { SettingRow, SettingsCard, Toggle } from "../../SettingsPrimitives";
import { ChoiceTabs, RangeSetting } from "../components/SettingControls";
import { DrawerHeader } from "../components/DrawerLayout";
import {
  exportAspectRatios,
  exportResolutions,
  watermarkBackgrounds,
  watermarkPlacements,
} from "../model";
import { ExportImagePreview } from "./ExportImagePreview";
import {
  useExportImagePage,
  type ExportImageCallbacks,
} from "./useExportImagePage";

export function ExportImagePage({
  onPreview,
  onExport,
  onCopy,
  onChooseDefaultDirectory,
  isTauriRuntime,
  onBack,
}: ExportImageCallbacks & {
  isTauriRuntime: boolean;
  onBack: () => void;
}) {
  const {
    previewContainerRef,
    previewContainerWidth,
    previewUrl,
    previewPending,
    previewFailed,
    exporting,
    copying,
    resolution,
    aspectRatio,
    width,
    height,
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
    presetOptions,
    selectedPreset,
    watermarkHeight,
    updateExportSetting,
    selectResolution,
    selectAspectRatio,
    changeWidth,
    changeHeight,
    swapDimensions,
    exportImage,
    copyImage,
    chooseDefaultDirectory,
  } = useExportImagePage({
    onPreview,
    onExport,
    onCopy,
    onChooseDefaultDirectory,
  });

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
