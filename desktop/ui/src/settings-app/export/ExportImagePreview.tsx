import { SmoothCorners } from "@lisse/react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SettingsCard } from "../../SettingsPrimitives";

export function ExportImagePreview({
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

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
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
