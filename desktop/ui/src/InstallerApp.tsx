import { Button, Checkbox, ProgressBar } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { PearWallLogo } from "./PearWallLogo";
import { WindowTitleBar } from "./WindowTitleBar";
import BlurEffect from "react-progressive-blur";

type InstallerMode = "install" | "update" | "repair" | "uninstall";
type OperationStatus = "loading" | "ready" | "running" | "complete" | "error";

interface InstallerState {
  mode: InstallerMode;
  installedVersion: string | null;
  targetVersion: string;
  desktopShortcuts: boolean;
  startMenuShortcuts: boolean;
}

interface InstallOptions {
  desktopShortcuts: boolean;
  startMenuShortcuts: boolean;
}

interface InstallerProgress {
  percent: number;
  message: string;
}

interface UnsplashPhoto {
  urls: { regular: string };
  user: {
    name: string;
    links: { html: string };
  };
}

const previewState: InstallerState = {
  mode: "install",
  installedVersion: null,
  targetVersion: "1.0.0",
  desktopShortcuts: false,
  startMenuShortcuts: true,
};

const modeContent: Record<InstallerMode, { action: string }> = {
  install: {
    action: "安装",
  },
  update: {
    action: "更新",
  },
  repair: {
    action: "修复安装",
  },
  uninstall: {
    action: "卸载",
  },
};

function unsplashLink(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}utm_source=pear_wall_installer&utm_medium=referral`;
}

function openExternal(url: string) {
  if (isTauri()) {
    void openUrl(url).catch(() => undefined);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function minimizeInstallerWindow() {
  return invoke<void>("minimize_installer_window");
}

function closeInstallerWindow() {
  return invoke<void>("close_installer_window");
}

export function InstallerApp() {
  const [installerState, setInstallerState] = useState<InstallerState | null>(
    null,
  );
  const [activeMode, setActiveMode] = useState<InstallerMode>("install");
  const [status, setStatus] = useState<OperationStatus>("loading");
  const [options, setOptions] = useState<InstallOptions>({
    desktopShortcuts: false,
    startMenuShortcuts: true,
  });
  const [progress, setProgress] = useState<InstallerProgress>({
    percent: 0,
    message: "正在准备…",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const [photo, setPhoto] = useState<UnsplashPhoto | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const syncBackground = useCallback(() => {
    previewRef.current?.contentWindow?.postMessage(
      {
        type: "pearwall:settings",
        settings: {
          audioVisualization: false,
          pauseFlow: false,
          renderScale: 0.75,
          blurEnabled: true,
          blurMultiplier: 1,
          scrimAlpha: 0.46,
          flowSpeed: "SLOW",
          moruStyle: "NARROW",
          portraitPreset: 0,
          landscapePreset: 0,
          randomPreset: false,
          customArtwork: photo?.urls.regular ?? "",
        },
      },
      window.location.origin,
    );
  }, [photo]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "pearwall:ready") return;
      setPreviewReady(true);
      syncBackground();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [syncBackground]);

  useEffect(() => {
    syncBackground();
  }, [syncBackground]);

  useEffect(() => {
    const accessKey = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;
    if (!accessKey) return;

    const controller = new AbortController();
    void fetch(
      "https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high",
      {
        headers: { Authorization: `Client-ID ${accessKey}` },
        signal: controller.signal,
      },
    )
      .then((response) => {
        if (!response.ok) throw new Error("Unsplash 请求失败");
        return response.json() as Promise<UnsplashPhoto>;
      })
      .then(setPhoto)
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    if (!isTauri()) {
      setInstallerState(previewState);
      setActiveMode(previewState.mode);
      setOptions({
        desktopShortcuts: previewState.desktopShortcuts,
        startMenuShortcuts: previewState.startMenuShortcuts,
      });
      setStatus("ready");
      return;
    }

    void listen<InstallerProgress>("installer-progress", (event) => {
      setProgress(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });

    void invoke<InstallerState>("get_installer_state")
      .then((state) => {
        if (disposed) return;
        setInstallerState(state);
        setActiveMode(state.mode);
        setOptions({
          desktopShortcuts: state.desktopShortcuts,
          startMenuShortcuts: state.startMenuShortcuts,
        });
        setStatus("ready");
      })
      .catch((error) => {
        if (disposed) return;
        setErrorMessage(String(error));
        setStatus("error");
      });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  const runOperation = async (mode: InstallerMode = activeMode) => {
    if (!isTauri()) return;
    setActiveMode(mode);
    setStatus("running");
    setErrorMessage("");
    setProgress({
      percent: 0,
      message: mode === "uninstall" ? "正在准备卸载…" : "正在准备安装…",
    });
    try {
      if (mode === "uninstall") {
        await invoke("remove_installation");
      } else {
        await invoke("apply_installation", { options });
      }
      setStatus("complete");
    } catch (error) {
      setErrorMessage(String(error));
      setStatus("error");
    }
  };

  const content = modeContent[activeMode];
  const busy = status === "running";
  const canConfigure = activeMode !== "uninstall" && status === "ready";

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let stopListening: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (busy) event.preventDefault();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopListening = unlisten;
      });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [busy]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white">
      <WindowTitleBar
        title="Pear Wall 安装程序"
        showMaximize={false}
        showFullscreen={false}
        controlsDisabled={busy}
        onMinimize={minimizeInstallerWindow}
        onClose={closeInstallerWindow}
      />

      <iframe
        ref={previewRef}
        title="Pear Wall 动态背景"
        src="./wallpaper/index.html"
        onLoad={syncBackground}
        className={`pointer-events-none absolute inset-0 h-full w-full border-0 transition-opacity duration-300 ${previewReady ? "opacity-100" : "opacity-0"}`}
      />

      <BlurEffect
        position="bottom"
        intensity={90}
        className={`pointer-events-none fixed inset-x-0 top-0 z-[70] w-screen h-[50dvh]`}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-3/4 bg-gradient-to-t from-black via-black/60 to-transparent" />

      <main className="relative z-10 flex h-full items-end justify-center px-8 pb-10 pt-14 text-center">
        <div className="flex h-80 w-full max-w-lg flex-col items-center">
          <PearWallLogo className="h-auto w-44 shrink-0 text-white/90" />

          {status === "loading" && (
            <div className="mt-7 text-sm text-white/70">正在检查安装状态…</div>
          )}

          {status === "ready" && activeMode !== "uninstall" && (
            <div className="mt-7 w-full">
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
                  onPress={() => void runOperation()}
                  className="h-14 bg-white/20 backdrop-blur-[10px] backdrop-saturate-150 backdrop-brightness-150 text-base font-semibold !text-white"
                >
                  {activeMode === "repair" && (
                    <ArrowClockwiseIcon aria-hidden size={20} />
                  )}
                  {content.action}
                </Button>
              </SmoothCorners>

              <div className="mt-4 flex items-center justify-center gap-6">
                <Checkbox
                  isSelected={options.desktopShortcuts}
                  onChange={(value) =>
                    setOptions((current) => ({
                      ...current,
                      desktopShortcuts: value,
                    }))
                  }
                  isDisabled={!canConfigure}
                >
                  <Checkbox.Content className="text-white/85">
                    <Checkbox.Control className="border-white/45 bg-white/10">
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    添加桌面快捷方式
                  </Checkbox.Content>
                </Checkbox>
                <Checkbox
                  isSelected={options.startMenuShortcuts}
                  onChange={(value) =>
                    setOptions((current) => ({
                      ...current,
                      startMenuShortcuts: value,
                    }))
                  }
                  isDisabled={!canConfigure}
                >
                  <Checkbox.Content className="text-white/85">
                    <Checkbox.Control className="border-white/45 bg-white/10">
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    添加开始菜单快捷方式
                  </Checkbox.Content>
                </Checkbox>
              </div>
            </div>
          )}

          {status === "ready" && activeMode === "uninstall" && (
            <div className="mt-7 flex flex-col items-center gap-2">
              <TrashIcon aria-hidden size={22} className="text-white/80" />
              <div className="text-sm font-semibold text-white">确认卸载</div>
              <div className="text-xs text-white/60">个人画面设置将会保留</div>
            </div>
          )}

          {status === "running" && (
            <div className="mt-7 w-full max-w-md">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-white/75">{progress.message}</span>
                <span className="text-white/55">{progress.percent}%</span>
              </div>
              <ProgressBar
                aria-label="安装进度"
                value={progress.percent}
                minValue={0}
                maxValue={100}
              >
                <ProgressBar.Track className="bg-white/15">
                  <ProgressBar.Fill className="bg-white/85" />
                </ProgressBar.Track>
              </ProgressBar>
            </div>
          )}

          {status === "complete" && (
            <div className="mt-7 flex flex-col items-center gap-2">
              <CheckCircleIcon
                aria-hidden
                size={24}
                className="text-white/85"
              />
              <div className="text-sm font-semibold text-white">
                {activeMode === "uninstall" ? "已完成卸载" : "已完成安装"}
              </div>
              <div className="text-xs text-white/60">
                {activeMode === "uninstall"
                  ? "现在可以关闭安装程序"
                  : "可从桌面或开始菜单启动 Pear Wall"}
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="mt-7 flex flex-col items-center gap-2">
              <WarningCircleIcon
                aria-hidden
                size={24}
                className="text-white/85"
              />
              <div className="text-sm font-semibold text-white">操作未完成</div>
              <div className="text-xs text-white/60">
                {errorMessage || "请重试"}
              </div>
            </div>
          )}

          <div className="mt-7 flex items-center justify-center gap-2">
            {status === "ready" &&
              installerState?.installedVersion &&
              activeMode !== "uninstall" && (
                <SmoothCorners
                  asChild
                  autoEffects={false}
                  corners={{ radius: 28, smoothing: 1 }}
                >
                  <Button
                    variant="ghost"
                    onPress={() => void runOperation("uninstall")}
                    className="bg-white/10 text-white/75 hover:bg-white/15 hover:text-white"
                  >
                    <TrashIcon aria-hidden size={18} />
                    卸载
                  </Button>
                </SmoothCorners>
              )}

            {status === "ready" && activeMode === "uninstall" && (
              <SmoothCorners
                asChild
                autoEffects={false}
                corners={{ radius: 28, smoothing: 1 }}
              >
                <Button
                  onPress={() => void runOperation()}
                  className="bg-white/85 font-semibold text-neutral-900 hover:bg-white"
                >
                  <TrashIcon aria-hidden size={18} />
                  {content.action}
                </Button>
              </SmoothCorners>
            )}

            {(status === "complete" || status === "error") && (
              <SmoothCorners
                asChild
                autoEffects={false}
                corners={{ radius: 28, smoothing: 1 }}
              >
                <Button
                  onPress={() => {
                    if (status === "error") {
                      setStatus("ready");
                      return;
                    }
                    if (isTauri()) void closeInstallerWindow();
                  }}
                  className="bg-white/85 font-semibold text-neutral-900 hover:bg-white"
                >
                  {status === "error" ? "返回" : "完成"}
                </Button>
              </SmoothCorners>
            )}
          </div>

          <div className="mt-auto min-h-5 text-xs text-white/55">
            {photo && (
              <span>
                照片：
                <button
                  type="button"
                  className="text-white/75 hover:text-white"
                  onClick={() =>
                    openExternal(unsplashLink(photo.user.links.html))
                  }
                >
                  {photo.user.name}
                </button>
                <span> · </span>
                <button
                  type="button"
                  className="text-white/75 hover:text-white"
                  onClick={() =>
                    openExternal(
                      "https://unsplash.com/?utm_source=pear_wall_installer&utm_medium=referral",
                    )
                  }
                >
                  Unsplash
                </button>
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
