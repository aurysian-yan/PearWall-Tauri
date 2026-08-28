import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  settingsFromJSON,
} from "../../settings";
import type { Settings } from "../../types";
import {
  acknowledgePermissionNotice,
  shouldShowPermissionNotice,
} from "../model";
import type { UpdateSetting } from "../types";

export function useSettingsController({
  usesSharedSettings,
  isMacOSRuntime,
}: {
  usesSharedSettings: boolean;
  isMacOSRuntime: boolean;
}) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [sharedSettingsReady, setSharedSettingsReady] =
    useState(!usesSharedSettings);
  const [permissionNoticeOpen, setPermissionNoticeOpen] = useState(
    () =>
      isMacOSRuntime &&
      settings.audioVisualization &&
      shouldShowPermissionNotice(),
  );
  const [resetSettingsOpen, setResetSettingsOpen] = useState(false);
  const sharedSaveQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    saveSettings(settings);
    if (!usesSharedSettings || !sharedSettingsReady) return;
    const json = JSON.stringify(settings);
    sharedSaveQueue.current = sharedSaveQueue.current
      .catch(() => undefined)
      .then(() => invoke("save_shared_settings", { settings: json }));
  }, [settings, sharedSettingsReady, usesSharedSettings]);

  useEffect(() => {
    if (!usesSharedSettings) return;
    let disposed = false;
    void invoke<string | null>("load_shared_settings")
      .then((json) => {
        if (!disposed && json) setSettings(settingsFromJSON(json));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setSharedSettingsReady(true);
      });
    return () => {
      disposed = true;
    };
  }, [usesSharedSettings]);

  const update = useCallback<UpdateSetting>(
    (key, value) => {
      if (
        key === "audioVisualization" &&
        value === true &&
        isMacOSRuntime &&
        shouldShowPermissionNotice()
      ) {
        setPermissionNoticeOpen(true);
      }
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [isMacOSRuntime],
  );

  const acknowledgePermission = useCallback(() => {
    acknowledgePermissionNotice();
    setPermissionNoticeOpen(false);
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
    setResetSettingsOpen(false);
  }, []);

  return {
    settings,
    setSettings,
    update,
    sharedSettingsReady,
    permissionNoticeOpen,
    setPermissionNoticeOpen,
    acknowledgePermission,
    resetSettingsOpen,
    setResetSettingsOpen,
    resetSettings,
  };
}
