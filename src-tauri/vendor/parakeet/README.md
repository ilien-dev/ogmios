# parakeet.cpp, built once and kept

The speech recogniser. One shared library per platform, built from
[mudler/parakeet.cpp](https://github.com/mudler/parakeet.cpp) and kept here,
opened at run time by `src-tauri/src/stt/engine.rs` through its flat C ABI.

## Why a prebuilt binary

Upstream publishes command-line tools, not a shared library. Building
parakeet.cpp as part of this crate would make CMake, Ninja and a C++ toolchain
requirements for anyone who compiles Ogmios, to produce a file that changes
about as often as a dependency bump. A few megabytes in the repository is the
cheaper side of that trade.

`build.rs` copies the library for the target triple being built beside the
binary cargo produces (and into `deps/`, for tests); `tauri.<os>.conf.json`
bundles it. On macOS that is `bundle.macOS.frameworks`, which puts it in
`Contents/Frameworks`, not `resources`: `engine::library_beside` looks beside
the binary and in the bundle's `Frameworks`, never in `Resources`. Add that file together with the library, never before: Tauri
refuses to build, even in dev, when a bundled resource is missing
(`scripts/tauri-resources.test.ts` checks it). Voice input is offered where the library exists and nowhere else:
`engine::library_beside` answers `None`, and `stt_status` reports
`available: false`.

## What is here

| Platform                   | File             | Built from                                 |
| -------------------------- | ---------------- | ------------------------------------------ |
| `x86_64-unknown-linux-gnu` | `libparakeet.so` | `e270af73b94c9a5c37ec516230219ed4580e1db6` |
| `x86_64-pc-windows-msvc`   | `parakeet.dll`   | `e270af73b94c9a5c37ec516230219ed4580e1db6` |

| `aarch64-apple-darwin` | `libparakeet.dylib` | `e270af73b94c9a5c37ec516230219ed4580e1db6` |

macOS ships for Apple Silicon only, so there is no `x86_64-apple-darwin`.

ggml is linked statically inside the library, so there is one file per
platform rather than four (`BUILD_SHARED_LIBS=ON` would add `ggml`,
`ggml-base` and `ggml-cpu` beside it, which is four things to place and four
ways to ship a mismatched set).

## How to build it again

Needs CMake, Ninja and a C++ toolchain on the machine doing the building.

```sh
git clone --recursive https://github.com/mudler/parakeet.cpp
cd parakeet.cpp
git checkout e270af73b94c9a5c37ec516230219ed4580e1db6
git submodule update --init --recursive

cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DPARAKEET_SHARED=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DPARAKEET_BUILD_CLI=OFF \
  -DPARAKEET_BUILD_TESTS=OFF \
  -DPARAKEET_BUILD_SERVER=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
cmake --build build
```

Then copy the library into `vendor/parakeet/<target-triple>/`.

- `GGML_NATIVE=OFF` is not optional. It stops the build baking in the
  instruction set of the machine that made it, which is how a library built on
  a fast desktop crashes on an older laptop with an illegal instruction.
- `CMAKE_POSITION_INDEPENDENT_CODE=ON` is needed on Linux: ggml is built as
  static archives and then linked into a shared object, which requires `-fPIC`.
- `CMAKE_OSX_DEPLOYMENT_TARGET=11.0` matches `minimumSystemVersion` in
  `tauri.conf.json`. Without it the library targets the macOS of the machine
  that built it and will not load on an older one. Ignored off macOS.
- On Windows, also pass `-DCMAKE_WINDOWS_EXPORT_ALL_SYMBOLS=ON`. Upstream
  marks nothing `__declspec(dllexport)`, so without it the DLL loads but
  exports no `parakeet_capi_*` symbol and the first press fails.
- On Windows, build from a Developer Command Prompt (or after `vcvars64.bat`),
  make sure the first `ninja` on the path is a real one (Strawberry Perl ships a
  broken one), and build near the root of a drive: Ninja fails on long paths.

## Checking one before committing it

Load it and transcribe something. The ignored end-to-end test does exactly
that through the same code the app uses:

```sh
# a folder with a few 16 kHz mono WAV clips; the model is downloaded into it
STT_E2E_DIR=/path/to/clips cargo test stt::tests::e2e_needs_network_and_clips -- --ignored --nocapture
```

`Engine::open` checks the ABI version (at least 3, for the `_lang` entry
points) and resolves every symbol at load, so a mismatched library fails with a
sentence on the first press rather than crashing later.

## Licence

parakeet.cpp is MIT, and so is the ggml inside it. The licence text has to
travel with the application. The model weights it loads (NVIDIA Parakeet) are
CC-BY-4.0 and are downloaded at run time, not shipped.
