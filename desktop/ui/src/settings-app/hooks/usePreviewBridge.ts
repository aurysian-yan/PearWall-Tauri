import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { wallpaperSettings } from "../../settings";
import type { Settings } from "../../types";
import type {
  ExportImageOptions,
  MediaArtwork,
  PearWallPreviewWindow,
} from "../types";

function previewTargetOrigin() {
  return window.location.protocol === "file:" ? "*" : window.location.origin;
}

export function usePreviewBridge({
  isTauriRuntime,
  settings,
}: {
  isTauriRuntime: boolean;
  settings: Settings;
}) {
  const previewRef = useRef<HTMLIFrameElement>(null);
  const mediaArtworkCache = useRef<MediaArtwork | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [mediaArtwork, setMediaArtwork] = useState<MediaArtwork | null>(null);

  const syncPreview = useCallback(() => {
    previewRef.current?.contentWindow?.postMessage(
      { type: "pearwall:settings", settings: wallpaperSettings(settings) },
      previewTargetOrigin(),
    );
  }, [settings]);

  useEffect(() => {
    syncPreview();
  }, [syncPreview]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (
        window.location.protocol !== "file:" &&
        event.origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type !== "pearwall:ready") return;
      setPreviewReady(true);
      const artwork = mediaArtworkCache.current;
      if (!artwork) return;
      previewRef.current?.contentWindow?.postMessage(
        { type: "pearwall:media-artwork", artwork },
        previewTargetOrigin(),
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime || !previewReady) return;
    let disposed = false;
    let pending = false;
    let currentKey = "";

    const pollArtwork = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const artwork = await invoke<MediaArtwork>("get_media_artwork", {
          currentKey,
        });
        if (disposed) return;
        currentKey = artwork.key;
        const cached = mediaArtworkCache.current;
        const nextArtwork =
          artwork.data_url || cached?.key !== artwork.key
            ? artwork
            : { ...artwork, data_url: cached.data_url };
        mediaArtworkCache.current = nextArtwork;
        setMediaArtwork((current) => {
          if (
            current?.key === nextArtwork.key &&
            current.title === nextArtwork.title &&
            current.artist === nextArtwork.artist &&
            current.album === nextArtwork.album &&
            current.data_url === nextArtwork.data_url
          ) {
            return current;
          }
          return nextArtwork;
        });
        previewRef.current?.contentWindow?.postMessage(
          { type: "pearwall:media-artwork", artwork: nextArtwork },
          previewTargetOrigin(),
        );
      } catch {
        return;
      } finally {
        pending = false;
      }
    };

    void pollArtwork();
    const timer = window.setInterval(() => {
      void pollArtwork();
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [isTauriRuntime, previewReady]);

  useEffect(() => {
    if (!isTauriRuntime || !previewReady || !settings.audioVisualization) {
      return;
    }
    let disposed = false;
    let pending = false;

    const sendPulse = (pulse: number) => {
      previewRef.current?.contentWindow?.postMessage(
        { type: "pearwall:audio-pulse", pulse },
        previewTargetOrigin(),
      );
    };

    const pollAudio = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const pulse = await invoke<number>("get_audio_pulse", {
          timestampSeconds: Date.now() / 1000,
        });
        if (!disposed) sendPulse(pulse);
      } catch {
        return;
      } finally {
        pending = false;
      }
    };

    void pollAudio();
    const timer = window.setInterval(() => {
      void pollAudio();
    }, 33);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      sendPulse(0);
    };
  }, [isTauriRuntime, previewReady, settings.audioVisualization]);

  const renderCurrentImage = useCallback(
    async (options: ExportImageOptions) => {
      const previewWindow = previewRef.current
        ?.contentWindow as PearWallPreviewWindow | null;
      const exportImage = previewWindow?.PearWallExportImage;
      if (!exportImage) {
        throw new Error("实时画面尚未准备好，请稍后重试");
      }
      const logoPath = document
        .querySelector<SVGPathElement>('svg[aria-label="Pear Wall"] path')
        ?.getAttribute("d");
      const dataUrl = await exportImage({
        ...options,
        watermarkLogoPath: logoPath ?? undefined,
        songTitle: mediaArtwork?.title,
        songArtist: mediaArtwork?.artist,
        songAlbum: mediaArtwork?.album,
        songArtwork: mediaArtwork?.data_url ?? undefined,
      });
      if (!dataUrl.startsWith("data:image/png;base64,")) {
        throw new Error("无法生成 PNG 图片");
      }
      return dataUrl;
    },
    [mediaArtwork],
  );

  return { previewRef, previewReady, syncPreview, renderCurrentImage };
}
