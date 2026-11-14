import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tauri sends commands over its `ipc:` protocol (`http://ipc.localhost` on
 * Windows). When the CSP blocks it, Tauri falls back to postMessage, which
 * turns a command's raw bytes into an array of numbers: the covers kept for
 * each book arrive unreadable and every book shows its opening instead.
 */
const config: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "src-tauri", "tauri.conf.json"),
    "utf8",
  ),
);

function csp(): string {
  const value = (config as { app?: { security?: { csp?: unknown } } }).app
    ?.security?.csp;
  return typeof value === "string" ? value : "";
}

function sources(directive: string): string[] {
  const found = csp()
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return found?.slice(1) ?? [];
}

describe("the content security policy", () => {
  test("lets commands use Tauri's IPC protocol on every platform", () => {
    expect(sources("connect-src")).toEqual(
      expect.arrayContaining(["'self'", "ipc:", "http://ipc.localhost"]),
    );
  });
});
