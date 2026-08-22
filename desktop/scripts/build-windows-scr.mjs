import { access, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const desktopRoot = resolve(import.meta.dirname, '..');
const target = process.env.TAURI_TARGET || 'x86_64-pc-windows-msvc';
const candidates = [
  process.env.TAURI_BINARY,
  resolve(desktopRoot, 'src-tauri', 'target', 'release', 'pearwall-desktop.exe'),
  resolve(desktopRoot, 'src-tauri', 'target', target, 'release', 'pearwall-desktop.exe'),
].filter(Boolean);

let source;
for (const candidate of candidates) {
  try {
    await access(candidate);
    source = candidate;
    break;
  } catch {}
}

if (!source) {
  throw new Error('未找到 Tauri Windows 可执行文件');
}

const outputRoot = process.env.OUTPUT_ROOT
  ? resolve(process.env.OUTPUT_ROOT)
  : resolve(desktopRoot, 'build', 'release', 'windows');
await mkdir(outputRoot, { recursive: true });
const output = resolve(outputRoot, 'PearWall.scr');
await cp(source, output, { force: true });
console.log(output);
