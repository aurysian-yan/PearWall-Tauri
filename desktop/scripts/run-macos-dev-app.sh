#!/bin/zsh
set -euo pipefail

SOURCE_BINARY="${1:A}"
shift

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
APP_ROOT="${SOURCE_BINARY:h}/Pear Wall Dev.app"
CONTENTS_ROOT="${APP_ROOT}/Contents"
APP_BINARY="${CONTENTS_ROOT}/MacOS/pearwall-desktop"
RESOURCE_ROOT="${CONTENTS_ROOT}/Resources"
MEDIAREMOTE_SOURCE="${DESKTOP_ROOT}/src-tauri/resources/mediaremote/PearWallMediaRemote.dylib"
MEDIAREMOTE_OUTPUT="${RESOURCE_ROOT}/mediaremote/PearWallMediaRemote.dylib"
CODESIGN_IDENTITY="${PEARWALL_CODESIGN_IDENTITY:--}"

mkdir -p \
  "${CONTENTS_ROOT}/MacOS" \
  "${RESOURCE_ROOT}/assets/moru" \
  "${RESOURCE_ROOT}/mediaremote"
ditto "${SOURCE_BINARY}" "${APP_BINARY}"
cp "${DESKTOP_ROOT}/src-tauri/Info.macos.plist" "${CONTENTS_ROOT}/Info.plist"
cp "${MEDIAREMOTE_SOURCE}" "${MEDIAREMOTE_OUTPUT}"
cp \
  "${DESKTOP_ROOT}/../wallpaper-engine/assets/default_artwork.svg" \
  "${RESOURCE_ROOT}/assets/default_artwork.svg"
cp \
  "${DESKTOP_ROOT}/../wallpaper-engine/src/presets.js" \
  "${RESOURCE_ROOT}/assets/presets.json"
cp -R \
  "${DESKTOP_ROOT}/../wallpaper-engine/assets/moru/." \
  "${RESOURCE_ROOT}/assets/moru/"

plutil -insert CFBundleDevelopmentRegion -string zh_CN "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleDisplayName -string 'Pear Wall' "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleExecutable -string pearwall-desktop "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleIdentifier -string com.nevoit.pearwall.desktop "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleInfoDictionaryVersion -string '6.0' "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleName -string 'Pear Wall' "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundlePackageType -string APPL "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleShortVersionString -string '0.1.1' "${CONTENTS_ROOT}/Info.plist"
plutil -insert CFBundleVersion -string '0.1.1' "${CONTENTS_ROOT}/Info.plist"
plutil -insert LSMinimumSystemVersion -string '15.0' "${CONTENTS_ROOT}/Info.plist"

CODESIGN_ARGS=(
  --force
  --sign "${CODESIGN_IDENTITY}"
  --options runtime
  --timestamp=none
)
codesign "${CODESIGN_ARGS[@]}" "${MEDIAREMOTE_OUTPUT}"
if [[ "${CODESIGN_IDENTITY}" == "-" ]]; then
  CODESIGN_ARGS+=(
    --requirements '=designated => identifier "com.nevoit.pearwall.desktop"'
  )
fi
codesign "${CODESIGN_ARGS[@]}" "${APP_ROOT}"
codesign --verify --deep --strict "${APP_ROOT}"

exec "${APP_BINARY}" "$@"
