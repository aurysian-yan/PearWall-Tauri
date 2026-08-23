import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import {
  CopySimpleIcon,
  CornersInIcon,
  CornersOutIcon,
  MinusIcon,
  SquareIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import BlurEffect from "react-progressive-blur";
const tintLogo = new URL("./tint-logo.png", import.meta.url).href;

function runWindowAction(action: () => Promise<void>) {
  void action().catch(() => undefined);
}

export function WindowTitleBar({
  contentVisible = true,
  title = "Pear Wall 设置",
  showMinimize = true,
  showMaximize = true,
  showFullscreen = true,
  showClose = true,
  controlsDisabled = false,
  onMinimize,
  onClose,
}: {
  contentVisible?: boolean;
  title?: string;
  showMinimize?: boolean;
  showMaximize?: boolean;
  showFullscreen?: boolean;
  showClose?: boolean;
  controlsDisabled?: boolean;
  onMinimize?: () => Promise<void>;
  onClose?: () => Promise<void>;
}) {
  const isWindows = document.documentElement.classList.contains("windows");
  const isTauriRuntime = isTauri();
  const appWindow = useMemo(
    () => (isTauriRuntime ? getCurrentWindow() : null),
    [isTauriRuntime],
  );
  const minimizeWindow = onMinimize
    ?? (appWindow ? () => appWindow.minimize() : undefined);
  const closeWindow = onClose
    ?? (appWindow ? () => appWindow.close() : undefined);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!appWindow) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncWindowState = () => {
      void Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()])
        .then(([maximized, fullscreen]) => {
          setIsMaximized(maximized);
          setIsFullscreen(fullscreen);
        })
        .catch(() => undefined);
    };

    syncWindowState();
    void appWindow
      .onResized(syncWindowState)
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  return (
    <>
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-[70] w-screen opacity-0 max-[850px]:opacity-100 ${isWindows ? "h-14" : "h-12"}`}
      >
        <BlurEffect
          position="top"
          intensity={50}
          className={`pointer-events-none fixed inset-x-0 top-0 z-[70] w-screen opacity-0 max-[850px]:opacity-100 ${isWindows ? "h-14" : "h-12"}`}
        />
      </div>
      <div
        className={`pointer-events-auto fixed inset-x-0 top-0 !z-[100] flex select-none items-stretch ${isWindows ? "h-10" : "h-8"}`}
      >
        <div
          aria-hidden={!contentVisible}
          className={`pointer-events-none absolute z-50 flex select-none items-center gap-2 !text-[14px] font-semibold transition-all duration-200 ease-out ${isWindows ? "left-4 top-0 font-normal h-10" : isFullscreen ? "left-3 top-1.5" : "left-20 top-1.5"} ${contentVisible ? "opacity-100" : "opacity-0"}`}
        >
          <img
            src={tintLogo}
            alt=""
            className={`h-4.5 w-4.5 object-contain ${isWindows ? "block" : "hidden"}`}
          />
          <span className="text-white/75">{title}</span>
        </div>
        <div data-tauri-drag-region="" className="h-full min-w-0 flex-1" />
        {isWindows && (minimizeWindow || closeWindow || appWindow) && (
          <div
            aria-hidden={!contentVisible}
            className={`flex shrink-0 transition-opacity duration-200 ease-out ${isWindows ? "h-10" : "h-8"} ${contentVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            {showMinimize && minimizeWindow && (
              <button
                type="button"
                aria-label="最小化窗口"
                disabled={controlsDisabled}
                onClick={() => runWindowAction(minimizeWindow)}
                className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                <MinusIcon aria-hidden size={16} weight="regular" />
              </button>
            )}
            {showMaximize && appWindow && (
              <button
                type="button"
                aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
                disabled={controlsDisabled}
                onClick={() =>
                  runWindowAction(async () => {
                    await appWindow.toggleMaximize();
                    setIsMaximized(await appWindow.isMaximized());
                  })
                }
                className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                {isMaximized ? (
                  <CopySimpleIcon aria-hidden size={16} weight="regular" />
                ) : (
                  <SquareIcon aria-hidden size={15} weight="regular" />
                )}
              </button>
            )}
            {showFullscreen && appWindow && (
              <button
                type="button"
                aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
                disabled={controlsDisabled}
                onClick={() =>
                  runWindowAction(async () => {
                    await appWindow.setFullscreen(!isFullscreen);
                    setIsFullscreen(await appWindow.isFullscreen());
                  })
                }
                className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                {isFullscreen ? (
                  <CornersInIcon aria-hidden size={16} weight="regular" />
                ) : (
                  <CornersOutIcon aria-hidden size={16} weight="regular" />
                )}
              </button>
            )}
            {showClose && closeWindow && (
              <button
                type="button"
                aria-label="关闭窗口"
                disabled={controlsDisabled}
                onClick={() => runWindowAction(closeWindow)}
                className="flex w-12 items-center justify-center text-white/80 hover:bg-red-600 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                <XIcon aria-hidden size={16} weight="regular" />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
