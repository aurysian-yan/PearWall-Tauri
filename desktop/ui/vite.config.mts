import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../.tmp/settings-ui',
    emptyOutDir: true,
    rollupOptions: {
      input: 'settings.html',
    },
  },
});
