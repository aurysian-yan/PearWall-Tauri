import { Button, Separator, Slider } from "@heroui/react";
import {
  ArrowsOutIcon,
  ArrowsVerticalIcon,
  CaretDownIcon,
  CaretUpIcon,
  ImageIcon,
  MonitorIcon,
  QuotesIcon,
  TextAlignCenterIcon,
  TextTIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  DrawerCard,
  SettingRow,
  Toggle,
  type IconType,
} from "../../SettingsPrimitives";
import type {
  LyricsFontWeight,
  LyricsProvider,
  LyricsPresentationProfile,
  Settings,
} from "../../types";
import { ChoiceTabs } from "./SettingControls";
import type { ConnectedDisplay, SelectOption } from "../types";

const fontWeights: SelectOption<LyricsFontWeight>[] = [
  { value: "REGULAR", label: "常规" },
  { value: "MEDIUM", label: "中等" },
  { value: "SEMIBOLD", label: "半粗" },
  { value: "BOLD", label: "粗体" },
  { value: "HEAVY", label: "特粗" },
];

const lyricProviders: Array<{
  value: LyricsProvider;
  label: string;
  capability: string;
}> = [
  { value: "AMLL", label: "AMLL TTML", capability: "逐字" },
  { value: "LRCLIB", label: "LRCLIB", capability: "逐行" },
  { value: "NETEASE", label: "网易云音乐", capability: "逐字 / 逐行" },
  { value: "QQ", label: "QQ 音乐", capability: "逐行" },
  { value: "KUGOU", label: "酷狗音乐", capability: "逐行" },
];

export function LyricsSettings({
  settings,
  connectedDisplays,
  setSettings,
}: {
  settings: Settings;
  connectedDisplays: ConnectedDisplay[];
  setSettings: Dispatch<SetStateAction<Settings>>;
}) {
  const [selectedProfile, setSelectedProfile] = useState("default");
  const profileOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: "default", label: "默认" },
      ...connectedDisplays.map((display) => ({
        value: display.persistentId,
        label: display.name,
      })),
    ],
    [connectedDisplays],
  );
  const isDefault = selectedProfile === "default";
  const hasOverride = !isDefault
    && selectedProfile in settings.lyricsPresentation.displayOverrides;
  const displayProfile = settings.lyricsPresentation.displayOverrides[
    selectedProfile
  ] as LyricsPresentationProfile | undefined;
  const profile = isDefault
    ? settings.lyricsPresentation.defaultProfile
    : displayProfile ?? settings.lyricsPresentation.defaultProfile;

  useEffect(() => {
    if (!profileOptions.some((option) => option.value === selectedProfile)) {
      setSelectedProfile("default");
    }
  }, [profileOptions, selectedProfile]);

  const updateProfile = (next: LyricsPresentationProfile) => {
    setSettings((current) => ({
      ...current,
      lyricsPresentation: isDefault
        ? {
            ...current.lyricsPresentation,
            defaultProfile: next,
          }
        : {
            ...current.lyricsPresentation,
            displayOverrides: {
              ...current.lyricsPresentation.displayOverrides,
              [selectedProfile]: next,
            },
          },
    }));
  };

  const setOverride = (enabled: boolean) => {
    setSettings((current) => {
      const displayOverrides = {
        ...current.lyricsPresentation.displayOverrides,
      };
      if (enabled) {
        displayOverrides[selectedProfile] = {
          ...current.lyricsPresentation.defaultProfile,
          trackInfo: {
            ...current.lyricsPresentation.defaultProfile.trackInfo,
          },
        };
      } else {
        delete displayOverrides[selectedProfile];
      }
      return {
        ...current,
        lyricsPresentation: {
          ...current.lyricsPresentation,
          displayOverrides,
        },
      };
    });
  };

  const updateSourceOrder = (sourceOrder: LyricsProvider[]) => {
    setSettings((current) => ({
      ...current,
      lyricsPresentation: {
        ...current.lyricsPresentation,
        sourceOrder,
      },
    }));
  };

  return (
    <div className="space-y-5 px-4">
      {profileOptions.length > 1 && (
        <DrawerCard>
          <ChoiceTabs
            icon={MonitorIcon}
            label="显示器配置"
            value={selectedProfile}
            options={profileOptions}
            onChange={setSelectedProfile}
            variant="drawer"
          />
          {!isDefault && (
            <>
              <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
              <SettingRow
                icon={MonitorIcon}
                title="单独设置"
                description="仅在这台显示器上使用以下配置"
              >
                <Toggle
                  label="单独设置"
                  value={hasOverride}
                  onChange={setOverride}
                />
              </SettingRow>
            </>
          )}
        </DrawerCard>
      )}

      {(isDefault || hasOverride) && (
        <>
          <LyricsProfileEditor profile={profile} onChange={updateProfile} />
          {profile.enabled && (
            <LyricsSourceOrder
              value={settings.lyricsPresentation.sourceOrder}
              onChange={updateSourceOrder}
            />
          )}
        </>
      )}
    </div>
  );
}

function LyricsProfileEditor({
  profile,
  onChange,
}: {
  profile: LyricsPresentationProfile;
  onChange: (profile: LyricsPresentationProfile) => void;
}) {
  const update = <Key extends keyof LyricsPresentationProfile>(
    key: Key,
    value: LyricsPresentationProfile[Key],
  ) => onChange({ ...profile, [key]: value });
  const updateTrackInfo = <Key extends keyof LyricsPresentationProfile["trackInfo"]>(
    key: Key,
    value: LyricsPresentationProfile["trackInfo"][Key],
  ) => update("trackInfo", { ...profile.trackInfo, [key]: value });
  const updateBlurRange = ([minimumBlurRadius, maximumBlurRadius]: [number, number]) => {
    onChange({
      ...profile,
      minimumBlurRadius,
      maximumBlurRadius,
    });
  };

  return (
    <>
      <DrawerCard>
        <SettingRow
          icon={QuotesIcon}
          title="显示歌词"
          description="在动态壁纸和屏幕保护程序中显示"
        >
          <Toggle
            label="显示歌词"
            value={profile.enabled}
            onChange={(value) => update("enabled", value)}
          />
        </SettingRow>
      </DrawerCard>

      {profile.enabled && (
        <>
          <DrawerCard>
            <SettingRow icon={TextTIcon} title="歌词正文">
              <Toggle
                label="歌词正文"
                value={profile.showLyrics}
                onChange={(value) => update("showLyrics", value)}
              />
            </SettingRow>
            {profile.showLyrics && (
              <>
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={TextTIcon}
                  label="字号"
                  value={profile.fontSizeMode}
                  options={[
                    { value: "MELOX_AUTO", label: "MeloX 自动" },
                    { value: "CUSTOM", label: "自定义" },
                  ]}
                  onChange={(value) => update("fontSizeMode", value)}
                  variant="drawer"
                />
                {profile.fontSizeMode === "CUSTOM" && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <NumericSlider
                      icon={TextTIcon}
                      label="歌词字号"
                      value={profile.fontSize}
                      minimum={18}
                      maximum={120}
                      step={1}
                      suffix=" pt"
                      onChange={(value) => update("fontSize", value)}
                    />
                  </>
                )}
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={TextTIcon}
                  label="字重"
                  value={profile.fontWeight}
                  options={fontWeights}
                  onChange={(value) => update("fontWeight", value)}
                  variant="drawer"
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={TextAlignCenterIcon}
                  label="对齐方式"
                  value={profile.alignment}
                  options={[
                    { value: "MELOX", label: "MeloX" },
                    { value: "LEFT", label: "左" },
                    { value: "CENTER", label: "中" },
                    { value: "RIGHT", label: "右" },
                  ]}
                  onChange={(value) => update("alignment", value)}
                  variant="drawer"
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <SettingRow
                  icon={ArrowsOutIcon}
                  title="逐行距离模糊"
                  description="离当前歌词越远，模糊程度越高"
                >
                  <Toggle
                    label="逐行距离模糊"
                    value={profile.progressiveBlur}
                    onChange={(value) => update("progressiveBlur", value)}
                  />
                </SettingRow>
                {profile.progressiveBlur && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <BlurRangeSlider
                      values={[
                        profile.minimumBlurRadius,
                        profile.maximumBlurRadius,
                      ]}
                      onChange={updateBlurRange}
                    />
                  </>
                )}
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <NumericSlider
                  icon={ArrowsVerticalIcon}
                  label="顶部边距"
                  value={profile.topInset}
                  minimum={0}
                  maximum={240}
                  step={4}
                  suffix=" pt"
                  onChange={(value) => update("topInset", value)}
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <NumericSlider
                  icon={ArrowsVerticalIcon}
                  label="底部边距"
                  value={profile.bottomInset}
                  minimum={0}
                  maximum={240}
                  step={4}
                  suffix=" pt"
                  onChange={(value) => update("bottomInset", value)}
                />
              </>
            )}
          </DrawerCard>

          <DrawerCard>
            <SettingRow
              icon={ImageIcon}
              title="歌曲信息"
              description="在歌词下方显示当前歌曲信息"
            >
              <Toggle
                label="歌曲信息"
                value={profile.trackInfo.enabled}
                onChange={(value) => updateTrackInfo("enabled", value)}
              />
            </SettingRow>
            {profile.trackInfo.enabled && (
              <>
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={ImageIcon}
                  label="排列方式"
                  value={profile.trackInfo.layout}
                  options={[
                    { value: "HORIZONTAL", label: "横向" },
                    { value: "VERTICAL", label: "纵向" },
                  ]}
                  onChange={(value) => updateTrackInfo("layout", value)}
                  variant="drawer"
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <ChoiceTabs
                  icon={TextAlignCenterIcon}
                  label="信息对齐"
                  value={profile.trackInfo.alignment}
                  options={[
                    { value: "FOLLOW_LYRICS", label: "跟随歌词" },
                    { value: "LEFT", label: "左" },
                    { value: "CENTER", label: "中" },
                    { value: "RIGHT", label: "右" },
                  ]}
                  onChange={(value) => updateTrackInfo("alignment", value)}
                  variant="drawer"
                />
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                {[
                  ["showArtwork", "显示封面"],
                  ["showTitle", "显示歌名"],
                  ["showArtist", "显示歌手"],
                  ["showAlbum", "显示专辑名"],
                ].map(([key, label], index) => (
                  <div key={key}>
                    {index > 0 && (
                      <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    )}
                    <SettingRow title={label}>
                      <Toggle
                        label={label}
                        value={profile.trackInfo[key as "showArtwork"]}
                        onChange={(value) =>
                          updateTrackInfo(key as "showArtwork", value)
                        }
                      />
                    </SettingRow>
                  </div>
                ))}
                <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                <NumericSlider
                  icon={ArrowsOutIcon}
                  label="整体缩放"
                  value={profile.trackInfo.scale}
                  minimum={0.6}
                  maximum={1.6}
                  step={0.05}
                  suffix="×"
                  onChange={(value) => updateTrackInfo("scale", value)}
                />
                {profile.trackInfo.showArtwork && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <NumericSlider
                      icon={ImageIcon}
                      label="封面尺寸"
                      value={profile.trackInfo.artworkSize}
                      minimum={40}
                      maximum={160}
                      step={2}
                      suffix=" pt"
                      onChange={(value) => updateTrackInfo("artworkSize", value)}
                    />
                  </>
                )}
                {profile.trackInfo.showTitle && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <NumericSlider
                      icon={TextTIcon}
                      label="歌名字号"
                      value={profile.trackInfo.titleFontSize}
                      minimum={12}
                      maximum={48}
                      step={1}
                      suffix=" pt"
                      onChange={(value) => updateTrackInfo("titleFontSize", value)}
                    />
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <ChoiceTabs
                      icon={TextTIcon}
                      label="歌名字重"
                      value={profile.trackInfo.titleFontWeight}
                      options={fontWeights}
                      onChange={(value) => updateTrackInfo("titleFontWeight", value)}
                      variant="drawer"
                    />
                  </>
                )}
                {(profile.trackInfo.showArtist || profile.trackInfo.showAlbum) && (
                  <>
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <NumericSlider
                      icon={TextTIcon}
                      label="歌手与专辑字号"
                      value={profile.trackInfo.secondaryFontSize}
                      minimum={10}
                      maximum={36}
                      step={1}
                      suffix=" pt"
                      onChange={(value) => updateTrackInfo("secondaryFontSize", value)}
                    />
                    <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
                    <ChoiceTabs
                      icon={TextTIcon}
                      label="歌手与专辑字重"
                      value={profile.trackInfo.secondaryFontWeight}
                      options={fontWeights}
                      onChange={(value) => updateTrackInfo("secondaryFontWeight", value)}
                      variant="drawer"
                    />
                  </>
                )}
              </>
            )}
          </DrawerCard>
        </>
      )}
    </>
  );
}

function LyricsSourceOrder({
  value,
  onChange,
}: {
  value: LyricsProvider[];
  onChange: (value: LyricsProvider[]) => void;
}) {
  const move = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= value.length) return;
    const next = [...value];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  };

  return (
    <DrawerCard>
      <SettingRow
        icon={ArrowsVerticalIcon}
        title="歌词来源优先级"
        description="找到可靠匹配时优先使用靠前来源"
      />
      {value.map((provider, index) => {
        const item = lyricProviders.find((candidate) => candidate.value === provider);
        if (!item) return null;
        return (
          <div key={provider}>
            <Separator className="mx-2 w-[calc(100%-1rem)] bg-white/15" />
            <SettingRow title={item.label} badge={item.capability}>
              <div className="flex items-center gap-1">
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`提高${item.label}优先级`}
                  isDisabled={index === 0}
                  onPress={() => move(index, -1)}
                  className="text-white/80"
                >
                  <CaretUpIcon aria-hidden size={16} />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`降低${item.label}优先级`}
                  isDisabled={index === value.length - 1}
                  onPress={() => move(index, 1)}
                  className="text-white/80"
                >
                  <CaretDownIcon aria-hidden size={16} />
                </Button>
              </div>
            </SettingRow>
          </div>
        );
      })}
    </DrawerCard>
  );
}

function BlurRangeSlider({
  values,
  onChange,
}: {
  values: [number, number];
  onChange: (values: [number, number]) => void;
}) {
  const formatValue = (value: number) => value
    .toFixed(1)
    .replace(/\.0$/, "");
  const [minimumBlurRadius, maximumBlurRadius] = values;

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <ArrowsOutIcon aria-hidden size={20} className="shrink-0 text-white/90" />
        <span className="w-full text-[14px] font-semibold text-white">
          模糊范围
        </span>
        <span className="whitespace-nowrap text-sm text-white/75">
          {formatValue(minimumBlurRadius)} / {formatValue(maximumBlurRadius)} pt
        </span>
      </div>
      <Slider
        aria-label="逐行模糊范围"
        value={values}
        minValue={0}
        maxValue={12}
        step={0.5}
        onChange={(next) => {
          if (!Array.isArray(next) || next.length < 2) return;
          const ordered = next
            .map(Number)
            .sort((left, right) => left - right);
          onChange([ordered[0], ordered[1]]);
        }}
      >
        <Slider.Track className="bg-white/20">
          <Slider.Fill />
          <Slider.Thumb
            index={0}
            aria-label="相邻歌词模糊"
            className="border-0 bg-white shadow-md"
          />
          <Slider.Thumb
            index={1}
            aria-label="远处歌词模糊"
            className="border-0 bg-white shadow-md"
          />
        </Slider.Track>
      </Slider>
      <div className="mt-1 flex justify-between text-xs text-white/55">
        <span>相邻 {formatValue(minimumBlurRadius)} pt</span>
        <span>远处 {formatValue(maximumBlurRadius)} pt</span>
      </div>
    </div>
  );
}

function NumericSlider({
  icon: Icon,
  label,
  value,
  minimum,
  maximum,
  step,
  suffix,
  onChange,
}: {
  icon: IconType;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const displayValue = step < 1 ? value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : value;
  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Icon aria-hidden size={20} className="shrink-0 text-white/90" />
        <span className="w-full text-[14px] font-semibold text-white">{label}</span>
        <span className="whitespace-nowrap text-sm text-white/75">
          {displayValue}{suffix}
        </span>
      </div>
      <Slider
        aria-label={label}
        value={value}
        minValue={minimum}
        maxValue={maximum}
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
