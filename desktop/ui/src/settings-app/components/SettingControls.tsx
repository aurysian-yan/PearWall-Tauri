import { Slider, Tabs } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubLogoIcon } from "@phosphor-icons/react";
import { SettingRow, type IconType } from "../../SettingsPrimitives";
import { autoQualityLabels } from "../model";
import type { AutoQuality, SelectOption } from "../types";

export function ExternalSettingRow({
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

export function RangeSetting({
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

export function BatteryRangeSetting({
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

export function ChoiceTabs<T extends string | number>({
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
