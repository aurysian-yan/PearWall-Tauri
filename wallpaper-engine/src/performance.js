(function () {
  const AUTO_MODE = 'AUTO';
  const POWER_SAVING = 'POWER_SAVING';
  const BALANCED = 'BALANCED';
  const CLEAR = 'CLEAR';
  const POWER_STATUS_INTERVAL_MS = 60 * 1000;

  function normalizedTier(value) {
    const tier = String(value || '').toUpperCase();
    if (tier === 'LOW' || tier === 'HIGH') return tier;
    return BALANCED;
  }

  function detectPerformanceTier() {
    const cores = Number(navigator.hardwareConcurrency) || 0;
    const memory = Number(navigator.deviceMemory) || 0;
    if (cores > 0 && cores <= 4) return 'LOW';
    if (memory > 0 && memory <= 4 && cores <= 8) return 'LOW';
    if (cores >= 8 && memory >= 8) return 'HIGH';
    if (cores >= 12) return 'HIGH';
    return BALANCED;
  }

  function normalizedStatus(status, tier) {
    const batteryPercent = Number(status && status.batteryPercent);
    return {
      tier: normalizedTier(status && status.tier) === BALANCED
        ? tier
        : normalizedTier(status && status.tier),
      batteryPercent: Number.isFinite(batteryPercent)
        ? Math.max(0, Math.min(100, Math.round(batteryPercent)))
        : null,
      onBattery: typeof (status && status.onBattery) === 'boolean'
        ? status.onBattery
        : null,
      lowPowerMode: Boolean(status && status.lowPowerMode),
    };
  }

  function qualityForStatus(status, saverMax = 20, balancedMax = 60) {
    const normalizedSaverMax = Math.max(1, Math.min(98, Math.round(Number(saverMax) || 20)));
    const normalizedBalancedMax = Math.max(
      normalizedSaverMax + 1,
      Math.min(99, Math.round(Number(balancedMax) || 60)),
    );
    const forcedPowerSaving = status.lowPowerMode || status.tier === 'LOW';
    const batteryPercent = status.batteryPercent;
    if (forcedPowerSaving) return POWER_SAVING;
    if (batteryPercent !== null) {
      if (batteryPercent < normalizedSaverMax) {
        return POWER_SAVING;
      }
      if (batteryPercent < normalizedBalancedMax) {
        return BALANCED;
      }
      return CLEAR;
    }
    if (status.onBattery === false && status.tier === 'HIGH') return CLEAR;
    return BALANCED;
  }

  function effectiveSettings(settings, status) {
    if (String(settings.performanceMode || '').toUpperCase() !== AUTO_MODE) {
      return { settings, quality: null };
    }
    const quality = qualityForStatus(
      status,
      settings.autoBatterySaverMax,
      settings.autoBatteryBalancedMax,
    );
    const maximumRenderScale = quality === POWER_SAVING
      ? 0.5
      : quality === BALANCED
        ? 0.75
        : 1;
    return {
      quality,
      settings: {
        ...settings,
        renderScale: maximumRenderScale,
        blurEnabled: quality === POWER_SAVING ? false : Boolean(settings.blurEnabled),
      },
    };
  }

  function readBrowserBattery() {
    if (!navigator.getBattery) return Promise.resolve(null);
    return navigator.getBattery()
      .then((battery) => ({
        battery,
        status: {
          batteryPercent: battery.level * 100,
          onBattery: !battery.charging,
          lowPowerMode: false,
        },
      }))
      .catch(() => null);
  }

  function createMonitor(onChange) {
    const tier = detectPerformanceTier();
    let status = normalizedStatus({}, tier);
    let battery = null;
    let disposed = false;
    let started = false;
    let timer = 0;
    let refreshPending = false;

    const notify = (nextStatus) => {
      const next = normalizedStatus({ ...status, ...nextStatus }, tier);
      const changed = next.tier !== status.tier
        || next.batteryPercent !== status.batteryPercent
        || next.onBattery !== status.onBattery
        || next.lowPowerMode !== status.lowPowerMode;
      status = next;
      if (changed && !disposed && started) onChange(status);
    };

    const refresh = async () => {
      if (disposed || !started || refreshPending) return;
      refreshPending = true;
      try {
        const tauriInvoke = window.__TAURI__
          && window.__TAURI__.core
          && window.__TAURI__.core.invoke;
        if (tauriInvoke) {
          try {
            const nativeStatus = await tauriInvoke('get_power_status');
            if (nativeStatus && nativeStatus.available) {
              notify(nativeStatus);
              return;
            }
          } catch (_) {
            // 读取原生状态失败时继续尝试浏览器电池接口。
          }
        }
        const browserBattery = await readBrowserBattery();
        if (browserBattery) {
          battery = browserBattery.battery;
          notify(browserBattery.status);
        }
      } finally {
        refreshPending = false;
      }
    };

    const refreshFromBattery = () => {
      if (!battery) return;
      notify({
        batteryPercent: battery.level * 100,
        onBattery: !battery.charging,
      });
    };

    return {
      start() {
        if (disposed || started) return;
        started = true;
        void refresh();
        timer = window.setInterval(() => void refresh(), POWER_STATUS_INTERVAL_MS);
        void readBrowserBattery().then((result) => {
          if (!result || disposed || !started) return;
          battery = result.battery;
          battery.addEventListener('levelchange', refreshFromBattery);
          battery.addEventListener('chargingchange', refreshFromBattery);
          notify(result.status);
        });
      },
      stop() {
        if (!started) return;
        started = false;
        if (timer) window.clearInterval(timer);
        timer = 0;
        if (battery) {
          battery.removeEventListener('levelchange', refreshFromBattery);
          battery.removeEventListener('chargingchange', refreshFromBattery);
        }
        battery = null;
      },
      status() {
        return status;
      },
      dispose() {
        this.stop();
        disposed = true;
      },
    };
  }

  window.PearWallPerformance = {
    effectiveSettings,
    createMonitor,
  };
}());
