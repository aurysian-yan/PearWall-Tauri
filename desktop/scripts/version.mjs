import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(desktopRoot, "..");
const packagePath = resolve(desktopRoot, "package.json");

const paths = {
  appConfig: resolve(desktopRoot, "src-tauri/tauri.conf.json"),
  appCargo: resolve(desktopRoot, "src-tauri/Cargo.toml"),
  appLock: resolve(desktopRoot, "src-tauri/Cargo.lock"),
  installerConfig: resolve(desktopRoot, "installer/src-tauri/tauri.conf.json"),
  installerCargo: resolve(desktopRoot, "installer/src-tauri/Cargo.toml"),
  installerLock: resolve(desktopRoot, "installer/src-tauri/Cargo.lock"),
  saverInfo: resolve(desktopRoot, "macos-saver/Info.plist"),
  installerUi: resolve(desktopRoot, "ui/src/InstallerApp.tsx"),
  settingsUi: resolve(desktopRoot, "ui/src/SettingsApp.tsx"),
  macosRunner: resolve(desktopRoot, "scripts/run-macos-dev-app.sh"),
  coreCargo: resolve(projectRoot, "native/pearwall-core/Cargo.toml"),
  coreLock: resolve(projectRoot, "native/pearwall-core/Cargo.lock"),
};

function readJson(text) {
  return JSON.parse(text);
}

function packageVersion(text, name) {
  const block = text.match(
    new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`),
  );
  if (!block) throw new Error(`未找到 ${name} 的版本号`);
  return block[1];
}

function cargoVersion(text) {
  const value = text.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!value) throw new Error("未找到 Cargo 版本号");
  return value;
}

function replaceCargoVersion(text, version) {
  return text.replace(
    /^(version\s*=\s*)"[^"]+"/m,
    `$1"${version}"`,
  );
}

function replacePackageVersion(text, name, version) {
  const pattern = new RegExp(
    `(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = )"[^"]+"`,
  );
  if (!pattern.test(text)) throw new Error(`未找到 ${name} 的锁文件版本号`);
  return text.replace(pattern, `$1"${version}"`);
}

function plistVersions(text) {
  const shortVersion = text.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];
  const bundleVersion = text.match(
    /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];
  if (!shortVersion || !bundleVersion) throw new Error("未找到屏保版本号");
  return [shortVersion, bundleVersion];
}

function replacePlistVersions(text, version) {
  return text
    .replace(
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${version}$2`,
    )
    .replace(
      /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${version}$2`,
    );
}

function matchedVersion(text, pattern, label) {
  const value = text.match(pattern)?.[1];
  if (!value) throw new Error(`未找到${label}版本号`);
  return value;
}

async function collectVersions() {
  const [
    packageText,
    appConfigText,
    appCargoText,
    appLockText,
    installerConfigText,
    installerCargoText,
    installerLockText,
    saverInfoText,
    installerUiText,
    settingsUiText,
    macosRunnerText,
    coreCargoText,
    coreLockText,
  ] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(paths.appConfig, "utf8"),
    readFile(paths.appCargo, "utf8"),
    readFile(paths.appLock, "utf8"),
    readFile(paths.installerConfig, "utf8"),
    readFile(paths.installerCargo, "utf8"),
    readFile(paths.installerLock, "utf8"),
    readFile(paths.saverInfo, "utf8"),
    readFile(paths.installerUi, "utf8"),
    readFile(paths.settingsUi, "utf8"),
    readFile(paths.macosRunner, "utf8"),
    readFile(paths.coreCargo, "utf8"),
    readFile(paths.coreLock, "utf8"),
  ]);

  const [saverShortVersion, saverBundleVersion] = plistVersions(saverInfoText);
  return {
    package: readJson(packageText).version,
    appConfig: readJson(appConfigText).version,
    appCargo: cargoVersion(appCargoText),
    appLock: packageVersion(appLockText, "pearwall-desktop"),
    installerConfig: readJson(installerConfigText).version,
    installerCargo: cargoVersion(installerCargoText),
    installerLock: packageVersion(installerLockText, "pearwall-installer"),
    saverShortVersion,
    saverBundleVersion,
    installerUi: matchedVersion(
      installerUiText,
      /targetVersion:\s*"([^"]+)"/,
      "安装器界面",
    ),
    settingsUi: matchedVersion(
      settingsUiText,
      /description="版本 ([^"]+)"/,
      "设置界面",
    ),
    macosRunner: matchedVersion(
      macosRunnerText,
      /CFBundleShortVersionString -string '([^']+)'/,
      "开发 App",
    ),
    coreCargo: cargoVersion(coreCargoText),
    coreLock: packageVersion(coreLockText, "pearwall-core"),
    appCoreLock: packageVersion(appLockText, "pearwall-core"),
  };
}

async function checkVersions() {
  const versions = await collectVersions();
  const current = versions.package;
  const mismatches = Object.entries(versions).filter(([, value]) => value !== current);
  if (mismatches.length > 0) {
    const detail = mismatches.map(([name, value]) => `${name}=${value}`).join("、");
    throw new Error(`版本号不一致：package=${current}、${detail}`);
  }
  process.stdout.write(current);
}

async function setVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`无效版本号：${version}`);
  }

  const packageJson = readJson(await readFile(packagePath, "utf8"));
  packageJson.version = version;

  const appConfig = readJson(await readFile(paths.appConfig, "utf8"));
  appConfig.version = version;

  const installerConfig = readJson(await readFile(paths.installerConfig, "utf8"));
  installerConfig.version = version;

  const updates = [
    [packagePath, `${JSON.stringify(packageJson, null, 2)}\n`],
    [paths.appConfig, `${JSON.stringify(appConfig, null, 2)}\n`],
    [paths.installerConfig, `${JSON.stringify(installerConfig, null, 2)}\n`],
    [
      paths.appCargo,
      replaceCargoVersion(await readFile(paths.appCargo, "utf8"), version),
    ],
    [
      paths.installerCargo,
      replaceCargoVersion(await readFile(paths.installerCargo, "utf8"), version),
    ],
    [
      paths.coreCargo,
      replaceCargoVersion(await readFile(paths.coreCargo, "utf8"), version),
    ],
    [
      paths.appLock,
      replacePackageVersion(
        replacePackageVersion(
          await readFile(paths.appLock, "utf8"),
          "pearwall-desktop",
          version,
        ),
        "pearwall-core",
        version,
      ),
    ],
    [
      paths.installerLock,
      replacePackageVersion(
        await readFile(paths.installerLock, "utf8"),
        "pearwall-installer",
        version,
      ),
    ],
    [
      paths.coreLock,
      replacePackageVersion(
        await readFile(paths.coreLock, "utf8"),
        "pearwall-core",
        version,
      ),
    ],
    [
      paths.saverInfo,
      replacePlistVersions(await readFile(paths.saverInfo, "utf8"), version),
    ],
    [
      paths.installerUi,
      (await readFile(paths.installerUi, "utf8")).replace(
        /targetVersion:\s*"[^"]+"/,
        `targetVersion: "${version}"`,
      ),
    ],
    [
      paths.settingsUi,
      (await readFile(paths.settingsUi, "utf8")).replace(
        /description="版本 [^"]+"/,
        `description="版本 ${version}"`,
      ),
    ],
    [
      paths.macosRunner,
      (await readFile(paths.macosRunner, "utf8"))
        .replace(
          /CFBundleShortVersionString -string '[^']+'/,
          `CFBundleShortVersionString -string '${version}'`,
        )
        .replace(
          /CFBundleVersion -string '[^']+'/,
          `CFBundleVersion -string '${version}'`,
        ),
    ],
  ];

  await Promise.all(updates.map(([path, content]) => writeFile(path, content)));
  await checkVersions();
}

const setIndex = process.argv.indexOf("--set");
if (setIndex >= 0) {
  const version = process.argv[setIndex + 1];
  if (!version) throw new Error("请提供版本号");
  await setVersion(version);
} else {
  await checkVersions();
}
