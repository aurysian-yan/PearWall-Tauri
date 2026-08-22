#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
PROJECT_ROOT="${DESKTOP_ROOT:h}"
OUTPUT_ROOT="${DESKTOP_ROOT}/build/macos"
BUNDLE_PATH="${OUTPUT_ROOT}/Pear Wall.saver"

pnpm --dir "${DESKTOP_ROOT}" run build:frontend
rm -rf "${OUTPUT_ROOT}"
mkdir -p "${BUNDLE_PATH}/Contents/MacOS" "${BUNDLE_PATH}/Contents/Resources/web"

ARM64_BINARY="${OUTPUT_ROOT}/PearWallScreenSaver-arm64"
X86_64_BINARY="${OUTPUT_ROOT}/PearWallScreenSaver-x86_64"

xcrun swiftc \
  -emit-library \
  -parse-as-library \
  -module-name PearWallScreenSaver \
  -target arm64-apple-macos11.0 \
  -o "${ARM64_BINARY}" \
  "${DESKTOP_ROOT}/macos-saver/PearWallScreenSaverView.swift" \
  -framework AppKit \
  -framework ScreenSaver \
  -framework WebKit

xcrun swiftc \
  -emit-library \
  -parse-as-library \
  -module-name PearWallScreenSaver \
  -target x86_64-apple-macos11.0 \
  -o "${X86_64_BINARY}" \
  "${DESKTOP_ROOT}/macos-saver/PearWallScreenSaverView.swift" \
  -framework AppKit \
  -framework ScreenSaver \
  -framework WebKit

lipo -create "${ARM64_BINARY}" "${X86_64_BINARY}" \
  -output "${BUNDLE_PATH}/Contents/MacOS/PearWallScreenSaver"
cp "${DESKTOP_ROOT}/macos-saver/Info.plist" "${BUNDLE_PATH}/Contents/Info.plist"
cp -R "${DESKTOP_ROOT}/dist/." "${BUNDLE_PATH}/Contents/Resources/web/"

echo "${BUNDLE_PATH}"
