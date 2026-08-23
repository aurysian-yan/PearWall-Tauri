#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
PROJECT_ROOT="${DESKTOP_ROOT:h}"
OUTPUT_ROOT="${OUTPUT_ROOT:-${DESKTOP_ROOT}/build/release/macos}"
BUNDLE_PATH="${OUTPUT_ROOT}/Pear Wall.saver"
CODESIGN_IDENTITY="${PEARWALL_CODESIGN_IDENTITY:--}"

if [[ "${PEARWALL_SKIP_FRONTEND_BUILD:-0}" != "1" ]]; then
  pnpm --dir "${DESKTOP_ROOT}" run build:frontend
fi

zsh "${SCRIPT_DIR}/build-macos-mediaremote.sh" >/dev/null

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pearwall-saver.XXXXXX")"
trap 'rm -rf "${TEMP_ROOT}"' EXIT

rm -rf "${BUNDLE_PATH}"
mkdir -p \
  "${BUNDLE_PATH}/Contents/MacOS" \
  "${BUNDLE_PATH}/Contents/Resources/web" \
  "${BUNDLE_PATH}/Contents/Resources/mediaremote"

ARM64_BINARY="${TEMP_ROOT}/PearWallScreenSaver-arm64"
X86_64_BINARY="${TEMP_ROOT}/PearWallScreenSaver-x86_64"

xcrun swiftc \
  -emit-library \
  -parse-as-library \
  -module-name PearWallScreenSaver \
  -target arm64-apple-macos11.0 \
  -Xlinker -bundle \
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
  -Xlinker -bundle \
  -o "${X86_64_BINARY}" \
  "${DESKTOP_ROOT}/macos-saver/PearWallScreenSaverView.swift" \
  -framework AppKit \
  -framework ScreenSaver \
  -framework WebKit

lipo -create "${ARM64_BINARY}" "${X86_64_BINARY}" \
  -output "${BUNDLE_PATH}/Contents/MacOS/PearWallScreenSaver"
cp "${DESKTOP_ROOT}/macos-saver/Info.plist" "${BUNDLE_PATH}/Contents/Info.plist"
cp -R "${DESKTOP_ROOT}/dist/." "${BUNDLE_PATH}/Contents/Resources/web/"
cp \
  "${DESKTOP_ROOT}/src-tauri/resources/mediaremote/PearWallMediaRemote.dylib" \
  "${BUNDLE_PATH}/Contents/Resources/mediaremote/PearWallMediaRemote.dylib"

plutil -lint "${BUNDLE_PATH}/Contents/Info.plist" >/dev/null
lipo "${BUNDLE_PATH}/Contents/MacOS/PearWallScreenSaver" -verify_arch arm64
lipo "${BUNDLE_PATH}/Contents/MacOS/PearWallScreenSaver" -verify_arch x86_64
if ! otool -hv "${BUNDLE_PATH}/Contents/MacOS/PearWallScreenSaver" | grep -q "BUNDLE"; then
  echo "屏保主程序不是可加载的 Mach-O bundle" >&2
  exit 1
fi

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
