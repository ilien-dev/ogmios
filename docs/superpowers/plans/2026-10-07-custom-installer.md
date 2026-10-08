# Custom Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Windows installer, its passive update window and its uninstaller, and the macOS disk image, all look like Ogmios; the release artifacts and the updater stay as they are.

**Architecture:** `src-tauri/windows/installer.nsi` is a fork of the `tauri-bundler` NSIS template of tauri-cli 2.11.5 in which only the page list changes. Everything Ogmios draws lives in `src-tauri/windows/ui.nsh`, included through `installerHooks` and inserted into the fork as macros, so the fork's diff against upstream stays a handful of lines. macOS is configuration plus one image.

**Tech Stack:** NSIS 3.11 (MUI2, nsDialogs, System), Tauri 2 bundler config, bun test, PowerShell + System.Drawing for the two images.

**Spec:** `docs/superpowers/specs/2026-10-07-custom-installer-design.md`

## Global Constraints

- No new NSIS plugin and no new dependency.
- Sections `EarlyChecks`, `WebView2`, `Install`, `Uninstall`, `.onInit`, `un.onInit`, `.onInstSuccess`, the four hooks and the `/P`, `/R`, `/NS`, `/UPDATE` handling stay byte-identical to upstream.
- Installer text in English and Spanish, one file per language, same keys in both.
- `ui.nsh` is ASCII; `Spanish.nsh` is UTF-8 with BOM.
- Version 0.7.0 → 0.8.0 in `package.json` and `src-tauri/Cargo.toml`.
- Nothing is installed over the user's own Ogmios: real-installer runs use `productName` "Ogmios Test" and identifier `dev.ilien.ogmios.test`.

## Review Focus

- Passive update (`/P /R /UPDATE`): only the progress page shows, closes by itself, relaunches the app.
- Silent install (`/S`): no page function runs; the desktop shortcut is still created by the section.
- Install fails mid-way: the progress page says so and offers the details, the window can be closed.
- High DPI (150 %): the page fills the window and nothing of the wizard frame shows.
- Enter and the window's close button: Enter does the primary action, close on the last page does not launch the app.

---

### Task 1: Config tests

**Files:**

- Create: `scripts/installer.test.ts`

- [ ] **Step 1: Write the failing tests** (`bun:test`, `readFileSync` like `scripts/tauri-signing.test.ts`)
  - `the Windows installer uses Ogmios's template, pages, languages and icon`: `tauri.windows.conf.json` `bundle.windows.nsis` equals `{ template: "windows/installer.nsi", installerHooks: "windows/ui.nsh", installerIcon: "icons/icon.ico", uninstallerIcon: "icons/icon.ico", languages: ["English", "Spanish"], customLanguageFiles: { English: "windows/lang/English.nsh", Spanish: "windows/lang/Spanish.nsh" } }` and every path exists under `src-tauri/`, plus `windows/logo.bmp`.
  - `the template keeps what the updater and the hooks need`: `installer.nsi` contains `"/P"`, `"/R"`, `"/NS"`, `"/UPDATE"`, `Function SkipIfPassive`, `Section EarlyChecks`, `Section WebView2`, `Section Install`, `Section Uninstall`, and the four `NSIS_HOOK_*` names.
  - `the template does not show the stock wizard pages`: no `MUI_PAGE_WELCOME`, `MUI_PAGE_DIRECTORY`, `MUI_PAGE_FINISH`, `MUI_UNPAGE_CONFIRM`.
  - `the template was forked from the installed Tauri CLI`: first line matches `; Forked from tauri-cli v<x>` and `<x>` equals `node_modules/@tauri-apps/cli/package.json` `version`.
  - `both languages define the same strings`: the sets of `LangString <key>` in the two files are equal and include every `$(og…)` used in `ui.nsh` and every `$(…)` used in `installer.nsi`.
  - `Spanish is read as UTF-8`: `Spanish.nsh` starts with bytes `EF BB BF`; `ui.nsh` has no byte above 0x7F.
  - `the macOS disk image is laid out on Ogmios's background`: `tauri.macos.conf.json` `bundle.macOS.dmg` equals `{ background: "macos/dmg-background.png", windowSize: { width: 660, height: 400 }, appPosition: { x: 180, y: 190 }, applicationFolderPosition: { x: 480, y: 190 } }`, the file exists and its PNG header says 660 × 400.
- [ ] **Step 2:** `bun test scripts/installer.test.ts` → all fail.

### Task 2: Images

**Files:**

- Create: `scripts/installer-assets.ps1`, `src-tauri/windows/logo.bmp`, `src-tauri/macos/dmg-background.png`

- [ ] **Step 1:** `installer-assets.ps1` (System.Drawing) writes `logo.bmp`: `icons/icon.png` at 256 × 256, 24-bit, over the icon's own dark colour; and `dmg-background.png`: 660 × 400, flat mid graphite, a gold arrow from x 270 to 390 at y 190. It prints the icon's dark and gold colours as hex.
- [ ] **Step 2:** Run it; look at both images.

### Task 3: Pages on a harness

**Files:**

- Create: `src-tauri/windows/ui.nsh`, `src-tauri/windows/lang/English.nsh`, `src-tauri/windows/lang/Spanish.nsh`
- Scratch (not committed): `harness.nsi` with a fake payload, product "Ogmios Harness", including `ui.nsh`

**Interfaces — `ui.nsh` produces these macros, inserted by `installer.nsi`:**

- `OG_DEFINES` — before the pages: colours, `MUI_CUSTOMFUNCTION_GUIINIT ogGuiInit`, `MUI_CUSTOMFUNCTION_UNGUIINIT un.ogGuiInit`.
- `OG_PAGE_START` — `Page custom ogStart ogStartLeave`; sets `$INSTDIR` and `$OgDesktop`.
- `OG_PAGE_INSTFILES` / `OG_UNPAGE_INSTFILES` — `MUI_(UN)PAGE_INSTFILES` with Ogmios's `SHOW` and `LEAVE`.
- `OG_PAGE_DONE` — `Page custom ogDone ogDoneLeave`; calls `CreateOrUpdateDesktopShortcut` when `$OgDesktop` = 1 and `RunMainBinary` on the primary action.
- `OG_UNPAGE_CONFIRM` — `UninstPage custom un.ogConfirm un.ogConfirmLeave`; sets `$DeleteAppDataCheckboxState`.
- Consumes from the template: `$PassiveMode`, `SkipIfPassive`, `un.SkipIfPassive`, `RunMainBinary`, `CreateOrUpdateDesktopShortcut`, `${PRODUCTNAME}`, `${VERSION}`, `${UNINSTKEY}`.

Strings (both languages): `ogTagline`, `ogInstall`, `ogUpdate`, `ogReinstall`, `ogOptions`, `ogFolder`, `ogBrowse`, `ogDesktop`, `ogInstalling`, `ogWait`, `ogFailed`, `ogDetails`, `ogDone`, `ogDoneLong`, `ogOpen`, `ogUninstallTitle`, `ogUninstall`, `ogUninstalling`, plus Tauri's own.

- [ ] **Step 1 (the spec's prototype gate):** `ogGuiInit` — dark title bar, window background, every frame control out of sight, the page area stretched over the whole client area — and three empty dark pages on the harness. Compile with `%LOCALAPPDATA%\tauri\NSIS\makensis.exe`, run, screenshot. If the frame cannot be hidden cleanly, stop and report.
- [ ] **Step 2:** Start page: logo, name, tagline, gold button with real text and rounded corners, "Options" link revealing folder + Browse + desktop checkbox. Button label by installed version: none → `ogInstall`, older → `ogUpdate`, same or newer → `ogReinstall`.
- [ ] **Step 3:** Progress page: logo, title, gold bar, no log; auto-advance on success; on abort show `ogFailed` and the `ogDetails` link that reveals the log.
- [ ] **Step 4:** Done page and uninstaller pages.
- [ ] **Step 5:** Screenshot every page in English and Spanish and at 150 % scaling; check the five Review Focus lines on the harness (`/P`, `/S`, a forced `Abort`, Enter, close).

### Task 4: The fork

**Files:**

- Create: `src-tauri/windows/installer.nsi`
- Modify: `src-tauri/tauri.windows.conf.json`

- [ ] **Step 1:** Copy upstream 2.11.5; first line `; Forked from tauri-cli v2.11.5`. Replace the page list with the `OG_*` macros; in `PageReinstall`, replace the radio-button dialog by: passive or WiX → `Call PageLeaveReinstall`, otherwise nothing. Drop `MUI_FINISHPAGE_*` and `un.ConfirmShow`/`un.ConfirmLeave`. Keep a diff against upstream small enough to read in one screen.
- [ ] **Step 2:** Config as Task 1 asserts.
- [ ] **Step 3:** `bun test scripts/installer.test.ts` → Windows tests pass.
- [ ] **Step 4:** `bun run sidecar:build && bun tauri build --bundles nsis --config <Ogmios Test override>`; run the real installer: clean install, other folder without shortcut, reinstall, `/P /R /UPDATE`, uninstall with and without data. Screenshots.
- [ ] **Step 5:** Commit.

### Task 5: macOS, version, check

**Files:**

- Modify: `src-tauri/tauri.macos.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`

- [ ] **Step 1:** `bundle.macOS.dmg` as Task 1 asserts; the macOS test passes.
- [ ] **Step 2:** 0.8.0 in both manifests.
- [ ] **Step 3:** `bun run check` → green.
- [ ] **Step 4:** Commit. The disk image itself can only be seen on a Mac: say so in the hand-off.
