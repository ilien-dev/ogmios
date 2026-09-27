# Ogmios

Practise English by talking with Claude. You pick a topic and a level, speak or
type freely, and nobody corrects you mid-sentence. When you finish, you get one
thing to focus on, two smaller notes, and better ways to say what you said.
Ogmios remembers your recurring mistakes across conversations and steers the
next ones toward them until they are gone.

- **Feedback at the end, and only what matters.** One focus, two minor points.
  The rest waits in memory.
- **You fix it first.** For grammar, you see your own sentence and try to
  correct it before the answer appears.
- **Memory of your mistakes.** Each one moves through detected → in focus →
  improving → mastered. It counts as mastered only when you get it right in
  real conversations, not just in drills.
- **Short drills when you want them.** Two minutes, mixing the structure you
  are working on with the others.
- **Voice or text.** Speech recognition runs on your machine. You can edit the
  transcript before sending.
- **Local and private.** Conversations, audio and progress stay in a SQLite
  file on your computer.

## Connecting to Claude

Ogmios needs one of these:

1. **An Anthropic API key** (recommended). It is stored in your system's
   keychain.
2. **Your local Claude Code.** Ogmios runs the `claude` you installed and
   logged into yourself. It never sees your credentials. Anthropic may limit
   subscription use in third-party apps, so this mode can stop working at any
   time.

A 20-minute conversation costs roughly $0.20 with Sonnet 5 on the API. That is
an estimate, not a measurement.

## Development

Requirements: [Bun](https://bun.sh) 1.3+, Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
platform (on Linux, also `libasound2-dev`).

```bash
bun install
bun run hooks:install   # formatting check before each commit
bun run tauri:dev       # the desktop app
bun run dev             # the interface alone, on a fake backend
bun run check           # types, lint, format, tests (TypeScript and Rust)
```

The speech recogniser for Linux x86_64 is in
`src-tauri/vendor/parakeet/`. For another platform, run
`scripts/build-parakeet.sh` (needs CMake, Ninja and a C++ compiler).

Layout: `src/` is the React interface, `src-tauri/` the Rust backend (data,
error memory, speech), `sidecar/` the process that talks to Claude, `shared/`
the types they exchange. The product spec is in `docs/SPEC.md`.

## Licence

AGPL-3.0-only. See `LICENSE`. The speech recogniser (parakeet.cpp, ggml) is
MIT; the Parakeet models are CC-BY-4.0 by NVIDIA.
