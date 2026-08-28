import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { isTauri } from "@tauri-apps/api/core";
import { Drawer } from "vaul";
import { Toaster } from "sonner";
import { useRef, useState, type ChangeEvent } from "react";
import { WindowTitleBar } from "../WindowTitleBar";
import { DrawerPageContent } from "./components/SettingsDrawer";
import {
  PermissionNotice,
  ResetSettingsDialog,
} from "./components/SettingsDialogs";
import { ExportImagePage } from "./export/ExportImagePage";
import { HomeSettingsPage } from "./HomeSettingsPage";
import { useConnectedDisplays } from "./hooks/useConnectedDisplays";
import { useImageExportActions } from "./hooks/useImageExportActions";
import { usePowerQuality } from "./hooks/usePowerQuality";
import { usePreviewBridge } from "./hooks/usePreviewBridge";
import { usePureMode } from "./hooks/usePureMode";
import { useSettingsController } from "./hooks/useSettingsController";
import { useSettingsRoute } from "./hooks/useSettingsRoute";
import { useWallpaperRuntime } from "./hooks/useWallpaperRuntime";
import type { DrawerPage } from "./types";

export function SettingsApp() {
  const isTauriRuntime = isTauri();
  const isWindowsRuntime =
    isTauriRuntime && document.documentElement.classList.contains("windows");
  const isMacOSRuntime = isTauriRuntime && !isWindowsRuntime;
  const supportsDynamicWallpaper = isMacOSRuntime || isWindowsRuntime;
  const supportsScreenSaverDisplays = isMacOSRuntime || isWindowsRuntime;
  const [drawerPage, setDrawerPage] = useState<DrawerPage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
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
  } = useSettingsController({
    usesSharedSettings: isTauriRuntime,
    isMacOSRuntime,
  });

  const currentAutoQuality = usePowerQuality({
    isTauriRuntime,
    performanceMode: settings.performanceMode,
    saverMax: settings.autoBatterySaverMax,
    balancedMax: settings.autoBatteryBalancedMax,
  });

  const {
    connectedDisplays,
    displayLoading,
    displayDiscoveryFailed,
    toggleScreenSaverDisplay,
    toggleDynamicWallpaperDisplay,
  } = useConnectedDisplays({
    enabled: supportsDynamicWallpaper,
    sharedSettingsReady,
    setSettings,
  });

  const {
    status: wallpaperStatus,
    loading: wallpaperLoading,
    failed: wallpaperFailed,
    error: wallpaperError,
    setEnabled: setWallpaperEnabled,
  } = useWallpaperRuntime({
    supported: supportsDynamicWallpaper,
    initiallyEnabled: settings.dynamicWallpaperEnabled,
    update,
  });

  const { previewRef, previewReady, syncPreview, renderCurrentImage } =
    usePreviewBridge({ isTauriRuntime, settings });

  const {
    contentVisible,
    pureMode,
    enterPureMode,
    toggleContentVisibility,
  } = usePureMode(isTauriRuntime);

  const { route, openExportImagePage, closeExportImagePage } = useSettingsRoute(
    () => setDrawerPage(null),
  );

  const {
    exportCurrentImage,
    copyCurrentImage,
    chooseDefaultExportDirectory,
  } = useImageExportActions({ isTauriRuntime, renderCurrentImage });

  const handleArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setSettings((current) => ({
        ...current,
        artworkFallback: "CUSTOM",
        customArtwork: reader.result as string,
        customArtworkName: file.name,
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-black text-white ${settings.hideCursor && pureMode && !contentVisible ? "hide-cursor" : ""}`}
    >
      <Toaster
        position="top-center"
        theme="dark"
        offset={{ top: "3.5rem" }}
        mobileOffset={{ top: "3.5rem" }}
        toastOptions={{
          style: {
            borderRadius: "1.25rem",
            background: "rgba(0, 0, 0, 0.68)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            backdropFilter: "blur(16px) saturate(150%)",
            WebkitBackdropFilter: "blur(16px) saturate(150%)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
          },
        }}
      />
      {isTauriRuntime && <WindowTitleBar contentVisible={contentVisible} />}
      <img
        src={settings.customArtwork || "./assets/default_artwork.svg"}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
      />
      <iframe
        ref={previewRef}
        title="屏幕保护程序实时预览"
        src="./index.html"
        onLoad={syncPreview}
        className={`pointer-events-none absolute inset-0 h-full w-full border-0 ${!isTauriRuntime || previewReady ? "opacity-100" : "opacity-0"}`}
      />

      <OverlayScrollbarsComponent
        defer
        className={`settings-scrollbar absolute inset-0 overscroll-contain transition-[translate,opacity] duration-300 ease-out ${route === "exportImage" ? "-translate-x-8 opacity-0" : "translate-x-0 opacity-100"}`}
        options={{
          overflow: { x: "hidden", y: "scroll" },
          scrollbars: {
            theme: "os-theme-light",
            autoHide: "scroll",
            autoHideDelay: 700,
          },
        }}
        onClick={(event) => {
          if (!isTauriRuntime) return;
          const viewport = event.currentTarget.querySelector(
            "[data-overlayscrollbars-viewport]",
          );
          if (event.target === viewport) {
            toggleContentVisibility();
          }
        }}
      >
        <HomeSettingsPage
          isTauriRuntime={isTauriRuntime}
          isMacOSRuntime={isMacOSRuntime}
          supportsDynamicWallpaper={supportsDynamicWallpaper}
          supportsScreenSaverDisplays={supportsScreenSaverDisplays}
          active={route === "home"}
          contentVisible={contentVisible}
          settings={settings}
          setSettings={setSettings}
          update={update}
          fileInputRef={fileInputRef}
          onArtworkChange={handleArtwork}
          onEnterPureMode={enterPureMode}
          wallpaperStatus={wallpaperStatus}
          wallpaperLoading={wallpaperLoading}
          wallpaperFailed={wallpaperFailed}
          wallpaperError={wallpaperError}
          onWallpaperEnabledChange={(value) => void setWallpaperEnabled(value)}
          setDrawerPage={setDrawerPage}
          onOpenExportImage={openExportImagePage}
          onOpenResetSettings={() => setResetSettingsOpen(true)}
        />
      </OverlayScrollbarsComponent>
      <Drawer.Root
        open={route === "home" && drawerPage !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerPage(null);
        }}
        shouldScaleBackground={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
          <Drawer.Content className="drawer-content fixed inset-x-0 bottom-0 z-[61] mx-auto flex max-h-[88vh] min-h-[320px] w-full max-w-2xl flex-col overflow-hidden bg-neutral-950/70 text-white shadow-2xl outline-none ring-1 ring-inset ring-white/10 backdrop-blur-xl backdrop-saturate-150">
            {drawerPage && (
              <DrawerPageContent
                page={drawerPage}
                settings={settings}
                currentAutoQuality={currentAutoQuality}
                update={update}
                isMacOSRuntime={isMacOSRuntime}
                connectedDisplays={connectedDisplays}
                displayLoading={displayLoading}
                displayDiscoveryFailed={displayDiscoveryFailed}
                onDynamicWallpaperDisplayChange={toggleDynamicWallpaperDisplay}
                onScreenSaverDisplayChange={toggleScreenSaverDisplay}
              />
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <div
        aria-hidden={route !== "exportImage"}
        className={`fixed inset-0 z-[70] h-full w-full bg-black/50 text-white backdrop-blur-sm transition-opacity duration-300 ease-out ${route === "exportImage" ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div
          className={`mx-auto h-full w-full max-w-lg transition-[translate,opacity] duration-300 ease-out ${route === "exportImage" ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0"}`}
        >
          <ExportImagePage
            onPreview={renderCurrentImage}
            onExport={exportCurrentImage}
            onCopy={copyCurrentImage}
            onChooseDefaultDirectory={chooseDefaultExportDirectory}
            isTauriRuntime={isTauriRuntime}
            onBack={closeExportImagePage}
          />
        </div>
      </div>
      <PermissionNotice
        open={permissionNoticeOpen}
        onOpenChange={setPermissionNoticeOpen}
        onAcknowledge={acknowledgePermission}
      />
      <ResetSettingsDialog
        open={resetSettingsOpen}
        onOpenChange={setResetSettingsOpen}
        onReset={resetSettings}
      />
    </div>
  );
}
