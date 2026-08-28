import { Button, Separator } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import {
  CheckIcon,
  DesktopIcon,
  ImageIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type {
  ChangeEventHandler,
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { Settings } from "../../types";
import { SectionTitle, SettingRow, SettingsCard } from "../../SettingsPrimitives";

export function ArtworkFallbackSection({
  settings,
  setSettings,
  fileInputRef,
  onArtworkChange,
}: {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onArtworkChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
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
              {settings.artworkFallback === "CUSTOM" &&
                settings.customArtwork && (
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
              {settings.artworkFallback === "CUSTOM" &&
                settings.customArtwork && (
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
              onChange={onArtworkChange}
            />
          </section>
  );
}
