import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CopySimpleIcon,
  CornersInIcon,
  CornersOutIcon,
  MinusIcon,
  SquareIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
const tintLogo = new URL("./tint-logo.png", import.meta.url).href;

function runWindowAction(action: () => Promise<void>) {
  void action().catch(() => undefined);
}

export function WindowTitleBar({
  contentVisible,
}: {
  contentVisible: boolean;
}) {
  const isWindows = document.documentElement.classList.contains("windows");
  const appWindow = useMemo(
    () => (isWindows ? getCurrentWindow() : null),
    [isWindows],
  );
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
    <div
      className={`absolute inset-x-0 top-0 z-50 flex select-none items-stretch ${isWindows ? "h-10" : "h-8"}`}
    >
      <h1
        aria-hidden={!contentVisible}
        className={`pointer-events-none absolute left-4 top-0 z-50 select-none items-center gap-2 !text-[14px] transition-opacity duration-200 ease-out ${isWindows ? "flex h-10" : "hidden"} ${contentVisible ? "opacity-100" : "opacity-0"}`}
      >
        <img src={tintLogo} alt="" className="h-4.5 w-4.5" />
        <span className="text-white/75">PearWall 设置</span>
      </h1>
      <div data-tauri-drag-region="" className="min-w-0 flex-1" />
      {appWindow && (
        <div
          aria-hidden={!contentVisible}
          className={`flex shrink-0 transition-opacity duration-200 ease-out ${isWindows ? "h-10" : "h-8"} ${contentVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <button
            type="button"
            aria-label="最小化窗口"
            onClick={() => runWindowAction(() => appWindow.minimize())}
            className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white"
          >
            <MinusIcon aria-hidden size={16} weight="regular" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
            onClick={() =>
              runWindowAction(async () => {
                await appWindow.toggleMaximize();
                setIsMaximized(await appWindow.isMaximized());
              })
            }
            className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white"
          >
            {isMaximized ? (
              <CopySimpleIcon aria-hidden size={16} weight="regular" />
            ) : (
              <SquareIcon aria-hidden size={15} weight="regular" />
            )}
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
            onClick={() =>
              runWindowAction(async () => {
                await appWindow.setFullscreen(!isFullscreen);
                setIsFullscreen(await appWindow.isFullscreen());
              })
            }
            className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white"
          >
            {isFullscreen ? (
              <CornersInIcon aria-hidden size={16} weight="regular" />
            ) : (
              <CornersOutIcon aria-hidden size={16} weight="regular" />
            )}
          </button>
          <button
            type="button"
            aria-label="关闭窗口"
            onClick={() => runWindowAction(() => appWindow.close())}
            className="flex w-12 items-center justify-center text-white/80 hover:bg-red-600 hover:text-white"
          >
            <XIcon aria-hidden size={16} weight="regular" />
          </button>
        </div>
      )}
    </div>
  );
}
