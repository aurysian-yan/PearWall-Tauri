import { spawn, spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const [, , command, ...args] = process.argv;
if (!command) {
  console.error('缺少 Tauri 命令');
  process.exit(1);
}

const tauriCli = resolve(import.meta.dirname, '../node_modules/@tauri-apps/cli/tauri.js');
const environment = { ...process.env };
const defaultRoot = resolve(import.meta.dirname, '..');
const tauriRoot = environment.TAURI_CWD
  ? isAbsolute(environment.TAURI_CWD)
    ? environment.TAURI_CWD
    : resolve(defaultRoot, environment.TAURI_CWD)
  : defaultRoot;
const runnerArgs = [...args];
const targetIndex = runnerArgs.findIndex((argument) => argument === '--target');
const target = targetIndex >= 0 ? runnerArgs[targetIndex + 1] : '';
if (
  process.platform === 'darwin'
  && (command === 'build' || command === 'dev')
  && (!target || target.includes('apple-darwin'))
) {
  const helperBuild = spawnSync(
    'zsh',
    [resolve(import.meta.dirname, 'build-macos-mediaremote.sh')],
    { cwd: tauriRoot, env: environment, stdio: 'inherit' },
  );
  if (helperBuild.error) throw helperBuild.error;
  if (helperBuild.status !== 0) process.exit(helperBuild.status ?? 1);
}
if (process.platform === 'darwin' && !environment.CARGO_BUILD_JOBS) {
  environment.CARGO_BUILD_JOBS = '1';
}
if (process.platform === 'darwin' && command === 'dev') {
  environment.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER ??= resolve(
    import.meta.dirname,
    'run-macos-dev-app.sh',
  );
}
if (
  process.platform === 'darwin'
  && (command === 'build' || command === 'dev')
  && !runnerArgs.some((argument) => argument === '--jobs' || argument === '-j')
) {
  const separator = runnerArgs.indexOf('--');
  if (separator === -1) runnerArgs.push('--', '--jobs', '1');
  else runnerArgs.splice(separator + 1, 0, '--jobs', '1');
}

const child = spawn(process.execPath, [tauriCli, command, ...runnerArgs], {
  cwd: tauriRoot,
  env: environment,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
