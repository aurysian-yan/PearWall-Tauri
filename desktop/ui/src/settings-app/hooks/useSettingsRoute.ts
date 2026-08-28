import { useEffect, useState } from "react";
import { readSettingsRoute } from "../model";

export function useSettingsRoute(onOpenExport: () => void) {
  const [route, setRoute] = useState(readSettingsRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(readSettingsRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const openExportImagePage = () => {
    onOpenExport();
    if (window.location.hash === "#/export-image") {
      setRoute("exportImage");
      return;
    }
    window.location.hash = "#/export-image";
  };

  const closeExportImagePage = () => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    setRoute("home");
  };

  return { route, openExportImagePage, closeExportImagePage };
}
