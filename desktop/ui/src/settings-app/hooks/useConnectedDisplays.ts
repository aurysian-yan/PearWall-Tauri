import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Settings } from "../../types";
import type { ConnectedDisplay } from "../types";

export function useConnectedDisplays({
  enabled,
  sharedSettingsReady,
  setSettings,
}: {
  enabled: boolean;
  sharedSettingsReady: boolean;
  setSettings: Dispatch<SetStateAction<Settings>>;
}) {
  const [connectedDisplays, setConnectedDisplays] = useState<
    ConnectedDisplay[]
  >([]);
  const [displayLoading, setDisplayLoading] = useState(enabled);
  const [displayDiscoveryFailed, setDisplayDiscoveryFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const refreshDisplays = async () => {
      try {
        const displays = await invoke<ConnectedDisplay[]>(
          "get_connected_displays",
        );
        if (disposed) return;
        setConnectedDisplays(displays);
        setDisplayDiscoveryFailed(false);
      } catch {
        if (!disposed) setDisplayDiscoveryFailed(true);
      } finally {
        if (!disposed) setDisplayLoading(false);
      }
    };

    void refreshDisplays();
    const timer = window.setInterval(() => {
      void refreshDisplays();
    }, 4000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !sharedSettingsReady || connectedDisplays.length === 0) {
      return;
    }
    setSettings((current) => {
      const persistentId = (value: string) =>
        connectedDisplays.find(
          (display) => display.id === value || display.persistentId === value,
        )?.persistentId ?? value;
      const migratedScreenSaverIds = current.screenSaverDisplayIds?.map(
        persistentId,
      );
      const migratedWallpaperIds = current.dynamicWallpaperDisplayIds?.map(
        persistentId,
      );
      if (current.screenSaverDisplayIds !== null) {
        if (
          JSON.stringify(migratedScreenSaverIds) ===
            JSON.stringify(current.screenSaverDisplayIds) &&
          JSON.stringify(migratedWallpaperIds) ===
            JSON.stringify(current.dynamicWallpaperDisplayIds)
        ) {
          return current;
        }
        return {
          ...current,
          screenSaverDisplayIds: migratedScreenSaverIds ?? [],
          dynamicWallpaperDisplayIds: migratedWallpaperIds ?? null,
        };
      }
      const primary = connectedDisplays.find((display) => display.isPrimary);
      const legacyTarget =
        current.screenSaverDisplay === "SECONDARY"
          ? (connectedDisplays.find((display) => !display.isPrimary) ?? primary)
          : (primary ?? connectedDisplays[0]);
      return {
        ...current,
        screenSaverDisplayIds: legacyTarget ? [legacyTarget.persistentId] : [],
        dynamicWallpaperDisplayIds: migratedWallpaperIds ?? null,
      };
    });
  }, [connectedDisplays, enabled, setSettings, sharedSettingsReady]);

  const toggleScreenSaverDisplay = useCallback(
    (id: string, selected: boolean) => {
      setSettings((current) => {
        const currentIds = current.screenSaverDisplayIds ?? [];
        const screenSaverDisplayIds = selected
          ? Array.from(new Set([...currentIds, id]))
          : currentIds.filter((value) => value !== id);
        return { ...current, screenSaverDisplayIds };
      });
    },
    [setSettings],
  );

  const toggleDynamicWallpaperDisplay = useCallback(
    (id: string, selected: boolean) => {
      setSettings((current) => {
        const currentIds =
          current.dynamicWallpaperDisplayIds ??
          connectedDisplays.map((display) => display.persistentId);
        const dynamicWallpaperDisplayIds = selected
          ? Array.from(new Set([...currentIds, id]))
          : currentIds.filter((value) => value !== id);
        if (dynamicWallpaperDisplayIds.length === 0) return current;
        return { ...current, dynamicWallpaperDisplayIds };
      });
    },
    [connectedDisplays, setSettings],
  );

  return {
    connectedDisplays,
    displayLoading,
    displayDiscoveryFailed,
    toggleScreenSaverDisplay,
    toggleDynamicWallpaperDisplay,
  };
}
