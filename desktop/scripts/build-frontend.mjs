import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
await cp(
  resolve(sourceRoot, 'screensaver-black.html'),
  resolve(outputRoot, 'screensaver-black.html'),
);
await cp(resolve(sourceRoot, 'src'), resolve(outputRoot, 'src'), { recursive: true });
await cp(resolve(sourceRoot, 'assets'), resolve(outputRoot, 'assets'), { recursive: true });
await cp(settingsRoot, outputRoot, { recursive: true });

const settingsHtmlPath = resolve(outputRoot, 'settings.html');
const settingsHtml = await readFile(settingsHtmlPath, 'utf8');
const settingsScriptMatch = settingsHtml.match(/src="\.\/(assets\/settings-[^"]+\.js)"/);
if (!settingsScriptMatch) {
  throw new Error('未找到设置页脚本');
}
const settingsScriptRelativePath = settingsScriptMatch[1];
const screenSaverScriptRelativePath = settingsScriptRelativePath.replace(
  /\.js$/,
  '-screensaver.js',
);
const settingsScript = await readFile(resolve(outputRoot, settingsScriptRelativePath), 'utf8');
await writeFile(
  resolve(outputRoot, screenSaverScriptRelativePath),
  settingsScript.replaceAll('import.meta.url', 'document.currentScript.src'),
);
await writeFile(
  resolve(outputRoot, 'settings-saver.html'),
  settingsHtml
    .replace(settingsScriptRelativePath, screenSaverScriptRelativePath)
    .replace('type="module"', 'defer')
    .replaceAll(' crossorigin', ''),
);
