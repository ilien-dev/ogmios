import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cargoVersion, isNewer } from "./version";

const root = join(import.meta.dirname, "..");

describe("isNewer", () => {
  test.each([
    ["0.1.1", "0.1.0", true],
    ["0.2.0", "0.1.9", true],
    ["1.0.0", "0.99.99", true],
    ["0.10.0", "0.9.0", true],
    ["0.1.0", "0.1.0", false],
    ["0.1.0", "0.1.1", false],
  ])("%s after %s is %p", (next, previous, expected) => {
    expect(isNewer(next, previous)).toBe(expected);
  });

  test("rejects anything that is not major.minor.patch", () => {
    expect(() => isNewer("0.1", "0.1.0")).toThrow();
    expect(() => isNewer("0.1.0-beta", "0.1.0")).toThrow();
  });
});

describe("the app version", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };

  test("Cargo.toml says the same as package.json", () => {
    const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
    expect(cargoVersion(cargo)).toBe(pkg.version);
  });

  test("tauri.conf.json reads it from package.json", () => {
    const conf = JSON.parse(
      readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
    ) as { version: string };
    expect(conf.version).toBe("../package.json");
  });
});
