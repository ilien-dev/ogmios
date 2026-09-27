# Where these rules came from

Every file in this directory except this one is vendored from Dillon Mulroy's
**anti-slop**, an oxlint plugin of rules that reject patterns a language model
reaches for when it is guessing rather than reading: a chained cast, a
`Record<string, unknown>`, a `typeof` check standing in for parsing a boundary.

|                 |                                                    |
| --------------- | -------------------------------------------------- |
| **Author**      | Dillon Mulroy — <https://github.com/dmmulroy/anti-slop> |
| **Licence**     | MIT                                                |
| **Attribution** | Required — the notice below is that attribution    |
| **Fetched**     | 2026-08-21, at `6d53855` (2026-08-18)              |

`MIT` is on the allow list in `scripts/check-licenses.ts`. That script reads npm
manifests and covers no vendored file, which is why this page exists: a licence
nobody can point at is a licence nobody has checked. The same reasoning, and the
same shape, as `src/features/maps/symbols/LICENCE.md`.

## Why it is vendored rather than depended on

The upstream project says to: it is published to be copied, read and changed,
and it is not on npm as a runtime package. Vendoring is also what makes the
rules readable — a rule that forbids a cast is one somebody will eventually
argue with, and the argument goes better when the rule is fifty lines away
rather than inside `node_modules`.

## What was changed

Two things were left out, and nothing was edited.

- **`effect/`** — one rule about the Effect library, which this project does not
  use. Upstream keeps it in a separate plugin for exactly that reason.
- **`*.test.ts`** — the rules' own tests run under `tsx` and `node:test`. `bun
test` claims every `*.test.ts` in the repository, so keeping them would have put
  nineteen files this project does not maintain into `bun run check`.

`shared/` and `rules/` are otherwise byte-for-byte upstream. Re-fetch by copying
`src/` over this directory again and deleting those two.

## Notice

```
MIT License

Copyright (c) 2026 Dillon Mulroy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
