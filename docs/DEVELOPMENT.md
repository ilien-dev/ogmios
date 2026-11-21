# Developing Ogmios

**Español:** [DEVELOPMENT.es.md](DEVELOPMENT.es.md)

How to build, run and test Ogmios from source, and how its parts fit together.
To send a change, read [CONTRIBUTING.md](../CONTRIBUTING.md) first. The product
spec is [SPEC.md](SPEC.md) and how the error memory works is
[HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Requirements

[Bun](https://bun.sh) 1.3+, Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
platform (on Linux, also `libasound2-dev`).

## Commands

```bash
bun install
bun run hooks:install   # formatting check before each commit
bun run tauri:dev       # the desktop app
bun run dev             # the interface alone, on a fake backend
bun run check           # types, lint, format, tests (TypeScript and Rust)
```

The speech recogniser for Linux x86_64 is in `src-tauri/vendor/parakeet/`. For
another platform, run `scripts/build-parakeet.sh` (needs CMake, Ninja and a
C++ compiler).

## Architecture

| Folder       | What it holds                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/`       | The React interface. Only `src/lib/ipc.ts` talks to the backend.                                                                   |
| `src-tauri/` | The Rust backend: the SQLite database, audio and speech recognition, the keychain, and the error memory (`src-tauri/src/memory/`). |
| `sidecar/`   | A stateless process that talks to Claude, through the Anthropic API or the user's own Claude Code.                                 |
| `shared/`    | The types the interface, the backend and the sidecar exchange.                                                                     |

Rust owns all the data. The sidecar receives what it needs in every call and
keeps nothing. Claude labels mistakes; pattern states, priority, limits and the
review schedule are decided by tested code in `src-tauri/src/memory/`, never in
a prompt.

## The website

The website ([ogmios.ilien.dev](https://ogmios.ilien.dev)) is its own
repository, [ogmios-site](https://github.com/ilien-dev/ogmios-site), included
here as the `site/` submodule. Its windows play the real interface, so after a
change to the interface the demo is built again:

```bash
bun run site:install    # once: fetch the submodule and its packages
bun run site:demo       # rebuild the demo from this checkout
bun run site:dev        # the site, on http://localhost:4321
```

Commit inside `site/` and push it, then commit the new `site` pointer here.
