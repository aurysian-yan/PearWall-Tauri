import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { UpdateSetting, WallpaperRuntimeStatus } from "../types";

export function useWallpaperRuntime({
  supported,
  initiallyEnabled,
  update,
}: {
  supported: boolean;
  initiallyEnabled: boolean;
  update: UpdateSetting;
}) {
  const [status, setStatus] = useState<WallpaperRuntimeStatus>({
    supported,
    running: initiallyEnabled,
    displayCount: 0,
  });
  const [loading, setLoading] = useState(supported);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let pending = false;

    const refreshStatus = async () => {
      if (pending) return;
      pending = true;
      try {
        const nextStatus = await invoke<WallpaperRuntimeStatus>(
          "plugin:pearwall-wallpaper|status",
        );
        if (disposed) return;
        setStatus(nextStatus);
        if (nextStatus.running) {
          setFailed(false);
          setError("");
        }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    };

    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [supported]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setLoading(true);
      setFailed(false);
      setError("");
      try {
        const nextStatus = await invoke<WallpaperRuntimeStatus>(
          "set_dynamic_wallpaper_enabled",
          { enabled },
        );
        setStatus(nextStatus);
        update("dynamicWallpaperEnabled", nextStatus.running);
      } catch (nextError) {
        setFailed(true);
        setError(String(nextError));
      } finally {
        setLoading(false);
      }
    },
    [update],
  );

  return { status, loading, failed, error, setEnabled };
}
