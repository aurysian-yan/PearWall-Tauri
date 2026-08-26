import { access, cp, mkdir } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const desktopRoot = resolve(import.meta.dirname, '..');
const installerRoot = resolve(desktopRoot, 'installer');
const target = process.env.TAURI_TARGET || 'x86_64-pc-windows-msvc';
const runtimeBinary = process.env.PEARWALL_PAYLOAD_PATH
  ? resolve(process.env.PEARWALL_PAYLOAD_PATH)
  : resolve(desktopRoot, 'src-tauri', 'target', target, 'release', 'pearwall-desktop.exe');
const installerBinary = resolve(
  installerRoot,
  'src-tauri',
  'target',
  target,
  'release',
  'pearwall-installer.exe',
);
const outputRoot = process.env.OUTPUT_ROOT
  ? resolve(process.env.OUTPUT_ROOT)
  : resolve(desktopRoot, 'build', 'release', 'windows');
const installerConfig = JSON.parse(
  readFileSync(resolve(installerRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const appConfig = JSON.parse(
  readFileSync(resolve(desktopRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const installerCargoManifest = readFileSync(
  resolve(installerRoot, 'src-tauri', 'Cargo.toml'),
  'utf8',
);
const installerCargoVersion = installerCargoManifest.match(
  /^version\s*=\s*"([^"]+)"/m,
)?.[1];

if (
  installerConfig.version !== appConfig.version
  || installerConfig.version !== installerCargoVersion
) {
  throw new Error(
    `版本不一致：主程序 ${appConfig.version}，安装器配置 ${installerConfig.version}，安装器 Rust ${installerCargoVersion ?? '未知'}`,
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? desktopRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === 'pnpm',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败`);
}

async function buildEnvironment() {
  const env = { ...process.env };
  for (const candidate of ['/opt/homebrew/opt/llvm/bin', '/usr/local/opt/llvm/bin']) {
    try {
      await access(resolve(candidate, 'llvm-rc'));
      env.PATH = `${candidate}${delimiter}${env.PATH ?? ''}`;
      break;
    } catch {}
  }
  return env;
}

const env = await buildEnvironment();
if (process.env.PEARWALL_SKIP_RUNTIME_BUILD !== '1') {
  run('pnpm', ['build:frontend'], { env });
  const runtimeArgs = ['tauri', 'build'];
  if (process.platform !== 'win32') runtimeArgs.push('--runner', 'cargo-xwin');
  runtimeArgs.push(
    '--target',
    target,
    '--config',
    '{"build":{"beforeBuildCommand":""}}',
    '--no-bundle',
  );
  run('pnpm', runtimeArgs, { env });
}

await access(runtimeBinary);
run('pnpm', ['build:installer-frontend'], { env });

const installerArgs = ['build'];
if (process.platform !== 'win32') installerArgs.push('--runner', 'cargo-xwin');
installerArgs.push(
  '--target',
  target,
  '--config',
  '{"build":{"beforeBuildCommand":""}}',
  '--no-bundle',
);
run(process.execPath, [resolve(desktopRoot, 'scripts', 'tauri-runner.mjs'), ...installerArgs], {
  env: {
    ...env,
    PEARWALL_PAYLOAD_PATH: runtimeBinary,
    TAURI_CWD: isAbsolute(installerRoot) ? installerRoot : resolve(installerRoot),
  },
});

await access(installerBinary);
await mkdir(outputRoot, { recursive: true });
await cp(runtimeBinary, resolve(outputRoot, 'PearWall.scr'), { force: true });
await cp(runtimeBinary, resolve(outputRoot, 'PearWall.exe'), { force: true });
const output = resolve(
  outputRoot,
  `Pear-Wall-Screen-Saver-${installerConfig.version}-setup.exe`,
);
await cp(installerBinary, output, { force: true });
console.log(output);
