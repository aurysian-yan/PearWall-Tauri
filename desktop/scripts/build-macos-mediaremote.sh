#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
SOURCE="${DESKTOP_ROOT}/src-tauri/native/macos_now_playing.m"
RESOURCE_DIR="${DESKTOP_ROOT}/src-tauri/resources/mediaremote"
OUTPUT="${RESOURCE_DIR}/PearWallMediaRemote.dylib"
CODESIGN_IDENTITY="${PEARWALL_CODESIGN_IDENTITY:--}"

mkdir -p "${RESOURCE_DIR}"

xcrun clang \
  -target arm64-apple-macos15.0 \
  -dynamiclib \
  -fobjc-arc \
  -fblocks \
  -framework Foundation \
  -Wl,-install_name,@rpath/PearWallMediaRemote.dylib \
  -o "${OUTPUT}" \
  "${SOURCE}"

CODESIGN_ARGS=(
  --force
  --sign "${CODESIGN_IDENTITY}"
  --options runtime
)
if [[ "${CODESIGN_IDENTITY}" == "-" ]]; then
  CODESIGN_ARGS+=(--timestamp=none)
else
  CODESIGN_ARGS+=(--timestamp)
fi
codesign "${CODESIGN_ARGS[@]}" "${OUTPUT}"
codesign --verify --strict --verbose=2 "${OUTPUT}"
lipo "${OUTPUT}" -verify_arch arm64

echo "${OUTPUT}"
