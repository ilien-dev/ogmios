import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * tauri_build refuses to compile, even for `tauri dev`, when a bundled resource
 * is missing. A platform whose speech library is not vendored yet must still
 * build (it just has no voice input), so a config may only name files that exist.
 */
const srcTauri = join(import.meta.dirname, "..", "src-tauri");

const configs = readdirSync(srcTauri).filter((name) =>
  /^tauri(?:\.\w+)?\.conf\.json$/.test(name),
);

function resourcesOf(config: string): string[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(srcTauri, config), "utf8"),
  );
  const resources =
    typeof parsed === "object" && parsed !== null && "bundle" in parsed
      ? (parsed.bundle as { resources?: unknown }).resources
      : undefined;
  if (Array.isArray(resources)) {
    return resources.map(String);
  }
  if (typeof resources === "object" && resources !== null) {
    return Object.keys(resources);
  }
  return [];
}

describe("tauri bundle resources", () => {
  test.each(configs)("%s names only files that exist", (config) => {
    const missing = resourcesOf(config).filter(
      (path) => !existsSync(join(srcTauri, path)),
    );

    expect(missing).toEqual([]);
  });
});
