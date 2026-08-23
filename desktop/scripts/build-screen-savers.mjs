import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const desktopRoot = resolve(import.meta.dirname, '..');
const projectRoot = resolve(desktopRoot, '..');
const releaseRoot = resolve(desktopRoot, 'build', 'release');
const macosOutput = resolve(releaseRoot, 'macos');
const windowsOutput = resolve(releaseRoot, 'windows');
const windowsTarget = 'x86_64-pc-windows-msvc';
const windowsBinary = resolve(
  desktopRoot,
  'src-tauri',
  'target',
  windowsTarget,
  'release',
  'pearwall-desktop.exe',
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : '';
    throw new Error(detail || `${command} 执行失败`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function commandExists(command, env) {
  return spawnSync('which', [command], { env, stdio: 'ignore' }).status === 0;
}

async function directoryExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createBuildEnvironment() {
  const env = { ...process.env };
  const llvmCandidates = [
    '/opt/homebrew/opt/llvm/bin',
    '/usr/local/opt/llvm/bin',
  ];

  for (const candidate of llvmCandidates) {
    if (await directoryExists(resolve(candidate, 'llvm-rc'))) {
      env.PATH = `${candidate}${delimiter}${env.PATH ?? ''}`;
      break;
    }
  }

  const commands = [
    'pnpm',
    'rustup',
    'cargo-xwin',
    'llvm-rc',
    'xcrun',
    'lipo',
    'otool',
    'plutil',
    'codesign',
    'ditto',
    'create-dmg',
  ];
  const missing = commands.filter((command) => !commandExists(command, env));
  if (missing.length > 0) {
    throw new Error(`缺少构建工具：${missing.join('、')}`);
  }

  const installedTargets = run('rustup', ['target', 'list', '--installed'], {
    capture: true,
    env,
  }).split('\n');
  if (!installedTargets.includes(windowsTarget)) {
    throw new Error(`缺少 Rust 目标：${windowsTarget}`);
  }

  await access(resolve(projectRoot, 'dmgbg@2x.png'));
  return env;
}

if (process.platform !== 'darwin') {
  throw new Error('统一构建需要在 macOS 上运行');
}

const env = await createBuildEnvironment();
if (process.argv.includes('--check')) {
  console.log('屏保构建环境检查通过');
  process.exit(0);
}

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(macosOutput, { recursive: true });
await mkdir(windowsOutput, { recursive: true });

run('pnpm', ['build:frontend'], { env });

run(
  'pnpm',
  [
    'tauri',
    'build',
    '--runner',
    'cargo-xwin',
    '--target',
    windowsTarget,
    '--config',
    '{"build":{"beforeBuildCommand":""}}',
    '--no-bundle',
  ],
  { env },
);

run(process.execPath, [resolve(import.meta.dirname, 'build-windows-scr.mjs')], {
  env: {
    ...env,
    OUTPUT_ROOT: windowsOutput,
    TAURI_BINARY: windowsBinary,
    TAURI_TARGET: windowsTarget,
  },
});

run(process.execPath, [resolve(import.meta.dirname, 'build-windows-installer.mjs')], {
  env: {
    ...env,
    OUTPUT_ROOT: windowsOutput,
    PEARWALL_PAYLOAD_PATH: windowsBinary,
    PEARWALL_SKIP_RUNTIME_BUILD: '1',
    TAURI_TARGET: windowsTarget,
  },
});

run('zsh', [resolve(import.meta.dirname, 'build-macos-saver.sh')], {
  env: {
    ...env,
    OUTPUT_ROOT: macosOutput,
    PEARWALL_SKIP_FRONTEND_BUILD: '1',
  },
});

run('zsh', [resolve(import.meta.dirname, 'build-macos-app.sh')], {
  env: {
    ...env,
    OUTPUT_ROOT: macosOutput,
    PEARWALL_SKIP_FRONTEND_BUILD: '1',
  },
});

run('zsh', [resolve(import.meta.dirname, 'build-dmg.sh')], {
  env: {
    ...env,
    OUTPUT_DIR: macosOutput,
    SAVER_BUNDLE_PATH: resolve(macosOutput, 'Pear Wall.saver'),
    APP_BUNDLE_PATH: resolve(macosOutput, 'Pear Wall.app'),
    PEARWALL_SKIP_SAVER_BUILD: '1',
    PEARWALL_SKIP_APP_BUILD: '1',
  },
});

const macosFiles = (await readdir(macosOutput)).sort();
const windowsFiles = (await readdir(windowsOutput)).sort();
console.log('\n屏保构建完成');
console.log(`macOS：${macosFiles.join('、')}`);
console.log(`Windows：${windowsFiles.join('、')}`);
console.log(`输出目录：${releaseRoot}`);
