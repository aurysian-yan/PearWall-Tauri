#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_ROOT="${SCRIPT_DIR:h}"
MANIFEST_PATH="${DESKTOP_ROOT}/src-tauri/Cargo.toml"
TARGET_ROOT="${CARGO_TARGET_DIR:-${DESKTOP_ROOT}/src-tauri/target}"
TARGET="${PEARWALL_MACOS_TARGET:-aarch64-apple-darwin}"
OUTPUT_APP_BUNDLE="${OUTPUT_APP_BUNDLE:-${DESKTOP_ROOT}/build/release/macos/Pear Wall.app}"
AGENT_APP="${OUTPUT_APP_BUNDLE}/Contents/Library/LoginItems/Pear Wall Agent.app"
AGENT_BINARY="${TARGET_ROOT}/${TARGET}/release/pearwall-agent"
CODESIGN_IDENTITY="${PEARWALL_CODESIGN_IDENTITY:--}"

if [[ "${PEARWALL_SKIP_AGENT_BINARY_BUILD:-0}" != "1" ]]; then
  cargo build \
    --manifest-path "${MANIFEST_PATH}" \
    --release \
    --bin pearwall-agent \
    --features tauri/custom-protocol \
    --target "${TARGET}"
fi

if [[ ! -f "${AGENT_BINARY}" ]]; then
  echo "未找到 macOS Agent：${AGENT_BINARY}" >&2
  exit 1
fi

lipo "${AGENT_BINARY}" -verify_arch arm64

if [[ "${PEARWALL_AGENT_BINARY_ONLY:-0}" == "1" ]]; then
  echo "${AGENT_BINARY}"
  exit 0
fi

rm -rf "${AGENT_APP}"
mkdir -p "${AGENT_APP}/Contents/MacOS" "${AGENT_APP}/Contents/Resources"
cp "${DESKTOP_ROOT}/macos-agent/Info.plist" "${AGENT_APP}/Contents/Info.plist"
cp \
  "${DESKTOP_ROOT}/macos-agent/PearWallStatusTemplate.svg" \
  "${AGENT_APP}/Contents/Resources/PearWallStatusTemplate.svg"
cp "${AGENT_BINARY}" "${AGENT_APP}/Contents/MacOS/PearWallAgent"

plutil -lint "${AGENT_APP}/Contents/Info.plist" >/dev/null
lipo "${AGENT_APP}/Contents/MacOS/PearWallAgent" -verify_arch arm64

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
codesign "${CODESIGN_ARGS[@]}" "${AGENT_APP}"
codesign --verify --strict --verbose=2 "${AGENT_APP}"

echo "${AGENT_APP}"
