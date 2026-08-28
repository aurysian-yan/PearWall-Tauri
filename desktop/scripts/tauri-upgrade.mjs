import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(desktopRoot, "..");
const versionScript = resolve(desktopRoot, "scripts/version.mjs");
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const versionFiles = [
  "desktop/package.json",
  "desktop/src-tauri/tauri.conf.json",
  "desktop/src-tauri/Cargo.toml",
  "desktop/src-tauri/Cargo.lock",
  "desktop/installer/src-tauri/tauri.conf.json",
  "desktop/installer/src-tauri/Cargo.toml",
  "desktop/installer/src-tauri/Cargo.lock",
  "desktop/macos-saver/Info.plist",
  "desktop/ui/src/InstallerApp.tsx",
  "desktop/ui/src/settings-app/HomeSettingsPage.tsx",
  "desktop/scripts/run-macos-dev-app.sh",
  "native/pearwall-core/Cargo.toml",
  "native/pearwall-core/Cargo.lock",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
}

function parseArguments(args) {
  const values = args.filter((value) => value !== "--");
  const noCommit = values.includes("--no-commit");
  const unknownOptions = values.filter(
    (value) => value.startsWith("--") && value !== "--no-commit",
  );
  if (unknownOptions.length > 0) {
    throw new Error(`未知参数：${unknownOptions.join("、")}`);
  }

  const versions = values.filter((value) => !value.startsWith("--"));
  if (versions.length !== 1) {
    throw new Error(
      "用法：pnpm tauri:upgrade -- 1.2.3 [--no-commit]",
    );
  }

  const version = versions[0];
  if (!versionPattern.test(version)) {
    throw new Error(`无效版本号：${version}`);
  }
  return { version, noCommit };
}

function changedFiles(cached = false) {
  const args = ["diff", "--name-only"];
  if (cached) args.splice(1, 0, "--cached");
  const output = run("git", args).trim();
  return output ? output.split("\n") : [];
}

function assertFilesEqual(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const unexpected = actual.filter((file) => !expectedSet.has(file));
  const missing = expected.filter((file) => !actualSet.has(file));
  if (unexpected.length === 0 && missing.length === 0) return;

  const details = [
    unexpected.length > 0 ? `非预期文件：${unexpected.join("、")}` : "",
    missing.length > 0 ? `缺少文件：${missing.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("；");
  throw new Error(`${label}不符合预期：${details}`);
}

function assertCleanWorktree() {
  const output = run("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]).trim();
  if (output) {
    throw new Error("工作区不干净，请先提交或暂存现有改动后再升级版本号。");
  }
}

function main() {
  const { version, noCommit } = parseArguments(process.argv.slice(2));
  assertCleanWorktree();

  const currentVersion = run(process.execPath, [versionScript, "--check"]).trim();
  if (currentVersion === version) {
    throw new Error(`当前版本已经是 ${version}，无需升级。`);
  }

  run(process.execPath, [versionScript, "--set", version], { stdio: "inherit" });
  assertFilesEqual(changedFiles(), versionFiles, "版本文件变更");

  run("git", ["add", "--", ...versionFiles], { stdio: "inherit" });
  assertFilesEqual(changedFiles(true), versionFiles, "暂存文件变更");
  run("git", ["diff", "--cached", "--check"], { stdio: "inherit" });
  if (noCommit) return;
  run(
    "git",
    ["commit", "-m", `upgrade: 更新应用版本号至 ${version}`],
    { stdio: "inherit" },
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
