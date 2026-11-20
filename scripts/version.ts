/**
 * The app version lives in `package.json` (Tauri reads it from there),
 * `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`. Nobody writes it:
 * release-please raises all three from the merged pull request titles
 * (`release-please-config.json`).
 *
 *   bun scripts/version.ts print                  # the current version
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The `version` of the `[package]` table. */
export function cargoVersion(toml: string): string | undefined {
  return /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/mu.exec(toml)?.[1];
}

/** The version `Cargo.lock` records for the `ogmios` package. */
export function lockVersion(lock: string): string | undefined {
  return /^name = "ogmios"\r?\nversion = "([^"]+)"/mu.exec(lock)?.[1];
}

if (import.meta.main) {
  const [command] = Bun.argv.slice(2);
  if (command !== "print") {
    console.error("usage: bun scripts/version.ts print");
    process.exit(2);
  }
  const root = join(import.meta.dir, "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  console.log(pkg.version);
}
