import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..');
const sourceRoot = resolve(projectRoot, 'wallpaper-engine');
const installerUiRoot = resolve(desktopRoot, '.tmp/installer-ui');
const outputRoot = resolve(desktopRoot, '.tmp/installer-dist');
const wallpaperOutput = resolve(outputRoot, 'wallpaper');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(wallpaperOutput, { recursive: true });
await cp(installerUiRoot, outputRoot, { recursive: true });
await cp(resolve(sourceRoot, 'index.html'), resolve(wallpaperOutput, 'index.html'));
await cp(resolve(sourceRoot, 'src'), resolve(wallpaperOutput, 'src'), { recursive: true });
await cp(resolve(sourceRoot, 'assets'), resolve(wallpaperOutput, 'assets'), { recursive: true });
