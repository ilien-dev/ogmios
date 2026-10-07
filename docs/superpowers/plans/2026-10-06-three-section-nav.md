# Three-Section Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight-item sidebar with Conversación, Libro and Estructuras plus Ajustes, each section opening a screen whose cards lead to today's screens.

**Architecture:** Frontend only. Route names stay; `books` gains `shelf` and `structures` gains `catalog` so the bare routes can be the new section screens. A shared `HubCard` renders every card; a shared `BackLink` takes the screens that left the sidebar back to their section. Libro's screen composes four existing read commands.

**Tech Stack:** React 19, TypeScript, Tailwind tokens, i18next (en + es), bun test with Testing Library and the mock backend (`useMockBackend`).

**Spec:** `docs/superpowers/specs/2026-10-06-three-section-nav-design.md`

## Global Constraints

- Tests first; never finish with a failing or skipped test. `bun run check` passes at the end.
- Tailwind utilities and `@theme` tokens only; no hex or arbitrary values.
- Every UI string goes through i18n, in `en.ts` and `es.ts`.
- Never disable a lint rule or add a suppression.
- Only `src/lib/ipc.ts` calls `invoke`; no Rust changes in this plan.
- No target screen changes inside: only how it is reached.
- Version: minor bump in `package.json` and `src-tauri/Cargo.toml` (0.5.1 → 0.6.0).
- No Claude session link in any commit or PR text.

## Review Focus

- A learner with no book: Libro shows what is missing and a way to the shelf, never a spinner that stays or a dead card.
- A current chapter whose book was deleted: Libro treats it as no current chapter.
- `homeState` failing: the sidebar shows no count and no error; the screens still work.
- A chapter opened from Libro › "Structures of this chapter": "back" returns to that chapter in Libro, as today.
- Several paused structure sessions: the card opens the catalogue, where each can be continued or ended.

---

### Task 1: Routes, sidebar and counts

**Files:**

- Modify: `src/app/routes.ts`, `src/app/Sidebar.tsx`, `src/app/App.tsx`, `src/lib/i18n/en.ts`, `src/lib/i18n/es.ts`
- Test: `src/app/Sidebar.test.tsx` (new); move the `Sidebar` block out of `src/features/books/BooksScreen.test.tsx`

**Interfaces:**

- Produces: `Route` `books` gains `shelf?: boolean`; `structures` gains `catalog?: boolean`.
- Produces: `export type Section = "conversation" | "book" | "structures" | "settings"`, `export function sectionOf(route: Route): Section`, and `Sidebar` prop `counts: Partial<Record<Section, number>>`.
- i18n `nav`: `label`, `conversation` (Conversation / Conversación), `book` (Book / Libro), `structures`, `settings`, `due` ("{{count}} due today" / "{{count}} pendientes hoy", the count's accessible label).

- [ ] Write `Sidebar.test.tsx`: four buttons named Conversation, Book, Structures, Settings and no others; `sectionOf` for one route of every name (`home`, `setup`, `practice`, `progress`, `report` → conversation; `books`, `recall`, `listening` → book; `structures`; `settings`); a count of 3 on `book` is shown and a count of 0 is not; clicking Book navigates to `{ name: "books", bookId: null }`.
- [ ] Run it; it fails.
- [ ] Implement. `App` loads `homeState()` in an effect keyed on `route` when `showsNav(route)`, keeps `{ conversation: dueReviews, book: dueWords }`, ignores a failure.
- [ ] `bun test src/app` passes; `bun run typecheck` passes.
- [ ] Commit.

### Task 2: `HubCard` and `BackLink`

**Files:**

- Create: `src/components/ui/HubCard.tsx`, `src/components/ui/BackLink.tsx`, `src/components/ui/HubCard.test.tsx`

**Interfaces:**

- Produces: `HubCard({ title: string; text: string; status?: ReactNode; due?: boolean; onClick: () => void })`: one `<button>` with the look of `Card`, a title as `<h2>`, the text, and the status under a rule; `due` gives the status the accent colour.
- Produces: `HubGrid({ children })`: the responsive grid the three screens share (`grid gap-4 sm:grid-cols-2`).
- Produces: `BackLink({ label: string; onClick: () => void })`: the ghost `Button` with `ArrowLeft` that `ChapterScreen` uses for "back".

- [ ] Test: the card is one button whose name starts with its title, shows its status, calls `onClick` once on click; without `status` no rule is rendered.
- [ ] Fail, implement, pass, commit.

### Task 3: Conversación (`Home.tsx`)

**Files:**

- Modify: `src/features/home/Home.tsx`, i18n
- Test: `src/features/home/Home.test.tsx` (new)

**Interfaces:**

- i18n `home.cards`: `drills.title` (2-minute drills / Ejercicios de 2 min), `drills.text`, `drills.due` (plural), `progress.title`, `progress.text`.

- [ ] Test with the mock backend: the Start button is still there; "2-minute drills" navigates to `{ name: "practice", patternId: null, format: null, autostart: false }`; "Progress" navigates to `{ name: "progress" }`; the old streak line and "due" line are gone while the streak text shows inside the Progress card.
- [ ] Fail, implement (cards between the hero and the quiet lines; remove the two replaced `HomeLine`s), pass, commit.

### Task 4: Libro (`BookHub.tsx`)

**Files:**

- Create: `src/features/books/BookHub.tsx`, `src/features/books/BookHub.test.tsx`
- Modify: `src/features/books/BooksScreen.tsx`, `src/features/books/BooksScreen.test.tsx`, `src/app/App.tsx`, `src/features/listening/ListeningMenu.tsx`, `src/features/listening/ListeningScreen.tsx`, `src/features/recall/RecallScreen.tsx`, i18n

**Interfaces:**

- Consumes: `HubCard`, `HubGrid`, `BackLink`; `structuresState`, `listBooks`, `recallState`, `listKnownWords`.
- Produces: `BookHub({ navigate: Navigate })`; `BooksScreen` prop `shelf: boolean`.
- `BooksScreen`: `bookId === null && !shelf && !known` renders `BookHub`; `showShelf` navigates to `{ name: "books", bookId: null, shelf: true }`; the shelf and the known-words screen get a `BackLink` to `{ name: "books", bookId: null }`.
- i18n `bookHub`: `title`, `change`, `vocabulary.{title,text,ready,readiness,unprepared}`, `translate.{title,text}`, `recall.{title,text,due}`, `listening.{title,text}`, `structures`, `known`, `open`, `empty`, `toShelf`; `nav.back` is not added: each `BackLink` is labelled with its section name from `nav`.

- [ ] Test `BookHub`: with a chapter opened (open one through the mock first) the four cards navigate to `{books, bookId, chapterId}`, the same with `translating: true`, `{recall}`, `{listening, chapterId}`; "Change" navigates to the shelf; with no chapter opened the chapter cards are absent, the empty text and a button to the shelf are shown, and Daily review is still there. A current chapter of a book no longer listed counts as none.
- [ ] Update `BooksScreen.test.tsx` to start from `shelf: true`; add: the bare route shows the hub; the shelf's back link returns to it.
- [ ] Fail, implement, pass.
- [ ] `ListeningMenu`: the no-book link goes to the shelf; `ListeningMenu` and the recall menu get a `BackLink` to Libro. Update their tests' expectations if they assert the old target.
- [ ] `bun test src/features/books src/features/listening src/features/recall` passes; commit.

### Task 5: Estructuras

**Files:**

- Create: `src/features/structures/StructuresHub.tsx`
- Modify: `src/features/structures/StructuresScreen.tsx`, `src/features/structures/StructureMenu.tsx`, `src/features/structures/StructuresScreen.test.tsx`, `src/app/App.tsx`, i18n

**Interfaces:**

- Produces: `StructuresHub({ navigate })`; `StructuresScreen` prop `catalog: boolean`.
- Cards: free session → `{ name: "structures", catalog: true }`; of the chapter → `{ name: "structures", chapterId }` (only with `state.chapter`); paused (only with `state.paused.length > 0`) → `{ running: id }` with one, `{ catalog: true }` with several.
- `StructureMenu` gets a `BackLink` to `{ name: "structures" }`. A run started from the catalogue still leaves to `{ name: "structures" }`.
- i18n `structures.hub`: `free.{title,text,status}`, `chapter.{title,text}`, `paused.{title,text,status}`.

- [ ] Tests: the bare route shows the hub with "Free session"; it opens the catalogue (the existing menu tests start from `catalog: true`); with no chapter there is no chapter card; with one paused session the card continues it; with two it opens the catalogue.
- [ ] Fail, implement, pass, commit.

### Task 6: Practice and Progress

**Files:**

- Modify: `src/features/drills/Practice.tsx`, `src/features/progress/ProgressScreen.tsx`, i18n, their tests

- [ ] Test: Progress shows a back link that navigates to `{ name: "home" }`; the practice menu is titled "2-minute drills" and has the same back link.
- [ ] Fail, implement (`drills.title` → "2-minute drills" / "Ejercicios de 2 min"), pass, commit.

### Task 7: Product spec, version, full check

**Files:**

- Modify: `docs/SPEC.md` (§6.1, §9.4, §9.7, §9.8, §17), `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src/lib/ipcMock.ts` only if a mirrored command changed (none expected)

- [ ] Rewrite the five passages as the design spec lists them.
- [ ] Bump 0.5.1 → 0.6.0 in both manifests; `cargo check` refreshes the lock.
- [ ] `bun run check` passes in full.
- [ ] Commit.
