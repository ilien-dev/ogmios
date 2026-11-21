import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The main window opens maximized the first time on every system, and after
 * that as the learner left it (`src-tauri/src/window.rs`). The window-state
 * plugin never un-maximizes a window, so the config must not open it
 * maximized, and an update, which ends the app without closing its window,
 * must save the state before it installs.
 */
const tauri = join(import.meta.dirname, "..", "src-tauri");

function text(...path: string[]): string {
  return readFileSync(join(tauri, ...path), "utf8");
}

test("the config opens the main window plain, and the app maximizes it once", () => {
  const config = JSON.parse(text("tauri.conf.json")) as {
    app: { windows: Array<{ label: string; maximized?: boolean }> };
  };
  const main = config.app.windows.find((window) => window.label === "main");
  expect(main).toBeDefined();
  expect(main?.maximized).toBeUndefined();
  const lib = text("src", "lib.rs");
  expect(lib).toContain(".plugin(window::plugin())");
  expect(lib).toContain("window::open(app)?;");
});

test("an update saves the window before it installs", () => {
  const update = text("src", "commands", "update.rs");
  const save = update.indexOf("crate::window::save(&app);");
  expect(save).toBeGreaterThan(-1);
  expect(save).toBeLessThan(update.indexOf("update.install(bytes)"));
});
