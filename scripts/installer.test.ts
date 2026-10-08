import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Windows installer is Tauri's NSIS installer with Ogmios's own pages:
 * `windows/installer.nsi` is a copy of the bundler's template in which only
 * the list of pages changes, and `windows/ui.nsh` draws them. The in-app
 * updater runs that same installer with `/P /R /UPDATE`, so a copy that lost
 * those flags, or fell behind the bundler it is built with, would break the
 * updates of every installed app without a single failing build.
 */
const root = join(import.meta.dirname, "..");
const tauri = join(root, "src-tauri");

function text(...path: string[]): string {
  return readFileSync(join(tauri, ...path), "utf8");
}

function json(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(...path), "utf8"));
}

function keys(source: string): string[] {
  return [...source.matchAll(/^\s*LangString (\w+) /gm)]
    .map((match) => match[1] ?? "")
    .sort();
}

function used(source: string): string[] {
  return [...source.matchAll(/\$\((\w+)\)/g)].map((match) => match[1] ?? "");
}

const nsis = {
  template: "windows/installer.nsi",
  installerHooks: "windows/ui.nsh",
  installerIcon: "icons/icon.ico",
  uninstallerIcon: "icons/icon.ico",
  languages: ["English", "Spanish"],
  customLanguageFiles: {
    English: "windows/lang/English.nsh",
    Spanish: "windows/lang/Spanish.nsh",
  },
};

const dmg = {
  background: "macos/dmg-background.png",
  windowSize: { width: 660, height: 400 },
  appPosition: { x: 180, y: 190 },
  applicationFolderPosition: { x: 480, y: 190 },
};

test("the Windows installer uses Ogmios's template, pages, languages and icon", () => {
  expect(json(tauri, "tauri.windows.conf.json")).toMatchObject({
    bundle: { windows: { nsis } },
  });
  const files = [
    nsis.template,
    nsis.installerHooks,
    nsis.installerIcon,
    ...Object.values(nsis.customLanguageFiles),
    ...[100, 125, 150, 175, 200].map((scale) => `windows/logo-${scale}.bmp`),
  ];
  expect(files.filter((file) => !existsSync(join(tauri, file)))).toEqual([]);
});

test("the template keeps what the updater and the hooks need", () => {
  const template = text(nsis.template);
  const kept = [
    '"/P"',
    '"/R"',
    '"/NS"',
    '"/UPDATE"',
    "Function SkipIfPassive",
    "Section EarlyChecks",
    "Section WebView2",
    "Section Install",
    "Section Uninstall",
    "NSIS_HOOK_PREINSTALL",
    "NSIS_HOOK_POSTINSTALL",
    "NSIS_HOOK_PREUNINSTALL",
    "NSIS_HOOK_POSTUNINSTALL",
  ];
  expect(kept.filter((piece) => !template.includes(piece))).toEqual([]);
});

test("the template does not show the stock wizard pages", () => {
  const template = text(nsis.template);
  const stock = [
    "MUI_PAGE_WELCOME",
    "MUI_PAGE_DIRECTORY",
    "MUI_PAGE_FINISH",
    "MUI_UNPAGE_CONFIRM",
  ];
  expect(stock.filter((page) => template.includes(page))).toEqual([]);
});

test("the template was forked from the installed Tauri CLI", () => {
  const forked = /^; Forked from tauri-cli v(\S+)/.exec(text(nsis.template));
  expect(
    json(root, "node_modules", "@tauri-apps", "cli", "package.json"),
  ).toMatchObject({
    version: forked?.[1] ?? "no version in the first line",
  });
});

test("both languages define the same strings, and every one the pages use", () => {
  const english = keys(text(nsis.customLanguageFiles.English));
  const spanish = keys(text(nsis.customLanguageFiles.Spanish));
  expect(spanish).toEqual(english);
  const wanted = [
    ...used(text(nsis.installerHooks)),
    ...used(text(nsis.template)),
  ].filter((key) => !key.startsWith("^"));
  expect(wanted.filter((key) => !english.includes(key))).toEqual([]);
  expect(wanted.some((key) => key.startsWith("og"))).toBe(true);
});

// Tauri copies a language file with a byte order mark of its own in front: one
// already there ends up inside the first line, and makensis stops on it.
test("the strings carry no byte order mark, and the pages need no encoding at all", () => {
  for (const file of Object.values(nsis.customLanguageFiles)) {
    const strings = readFileSync(join(tauri, file));
    expect([...strings.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  }
  const pages = readFileSync(join(tauri, nsis.installerHooks));
  expect(pages.findIndex((byte) => byte > 0x7f)).toBe(-1);
});

test("the macOS disk image is laid out on Ogmios's background", () => {
  expect(json(tauri, "tauri.macos.conf.json")).toMatchObject({
    bundle: { macOS: { dmg } },
  });
  const image = readFileSync(join(tauri, dmg.background));
  expect(image.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect({
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  }).toEqual(dmg.windowSize);
});
