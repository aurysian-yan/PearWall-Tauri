import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [, , command, ...args] = process.argv;
if (!command) {
  console.error('缺少 Tauri 命令');
  process.exit(1);
}

const tauriCli = resolve(import.meta.dirname, '../node_modules/@tauri-apps/cli/tauri.js');
const environment = { ...process.env };
const runnerArgs = [...args];
if (process.platform === 'darwin' && !environment.CARGO_BUILD_JOBS) {
  environment.CARGO_BUILD_JOBS = '1';
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
  cwd: resolve(import.meta.dirname, '..'),
  env: environment,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
