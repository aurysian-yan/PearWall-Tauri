#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
SOURCE="${DESKTOP_ROOT}/src-tauri/native/macos_now_playing.m"
RESOURCE_DIR="${DESKTOP_ROOT}/src-tauri/resources/mediaremote"
OUTPUT="${RESOURCE_DIR}/PearWallMediaRemote.dylib"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pearwall-mediaremote.XXXXXX")"
trap 'rm -rf "${TEMP_ROOT}"' EXIT

mkdir -p "${RESOURCE_DIR}"

for ARCH in arm64 x86_64; do
  xcrun clang \
    -target "${ARCH}-apple-macos13.0" \
    -dynamiclib \
    -fobjc-arc \
    -fblocks \
    -framework Foundation \
    -Wl,-install_name,@rpath/PearWallMediaRemote.dylib \
    -o "${TEMP_ROOT}/PearWallMediaRemote-${ARCH}.dylib" \
    "${SOURCE}"
done

lipo -create \
  "${TEMP_ROOT}/PearWallMediaRemote-arm64.dylib" \
  "${TEMP_ROOT}/PearWallMediaRemote-x86_64.dylib" \
  -output "${OUTPUT}"

codesign --force --sign - --timestamp=none "${OUTPUT}"
lipo "${OUTPUT}" -verify_arch arm64
lipo "${OUTPUT}" -verify_arch x86_64

echo "${OUTPUT}"
