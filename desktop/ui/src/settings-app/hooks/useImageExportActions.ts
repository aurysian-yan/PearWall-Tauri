import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveFile } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";
import type { ExportSettings } from "../../types";
import type { ExportImageOptions } from "../types";

export function useImageExportActions({
  isTauriRuntime,
  renderCurrentImage,
}: {
  isTauriRuntime: boolean;
  renderCurrentImage: (options: ExportImageOptions) => Promise<string>;
}) {
  const exportCurrentImage = useCallback(
    async (
      options: ExportImageOptions,
      destination: Pick<
        ExportSettings,
        "askForLocation" | "defaultDirectory"
      >,
    ) => {
      const dataUrl = await renderCurrentImage(options);
      if (isTauriRuntime) {
        const fileName = destination.askForLocation
          ? `Pear-Wall-${options.width}x${options.height}.png`
          : `Pear-Wall-${Date.now()}.png`;
        let defaultDirectory = destination.defaultDirectory;
        if (destination.askForLocation && !defaultDirectory) {
          try {
            defaultDirectory = await invoke<string>(
              "get_default_export_directory",
            );
          } catch {
            defaultDirectory = "";
          }
        }
        const path = destination.askForLocation
          ? await saveFile({
              title: "导出 PNG 图片",
              defaultPath: defaultDirectory
                ? `${defaultDirectory.replace(/[\\/]+$/, "")}/${fileName}`
                : fileName,
              filters: [{ name: "PNG 图片", extensions: ["png"] }],
            })
          : defaultDirectory
            ? `${defaultDirectory.replace(/[\\/]+$/, "")}/${fileName}`
            : null;
        if (!path) {
          return destination.askForLocation ? "已取消导出" : "";
        }
        const savedPath = await invoke<string>("save_exported_image", {
          dataUrl,
          path,
        });
        return `图片已保存至 ${savedPath}`;
      }
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `Pear-Wall-${options.width}x${options.height}.png`;
      link.click();
      return "图片已开始下载";
    },
    [isTauriRuntime, renderCurrentImage],
  );

  const copyCurrentImage = useCallback(
    async (options: ExportImageOptions) => {
      const dataUrl = await renderCurrentImage(options);
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("当前环境不支持复制图片");
      }
      const encoded = dataUrl.slice("data:image/png;base64,".length);
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return "图片已复制到剪贴板";
    },
    [renderCurrentImage],
  );

  const chooseDefaultExportDirectory = useCallback(
    async (currentDirectory: string) => {
      if (!isTauriRuntime) return null;
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择默认导出目录",
        ...(currentDirectory ? { defaultPath: currentDirectory } : {}),
      });
      return typeof selected === "string" ? selected : null;
    },
    [isTauriRuntime],
  );

  return {
    exportCurrentImage,
    copyCurrentImage,
    chooseDefaultExportDirectory,
  };
}
