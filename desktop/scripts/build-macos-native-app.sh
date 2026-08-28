#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
PROJECT_ROOT="${DESKTOP_ROOT:h}"
TARGET="${PEARWALL_MACOS_TARGET:-aarch64-apple-darwin}"
NATIVE_ROOT="${DESKTOP_ROOT}/macos-native"
TARGET_ROOT="${NATIVE_ROOT}/target/${TARGET}/release"
OUTPUT_ROOT="${DESKTOP_ROOT}/build/native/${TARGET}"
BUNDLE_PATH="${OUTPUT_ROOT}/Pear Wall.app"
CODESIGN_IDENTITY="${PEARWALL_CODESIGN_IDENTITY:--}"

if [[ "${PEARWALL_SKIP_NATIVE_BUILD:-0}" != "1" ]]; then
  cargo build \
    --manifest-path "${NATIVE_ROOT}/Cargo.toml" \
    --release \
    --target "${TARGET}"
fi

rm -rf "${BUNDLE_PATH}"
mkdir -p \
  "${BUNDLE_PATH}/Contents/MacOS" \
  "${BUNDLE_PATH}/Contents/Resources/assets" \
  "${BUNDLE_PATH}/Contents/Resources/frontend" \
  "${BUNDLE_PATH}/Contents/Resources/mediaremote"

cp "${TARGET_ROOT}/pearwall-macos-native" "${BUNDLE_PATH}/Contents/MacOS/PearWall"
cp "${NATIVE_ROOT}/Info.plist" "${BUNDLE_PATH}/Contents/Info.plist"
cp "${DESKTOP_ROOT}/src-tauri/icons/icon.icns" "${BUNDLE_PATH}/Contents/Resources/icon.icns"
cp "${DESKTOP_ROOT}/src-tauri/resources/mediaremote/PearWallMediaRemote.dylib" \
  "${BUNDLE_PATH}/Contents/Resources/mediaremote/PearWallMediaRemote.dylib"

cp -R "${DESKTOP_ROOT}/dist/." "${BUNDLE_PATH}/Contents/Resources/frontend/"
cp "${DESKTOP_ROOT}/dist/assets/default_artwork.svg" \
  "${BUNDLE_PATH}/Contents/Resources/assets/default_artwork.svg"
cp -R "${DESKTOP_ROOT}/dist/assets/moru/." \
  "${BUNDLE_PATH}/Contents/Resources/assets/moru/"
sed \
  -e 's/^window.PearWallPresets = //' \
  -e 's/;$//' \
  "${PROJECT_ROOT}/wallpaper-engine/src/presets.js" \
  > "${BUNDLE_PATH}/Contents/Resources/assets/presets.json"

plutil -lint "${BUNDLE_PATH}/Contents/Info.plist" >/dev/null
lipo "${BUNDLE_PATH}/Contents/MacOS/PearWall" -verify_arch arm64

CODESIGN_ARGS=(
  --force
  --deep
  --sign "${CODESIGN_IDENTITY}"
  --options runtime
)
if [[ "${CODESIGN_IDENTITY}" == "-" ]]; then
  CODESIGN_ARGS+=(--timestamp=none)
else
  CODESIGN_ARGS+=(--timestamp)
fi
codesign "${CODESIGN_ARGS[@]}" "${BUNDLE_PATH}"
codesign --verify --deep --strict --verbose=2 "${BUNDLE_PATH}"

echo "${BUNDLE_PATH}"
