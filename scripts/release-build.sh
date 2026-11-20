#!/usr/bin/env bash
# Builds one platform of a release from its tag and leaves the files to attach
# in out/, under fixed names so releases/latest/download/<name> always
# resolves. Run by the build job of .github/workflows/release.yml:
#
#   bash scripts/release-build.sh <rust target> <arch>
#
# TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) sign the updater bundles.
set -euo pipefail

TARGET=$1
ARCH=$2
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null; then
  npm install --global bun
fi
rustup target add "$TARGET"

bun install --frozen-lockfile
bun run sidecar:build --target "$TARGET"
bun tauri build --target "$TARGET" --config src-tauri/tauri.release.conf.json

BUNDLE="src-tauri/target/$TARGET/release/bundle"
mkdir -p out
if [ "$(uname -s)" = Darwin ]; then
  CONTENTS="$BUNDLE/macos/Ogmios.app/Contents"
  # The sidecar as it ships, under its final signature: one that cannot start
  # answers nothing, and the release stays a draft.
  codesign -dv "$CONTENTS/MacOS/ogmios-agent"
  echo '{"id":1,"method":"check","params":{}}' | "$CONTENTS/MacOS/ogmios-agent" | grep '"id":1'
  # Voice input as it ships: without the library the app offers no dictation,
  # and without the sentence macOS ends it at the microphone.
  lipo -archs "$CONTENTS/Frameworks/libparakeet.dylib" | grep -x arm64 >/dev/null
  nm -gU "$CONTENTS/Frameworks/libparakeet.dylib" | grep parakeet_capi_transcribe_pcm_lang >/dev/null
  plutil -extract NSMicrophoneUsageDescription raw "$CONTENTS/Info.plist"

  cp "$BUNDLE"/dmg/*.dmg "out/Ogmios_$ARCH.dmg"
  cp "$BUNDLE/macos/Ogmios.app.tar.gz" "out/Ogmios_$ARCH.app.tar.gz"
  cp "$BUNDLE/macos/Ogmios.app.tar.gz.sig" "out/Ogmios_$ARCH.app.tar.gz.sig"
else
  cp "$BUNDLE"/nsis/*-setup.exe "out/Ogmios_$ARCH-setup.exe"
  cp "$BUNDLE"/nsis/*-setup.exe.sig "out/Ogmios_$ARCH-setup.exe.sig"
fi
