import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cargoVersion, lockVersion } from "./version";

const root = join(import.meta.dirname, "..");
const read = (...path: string[]): string =>
  readFileSync(join(root, ...path), "utf8");

describe("the app version", () => {
  const pkg = JSON.parse(read("package.json")) as { version: string };

  test("Cargo.toml says the same as package.json", () => {
    expect(cargoVersion(read("src-tauri", "Cargo.toml"))).toBe(pkg.version);
  });

  test("Cargo.lock says the same as package.json", () => {
    expect(lockVersion(read("src-tauri", "Cargo.lock"))).toBe(pkg.version);
  });

  test("tauri.conf.json reads it from package.json", () => {
    const conf = JSON.parse(read("src-tauri", "tauri.conf.json")) as {
      version: string;
    };
    expect(conf.version).toBe("../package.json");
  });

  // release-please raises the version in each of these files and nowhere
  // else: one missing from the config would fall behind on the next release.
  test("release-please raises it in every file that carries it", () => {
    const config = JSON.parse(read("release-please-config.json")) as {
      packages: Record<string, { "extra-files": Array<{ path: string }> }>;
    };
    expect(
      config.packages["."]?.["extra-files"].map((file) => file.path),
    ).toEqual(["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
  });
});
