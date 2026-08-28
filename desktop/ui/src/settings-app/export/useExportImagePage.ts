import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { loadExportSettings, saveExportSettings } from "../../settings";
import type {
  ExportAspectRatio,
  ExportResolution,
  ExportSettings,
} from "../../types";
import {
  dimensionsForAspectRatio,
  exportResolutions,
  exportWatermarkHeight,
  landscapePresets,
  portraitPresets,
  waitForMinimumExportLoading,
} from "../model";
import type { ExportImageOptions } from "../types";

export type ExportImageCallbacks = {
  onPreview: (options: ExportImageOptions) => string | Promise<string>;
  onExport: (
    options: ExportImageOptions,
    destination: Pick<ExportSettings, "askForLocation" | "defaultDirectory">,
  ) => Promise<string>;
  onCopy: (options: ExportImageOptions) => Promise<string>;
  onChooseDefaultDirectory: (
    currentDirectory: string,
  ) => Promise<string | null>;
};

export function useExportImagePage({
  onPreview,
  onExport,
  onCopy,
  onChooseDefaultDirectory,
}: ExportImageCallbacks) {
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

  return {
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
  };
}
