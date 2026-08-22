import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '@heroui/react';
import { SettingsApp } from './SettingsApp';
import './index.css';

if (/Windows/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('windows');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider locale="zh-CN">
      <SettingsApp />
    </I18nProvider>
  </React.StrictMode>,
);
