import { Checkbox } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { HouseIcon, MonitorIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ConnectedDisplay } from "../types";

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

export function DisplayArrangement({
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

export function DisplaySelector({
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
