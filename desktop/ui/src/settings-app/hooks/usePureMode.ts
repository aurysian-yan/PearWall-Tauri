import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";

export function usePureMode(isTauriRuntime: boolean) {
  const [contentVisible, setContentVisible] = useState(true);
  const [pureMode, setPureMode] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const appWindow = getCurrentWindow();
    const syncFullscreenState = () => {
      void appWindow
        .isFullscreen()
        .then(setPureMode)
        .catch(() => setPureMode(false));
    };
    syncFullscreenState();
    const unlistenPromise = appWindow.onResized(syncFullscreenState);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isTauriRuntime]);

  const enterPureMode = useCallback(() => {
    if (!isTauriRuntime) return;
    setContentVisible(false);
    void getCurrentWindow()
      .setFullscreen(true)
      .then(() => setPureMode(true))
      .catch(() => undefined);
  }, [isTauriRuntime]);

  const toggleContentVisibility = useCallback(() => {
    setContentVisible((visible) => !visible);
  }, []);

  return {
    contentVisible,
    pureMode,
    enterPureMode,
    toggleContentVisibility,
  };
}
