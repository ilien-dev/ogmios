import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * tauri_build refuses to compile, even for `tauri dev`, when a bundled resource
 * is missing. A platform whose speech library is not vendored yet must still
 * build (it just has no voice input), so a config may only name files that exist.
 * On macOS the library is bundled as a framework, which is held to the same.
 */
const srcTauri = join(import.meta.dirname, "..", "src-tauri");

const configs = readdirSync(srcTauri).filter((name) =>
  /^tauri(?:\.\w+)?\.conf\.json$/.test(name),
);

interface Bundle {
  resources?: unknown;
  macOS?: { frameworks?: unknown };
}

function bundleOf(config: string): Bundle {
  const parsed: unknown = JSON.parse(
    readFileSync(join(srcTauri, config), "utf8"),
  );
  return typeof parsed === "object" && parsed !== null && "bundle" in parsed
    ? (parsed.bundle as Bundle)
    : {};
}

function resourcesOf(config: string): string[] {
  const { resources } = bundleOf(config);
  if (Array.isArray(resources)) {
    return resources.map(String);
  }
  if (typeof resources === "object" && resources !== null) {
    return Object.keys(resources);
  }
  return [];
}

/** Frameworks given as a path; a bare name is one macOS already has. */
function frameworkFilesOf(config: string): string[] {
  const frameworks = bundleOf(config).macOS?.frameworks;
  return Array.isArray(frameworks)
    ? frameworks.map(String).filter((name) => name.includes("/"))
    : [];
}

describe("tauri bundle resources", () => {
  test.each(configs)("%s names only files that exist", (config) => {
    const missing = [
      ...resourcesOf(config),
      ...frameworkFilesOf(config),
    ].filter((path) => !existsSync(join(srcTauri, path)));

    expect(missing).toEqual([]);
  });
});
