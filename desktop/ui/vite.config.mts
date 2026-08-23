import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));
const wallpaperRoot = fileURLToPath(new URL('../../wallpaper-engine', import.meta.url));
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function wallpaperDevServer(routePrefix = ''): Plugin {
  return {
    name: 'pearwall-wallpaper-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add([
        resolve(wallpaperRoot, 'index.html'),
        resolve(wallpaperRoot, 'src'),
        resolve(wallpaperRoot, 'assets'),
      ]);
      server.watcher.on('change', (changedPath) => {
        const changedRelativePath = relative(wallpaperRoot, changedPath);
        if (!changedRelativePath.startsWith('..') && !isAbsolute(changedRelativePath)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
        const wallpaperPath = routePrefix && pathname.startsWith(`${routePrefix}/`)
          ? pathname.slice(routePrefix.length)
          : routePrefix
            ? ''
            : pathname;
        const relativePath = wallpaperPath === '/' || wallpaperPath === '/index.html'
          ? 'index.html'
          : wallpaperPath.startsWith('/src/') || wallpaperPath.startsWith('/assets/')
            ? wallpaperPath.slice(1)
            : '';
        if (!relativePath) {
          next();
          return;
        }

        const filePath = resolve(wallpaperRoot, relativePath);
        const safeRelativePath = relative(wallpaperRoot, filePath);
        if (safeRelativePath.startsWith('..') || isAbsolute(safeRelativePath)) {
          next();
          return;
        }

        try {
          const fileStats = await stat(filePath);
          if (!fileStats.isFile()) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader('Cache-Control', 'no-cache');
          response.setHeader('Content-Type', contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream');
          response.end(await readFile(filePath));
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const installer = mode === 'installer';

  return {
    root: uiRoot,
    base: './',
    envDir: '..',
    plugins: [wallpaperDevServer(installer ? '/wallpaper' : ''), react(), tailwindcss()],
    resolve: {
      alias: {
        '/ui-src': resolve(uiRoot, 'src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
    },
    build: {
      outDir: installer ? '../.tmp/installer-ui' : '../.tmp/settings-ui',
      emptyOutDir: true,
      rollupOptions: {
        input: installer ? 'installer.html' : 'settings.html',
      },
    },
  };
});
