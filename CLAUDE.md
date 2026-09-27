# CLAUDE.md

## Commands

```bash
bun run check        # everything: types, oxlint, prettier, bun test, fmt, clippy, cargo test
bun test <file>      # one TS test file
bun run tauri:dev    # desktop app (builds the sidecar first)
bun run dev          # UI only, on src/lib/ipcMock.ts (?mock=fresh | ?mock=ready)
```

Cargo runs from `src-tauri/`. `cargo test -- --ignored commands::` runs the
whole learner loop against the sidecar's fake provider (`OGMIOS_FAKE=1`).
`OGMIOS_AGENT_CMD="bun sidecar/main.ts"` makes Rust spawn the sidecar from source.

## Architecture rules

- Rust owns all data (SQLite, audio, keyring). The sidecar is stateless: every
  call carries what it needs.
- The model labels; code decides. Pattern states, priority, limits and the
  review schedule live in `src-tauri/src/memory/`, never in a prompt.
- Only `src/lib/ipc.ts` calls `invoke`/`listen`; `ipcMock.ts` mirrors every
  command. `shared/domain.ts` ⇄ `domain.rs` and `shared/protocol.ts` ⇄
  `agent/protocol.rs` change together; Rust wins a disagreement.
- Never touch claude.ai credentials or build an OAuth flow. Claude Code mode
  runs the user's own unmodified `claude`; the API key lives only in the OS
  keyring.

## Product rules

- The partner never corrects during a conversation.
- A report shows 1 focus + at most 2 minor corrections; the rest stays in memory.
- "Mastered" is earned in spontaneous conversation, never by drills alone.
- Learner-facing explanations are in the learner's native language.
- Enjoyment first: when a screen feels heavy, collapse or cut, don't add.

## Code rules

- Tests first for logic; never finish with a failing or skipped test.
- Tailwind utilities only; tokens in `src/styles/global.css` `@theme`, never a
  hex or arbitrary value in a component. UI strings go through i18n (en + es).
- Never disable a lint rule, add a suppression or loosen `.oxlintrc.jsonc`,
  `Cargo.toml` lints or `clippy.toml`. Restructure the code instead.
- Lossy numeric casts live only in `src-tauri/src/convert.rs`; `unsafe` only in
  `src-tauri/src/stt/engine.rs`, each block with `// SAFETY:`.
- Licence is AGPL-3.0: every new dependency must be compatible.
- The product spec is `docs/SPEC.md`.

## This file

Capped at 1000 tokens (`scripts/claude-md.test.ts`, enforced by hooks). Only
what code cannot tell you. To change it, rewrite the whole file with Write:
place the new rule in its section, merge overlaps, drop what became obvious.
Appending or partial edits are blocked.
