#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
PROJECT_ROOT="${DESKTOP_ROOT:h}"
OUTPUT="${OUTPUT_DIR:-${DESKTOP_ROOT}/build/release/macos}"
APP_NAME="${APP_NAME:-Pear Wall}"
APP_VERSION="${APP_VERSION:-$(node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "${DESKTOP_ROOT}/src-tauri/tauri.conf.json")}"
DMG_NAME="${DMG_NAME:-Pear-Wall-Screen-Saver-${APP_VERSION}.dmg}"
DMG_PATH="${OUTPUT}/${DMG_NAME}"
MOUNT_NAME="/Volumes/${APP_NAME}"
BACKGROUND="${BACKGROUND:-${DESKTOP_ROOT}/assets/dmgbg@2x.png}"
SRC="${SAVER_BUNDLE_PATH:-${OUTPUT}/Pear Wall.saver}"
SAVER_BUNDLE_NAME="$(basename "${SRC}")"
APP_SRC="${APP_BUNDLE_PATH:-${OUTPUT}/Pear Wall.app}"
APP_BUNDLE_NAME="$(basename "${APP_SRC}")"

if [[ "${PEARWALL_SKIP_SAVER_BUILD:-0}" != "1" ]]; then
  OUTPUT_ROOT="${OUTPUT}" zsh "${SCRIPT_DIR}/build-macos-saver.sh"
fi

if [[ "${PEARWALL_SKIP_APP_BUILD:-0}" != "1" ]]; then
  OUTPUT_ROOT="${OUTPUT}" zsh "${SCRIPT_DIR}/build-macos-app.sh"
fi

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "未找到 create-dmg，请先运行：brew install create-dmg" >&2
  exit 1
fi

if [[ ! -d "${SRC}" ]]; then
  echo "未找到屏保：${SRC}" >&2
  exit 1
fi

if [[ ! -d "${APP_SRC}" ]]; then
  echo "未找到 App：${APP_SRC}" >&2
  exit 1
fi

if [[ ! -f "${BACKGROUND}" ]]; then
  echo "未找到 DMG 背景：${BACKGROUND}" >&2
  exit 1
fi

mkdir -p "${OUTPUT}"
rm -f "${DMG_PATH}"

if [[ -d "${MOUNT_NAME}" ]]; then
  hdiutil detach "${MOUNT_NAME}" -force >/dev/null 2>&1 || true
fi

STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pearwall-dmg.XXXXXX")"
trap 'rm -rf "${STAGING_ROOT}"' EXIT
ditto "${SRC}" "${STAGING_ROOT}/${SAVER_BUNDLE_NAME}"
ditto "${APP_SRC}" "${STAGING_ROOT}/${APP_BUNDLE_NAME}"

create-dmg \
  --volname "${APP_NAME}" \
  --window-size 676 732 \
  --icon-size 120 \
  --text-size 14 \
  --icon "${APP_BUNDLE_NAME}" 200 150 \
  --icon "${SAVER_BUNDLE_NAME}" 200 500 \
  --app-drop-link 200 320 \
  --background "${BACKGROUND}" \
  "${DMG_PATH}" \
  "${STAGING_ROOT}"

printf '\nDMG 已生成：%s\n' "${DMG_PATH}"
