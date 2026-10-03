import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `tauri build` refuses to start when a Tauri package and its crate are on
 * different minor releases. 0.2.0 never published over it: the dialog plugin
 * was 2.8 in `bun.lock` and 2.7 in `Cargo.lock`, and nothing before the
 * release runs `tauri build`.
 */
const root = join(import.meta.dirname, "..");
const bunLock = readFileSync(join(root, "bun.lock"), "utf8");
const cargoLock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");

/** "2.7" of "2.7.3". */
function minor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

function crateVersion(name: string): string | null {
  const found = new RegExp(
    `name = "${name}"\\r?\\nversion = "([^"]+)"`,
    "u",
  ).exec(cargoLock);
  return found?.[1] ?? null;
}

/** Each Tauri package the interface installs, with the crate behind it. */
const pairs = [
  ...bunLock.matchAll(/"(@tauri-apps\/(api|plugin-[\w-]+))@(\d[^"]*)"/gu),
].map(([, name = "", short = "", version = ""]) => ({
  name,
  version,
  crate: short === "api" ? "tauri" : `tauri-${short}`,
}));

test("the lockfiles name the Tauri packages the app uses", () => {
  expect(pairs.map((pair) => pair.name)).toContain("@tauri-apps/api");
  expect(pairs.map((pair) => pair.name)).toContain("@tauri-apps/plugin-dialog");
});

test("each Tauri package is on the same minor release as its crate", () => {
  for (const { name, version, crate } of pairs) {
    const built = crateVersion(crate);
    expect({
      name,
      crate,
      minor: built === null ? null : minor(built),
    }).toEqual({ name, crate, minor: minor(version) });
  }
});
