import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..');
const sourceRoot = resolve(projectRoot, 'wallpaper-engine');
const settingsRoot = resolve(desktopRoot, '.tmp/settings-ui');
const outputRoot = resolve(desktopRoot, 'dist');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(resolve(sourceRoot, 'index.html'), resolve(outputRoot, 'index.html'));
await cp(resolve(sourceRoot, 'src'), resolve(outputRoot, 'src'), { recursive: true });
await cp(resolve(sourceRoot, 'assets'), resolve(outputRoot, 'assets'), { recursive: true });
await cp(settingsRoot, outputRoot, { recursive: true });
