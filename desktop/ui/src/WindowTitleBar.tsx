import { getCurrentWindow } from '@tauri-apps/api/window';
import { MinusIcon, SquareIcon, XIcon } from '@phosphor-icons/react';

const isWindowsApp = /Windows/i.test(navigator.userAgent) && '__TAURI_INTERNALS__' in window;

function runWindowAction(action: () => Promise<void>) {
  void action().catch(() => undefined);
}

export function WindowTitleBar() {
  const appWindow = isWindowsApp ? getCurrentWindow() : null;

  return (
    <div className="absolute inset-x-0 top-0 z-50 flex h-8 select-none items-stretch">
      <div data-tauri-drag-region="" className="min-w-0 flex-1" />
      {appWindow && (
        <div className="flex h-8 shrink-0">
          <button
            type="button"
            aria-label="最小化窗口"
            onClick={() => runWindowAction(() => appWindow.minimize())}
            className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white"
          >
            <MinusIcon aria-hidden size={14} weight="regular" />
          </button>
          <button
            type="button"
            aria-label="最大化或还原窗口"
            onClick={() => runWindowAction(() => appWindow.toggleMaximize())}
            className="flex w-12 items-center justify-center text-white/80 hover:bg-white/10 hover:text-white"
          >
            <SquareIcon aria-hidden size={12} weight="regular" />
          </button>
          <button
            type="button"
            aria-label="关闭窗口"
            onClick={() => runWindowAction(() => appWindow.close())}
            className="flex w-12 items-center justify-center text-white/80 hover:bg-red-600 hover:text-white"
          >
            <XIcon aria-hidden size={14} weight="regular" />
          </button>
        </div>
      )}
    </div>
  );
}
