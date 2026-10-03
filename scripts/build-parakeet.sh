#!/usr/bin/env bash
# Build the speech recogniser for the host platform into
# src-tauri/vendor/parakeet/<rust host triple>/. Needs CMake, Ninja and a C++
# toolchain on the building machine only. See src-tauri/vendor/parakeet/README.md.
set -euo pipefail

REV=e270af73b94c9a5c37ec516230219ed4580e1db6
root=$(cd "$(dirname "$0")/.." && pwd)
triple=$(rustc -vV | sed -n 's/^host: //p')
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone --quiet https://github.com/mudler/parakeet.cpp "$work/parakeet.cpp"
cd "$work/parakeet.cpp"
git checkout --quiet "$REV"
git submodule update --init --recursive --quiet
# GGML_NATIVE=OFF: never bake the build machine's instruction set into a
# library that runs on someone else's laptop. The macOS floor is the app's own
# (tauri.conf.json minimumSystemVersion), not the build machine's.
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release   -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
  -DPARAKEET_SHARED=ON -DBUILD_SHARED_LIBS=OFF \
  -DPARAKEET_BUILD_CLI=OFF -DPARAKEET_BUILD_TESTS=OFF -DPARAKEET_BUILD_SERVER=OFF \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON
cmake --build build

out="$root/src-tauri/vendor/parakeet/$triple"
mkdir -p "$out"
find build -maxdepth 2 \( -name 'libparakeet.so' -o -name 'libparakeet.dylib' -o -name 'parakeet.dll' \) \
  -exec cp {} "$out/" \;
ls -la "$out"
