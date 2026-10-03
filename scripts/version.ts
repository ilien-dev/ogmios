/**
 * The app version, kept in `package.json` (Tauri reads it from there) and
 * `src-tauri/Cargo.toml`. Every merge to main publishes a release, so every
 * pull request moves it forward:
 *
 *   bun scripts/version.ts check <base version>   # CI: fails unless bumped
 *   bun scripts/version.ts print                  # the current version
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u;

function parts(version: string): [number, number, number] {
  const match = SEMVER.exec(version);
  if (match === null) {
    throw new Error(`${version} is not major.minor.patch`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `next` comes strictly after `previous`. */
export function isNewer(next: string, previous: string): boolean {
  const a = parts(next);
  const b = parts(previous);
  for (const i of [0, 1, 2] as const) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

/** The `version` of the `[package]` table. */
export function cargoVersion(toml: string): string | undefined {
  return /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/mu.exec(toml)?.[1];
}

function current(): string {
  const root = join(import.meta.dir, "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

if (import.meta.main) {
  const [command, base] = Bun.argv.slice(2);
  const version = current();
  if (command === "print") {
    console.log(version);
  } else if (command === "check" && base !== undefined) {
    if (!isNewer(version, base)) {
      console.error(
        `Version ${version} is not after ${base}. Bump it in package.json and src-tauri/Cargo.toml.`,
      );
      process.exit(1);
    }
    console.log(`${base} → ${version}`);
  } else {
    console.error("usage: bun scripts/version.ts print | check <base>");
    process.exit(2);
  }
}
