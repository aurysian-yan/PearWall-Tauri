import { Button, Card, Separator, Slider, Switch, Tabs } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import {
  CheckIcon,
  GaugeIcon,
  ImageIcon,
  MagicWandIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  UploadSimpleIcon,
  CircleHalfIcon,
  DropIcon,
} from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  wallpaperSettings,
} from "./settings";
import type { FlowSpeed, MoruStyle, Settings } from "./types";
import { PearWallLogo } from "./PearWallLogo";
import { WindowTitleBar } from "./WindowTitleBar";

type IconType = typeof PauseIcon;
type SelectOption<T extends string | number> = { value: T; label: string };

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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 px-4 text-[14px] font-semibold text-white/90">
      {children}
    </h2>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <SmoothCorners
      asChild
      autoEffects={false}
      corners={{ radius: 28, smoothing: 0.6 }}
      innerBorder={{ width: 1, color: "#ffffff", opacity: 0.1 }}
    >
      <Card
        variant="transparent"
        className="overflow-hidden bg-black/25 text-white shadow-none backdrop-blur-[10px] backdrop-saturate-150 p-0 gap-0"
      >
        {children}
      </Card>
    </SmoothCorners>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: IconType;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-18 items-center gap-3 px-4 py-3">
      <Icon
        aria-hidden
        size={20}
        weight="regular"
        className="shrink-0 text-white/90"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight text-white">
          {title}
        </div>
        {description && (
          <div className="mt-1 text-xs leading-snug text-white/65">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch aria-label={label} isSelected={value} onChange={onChange} size="lg">
      <Switch.Content>
        <Switch.Control className="data-[selected=true]:bg-green-500">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
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
        <span className="w-full text-[14px] font-semibold text-white">{label}</span>
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
}: {
  icon: IconType;
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
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
        className="w-[calc(100%+0.5rem)] -mx-1"
      >
        <Tabs.ListContainer className="w-full !bg-white/10">
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

export function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [contentVisible, setContentVisible] = useState(true);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = <Key extends keyof Settings>(
    key: Key,
    value: Settings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const syncPreview = () => {
    previewRef.current?.contentWindow?.postMessage(
      { type: "pearwall:settings", settings: wallpaperSettings(settings) },
      window.location.origin,
    );
  };

  useEffect(() => {
    saveSettings(settings);
    syncPreview();
  }, [settings]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "pearwall:ready") setPreviewReady(true);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setSettings((current) => ({
        ...current,
        customArtwork: reader.result as string,
        customArtworkName: file.name,
      }));
      setSaved(false);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const apply = () => {
    saveSettings(settings);
    syncPreview();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white">
      <WindowTitleBar contentVisible={contentVisible} />
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
        className={`pointer-events-none absolute inset-0 h-full w-full border-0 ${previewReady ? "opacity-100" : "opacity-0"}`}
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
                onPress={apply}
                className="h-14 bg-white text-base font-semibold !text-neutral-900"
              >
                {saved ? (
                  <CheckIcon aria-hidden size={18} weight="bold" />
                ) : (
                  <PlayIcon aria-hidden size={22} weight="fill" />
                )}
                {saved ? "设置已保存" : "应用屏保设置"}
              </Button>
            </SmoothCorners>
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
                    customArtwork: "",
                    customArtworkName: "",
                  }));
                  setSaved(false);
                }}
              >
                <SettingRow icon={ImageIcon} title="使用默认封面">
                  {!settings.customArtwork && (
                    <CheckIcon aria-label="已选择" size={18} weight="bold" />
                  )}
                </SettingRow>
              </button>
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => fileInputRef.current?.click()}
              >
                <SettingRow
                  icon={UploadSimpleIcon}
                  title="使用自选图片"
                  description={
                    settings.customArtworkName || "选择本地图片作为备用封面"
                  }
                >
                  {settings.customArtwork && (
                    <CheckIcon aria-label="已选择" size={18} weight="bold" />
                  )}
                </SettingRow>
              </button>
              {settings.customArtwork && (
                <div className="px-4 pb-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setSettings((current) => ({
                        ...current,
                        customArtwork: "",
                        customArtworkName: "",
                      }));
                      setSaved(false);
                    }}
                    className="text-white/75"
                  >
                    恢复默认封面
                  </Button>
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
            <SectionTitle>画面效果</SectionTitle>
            <SettingsCard>
              <SettingRow
                icon={SpeakerHighIcon}
                title="开启音频可视化"
                description="画面会跟随正在播放的声音律动"
              >
                <Toggle
                  label="开启音频可视化"
                  value={settings.audioVisualization}
                  onChange={(value) => update("audioVisualization", value)}
                />
              </SettingRow>
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
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <ChoiceTabs
                icon={GaugeIcon}
                label="渲染质量"
                value={settings.renderScale}
                options={renderScales}
                onChange={(value) => update("renderScale", value)}
              />
            </SettingsCard>
          </section>

          <div className="flex justify-center">
            <Button
              variant="ghost"
              onPress={() => {
                setSettings(defaultSettings);
                setSaved(false);
              }}
              className="text-white/75"
            >
              恢复默认设置
            </Button>
          </div>
        </main>
      </OverlayScrollbarsComponent>
    </div>
  );
}
