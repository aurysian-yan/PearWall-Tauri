import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "@heroui/react";
import { InstallerApp } from "./InstallerApp";
import "./index.css";

document.documentElement.classList.add("windows");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider locale="zh-CN">
      <InstallerApp />
    </I18nProvider>
  </React.StrictMode>,
);
