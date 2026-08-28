import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { PerformanceMode } from "../../types";
import { resolveAutoQuality } from "../model";
import type {
  BatteryManagerLike,
  BatteryNavigator,
  PowerStatus,
} from "../types";

export function usePowerQuality({
  isTauriRuntime,
  performanceMode,
  saverMax,
  balancedMax,
}: {
  isTauriRuntime: boolean;
  performanceMode: PerformanceMode;
  saverMax: number;
  balancedMax: number;
}) {
  const [powerStatus, setPowerStatus] = useState<PowerStatus | null>(null);

  useEffect(() => {
    if (performanceMode !== "AUTO") {
      setPowerStatus(null);
      return;
    }
    let disposed = false;
    let pending = false;
    let battery: BatteryManagerLike | null = null;

    const updateFromBattery = () => {
      if (disposed || !battery) return;
      setPowerStatus({
        available: true,
        batteryPercent: Math.round(battery.level * 100),
        onBattery: !battery.charging,
        lowPowerMode: false,
      });
    };

    const readPowerStatus = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        let nextStatus: PowerStatus | null = null;
        if (isTauriRuntime) {
          try {
            const nativeStatus = await invoke<PowerStatus>("get_power_status");
            if (nativeStatus.available) nextStatus = nativeStatus;
          } catch {
            nextStatus = null;
          }
        }
        if (!nextStatus) {
          const batteryNavigator = navigator as BatteryNavigator;
          if (batteryNavigator.getBattery) {
            const nextBattery =
              battery ?? (await batteryNavigator.getBattery());
            if (disposed) return;
            if (!battery) {
              battery = nextBattery;
              battery.addEventListener("levelchange", updateFromBattery);
              battery.addEventListener("chargingchange", updateFromBattery);
            }
            nextStatus = {
              available: true,
              batteryPercent: Math.round(nextBattery.level * 100),
              onBattery: !nextBattery.charging,
              lowPowerMode: false,
            };
          }
        }
        if (!disposed) {
          setPowerStatus(
            nextStatus ?? {
              available: false,
              batteryPercent: null,
              onBattery: null,
              lowPowerMode: false,
            },
          );
        }
      } catch {
        if (!disposed) {
          setPowerStatus({
            available: false,
            batteryPercent: null,
            onBattery: null,
            lowPowerMode: false,
          });
        }
      } finally {
        pending = false;
      }
    };

    void readPowerStatus();
    const timer = window.setInterval(() => {
      void readPowerStatus();
    }, 60 * 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      battery?.removeEventListener("levelchange", updateFromBattery);
      battery?.removeEventListener("chargingchange", updateFromBattery);
    };
  }, [isTauriRuntime, performanceMode]);

  return resolveAutoQuality(powerStatus, saverMax, balancedMax);
}
