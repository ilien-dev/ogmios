import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Voice input on macOS needs two things in the bundle, and 0.1.2 shipped with
 * neither: the speech library, which the bundler only copies when the macOS
 * config names it, and a sentence saying why the microphone is wanted, without
 * which macOS ends the app the moment it opens one.
 */
const srcTauri = join(import.meta.dirname, "..", "src-tauri");

function read(name: string): string {
  const path = join(srcTauri, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

test("the macOS bundle carries the speech library for Apple Silicon", () => {
  const config = JSON.parse(read("tauri.macos.conf.json") || "{}") as {
    bundle?: { macOS?: { frameworks?: string[] } };
  };

  expect(config.bundle?.macOS?.frameworks).toEqual([
    "vendor/parakeet/aarch64-apple-darwin/libparakeet.dylib",
  ]);
});

test("the macOS bundle says why it wants the microphone", () => {
  expect(read("Info.plist")).toMatch(
    /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/,
  );
});
