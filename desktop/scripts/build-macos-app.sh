#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
OUTPUT_ROOT="${OUTPUT_ROOT:-${DESKTOP_ROOT}/build/release/macos}"
TARGET="${PEARWALL_MACOS_TARGET:-aarch64-apple-darwin}"
APP_NAME="${APP_NAME:-Pear Wall}"
XCODE_PROJECT="${DESKTOP_ROOT}/macos-native/PearWall.xcodeproj"
XCODE_DERIVED_ROOT="${DESKTOP_ROOT}/build/xcode/${TARGET}"
SOURCE_APP="${SOURCE_APP_BUNDLE:-${XCODE_DERIVED_ROOT}/Build/Products/Release/${APP_NAME}.app}"
OUTPUT_APP="${OUTPUT_ROOT}/${APP_NAME}.app"
CODESIGN_IDENTITY="${PEARWALL_CODESIGN_IDENTITY:--}"

if [[ "${PEARWALL_SKIP_FRONTEND_BUILD:-0}" != "1" ]]; then
  pnpm --dir "${DESKTOP_ROOT}" run build:frontend
fi

zsh "${SCRIPT_DIR}/build-macos-mediaremote.sh" >/dev/null

if [[ "${PEARWALL_SKIP_APP_BUILD:-0}" != "1" ]]; then
  if [[ "${TARGET}" != "aarch64-apple-darwin" ]]; then
    echo "Xcode macOS 工程当前仅支持 aarch64-apple-darwin：${TARGET}" >&2
    exit 1
  fi
  xcodebuild \
    -project "${XCODE_PROJECT}" \
    -scheme PearWall \
    -configuration Release \
    -sdk macosx \
    -derivedDataPath "${XCODE_DERIVED_ROOT}" \
    -quiet \
    build
fi

if [[ ! -d "${SOURCE_APP}" ]]; then
  echo "未找到 macOS App：${SOURCE_APP}" >&2
  exit 1
fi

rm -rf "${OUTPUT_APP}"
mkdir -p "${OUTPUT_ROOT}"
ditto "${SOURCE_APP}" "${OUTPUT_APP}"
cp \
  "${DESKTOP_ROOT}/src-tauri/resources/mediaremote/PearWallMediaRemote.dylib" \
  "${OUTPUT_APP}/Contents/Resources/mediaremote/PearWallMediaRemote.dylib"

APP_EXECUTABLE="$(plutil -extract CFBundleExecutable raw "${OUTPUT_APP}/Contents/Info.plist")"
APP_BINARY="${OUTPUT_APP}/Contents/MacOS/${APP_EXECUTABLE}"
lipo "${APP_BINARY}" -verify_arch arm64

CODESIGN_ARGS=(
  --force
  --sign "${CODESIGN_IDENTITY}"
  --options runtime
)
if [[ "${CODESIGN_IDENTITY}" == "-" ]]; then
  CODESIGN_ARGS+=(
    --timestamp=none
    --requirements '=designated => identifier "com.nevoit.pearwall.desktop"'
  )
else
  CODESIGN_ARGS+=(--timestamp)
fi
codesign "${CODESIGN_ARGS[@]}" "${OUTPUT_APP}"
codesign --verify --deep --strict --verbose=2 "${OUTPUT_APP}"

echo "${OUTPUT_APP}"
