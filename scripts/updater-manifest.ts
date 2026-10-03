/**
 * Writes the `latest.json` the in-app updater reads from the latest GitHub
 * release, once every platform has uploaded its signed bundle. Built here
 * rather than by each build job, so parallel jobs never overwrite each other.
 *
 *   bun scripts/updater-manifest.ts <version> <owner/repo> <dir with .sig files> <out>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The bundle each updater platform downloads, as the release workflow names it. */
export const ASSETS = {
  "darwin-aarch64": "Ogmios_aarch64.app.tar.gz",
  "windows-x86_64": "Ogmios_x64-setup.exe",
} as const;

interface Platform {
  url: string;
  signature: string;
}

interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<keyof typeof ASSETS, Platform>;
}

export function manifest(input: {
  version: string;
  repo: string;
  notes: string;
  date: string;
  signatures: Record<string, string>;
}): Manifest {
  const entries = Object.entries(ASSETS).map(([platform, file]) => {
    const signature = input.signatures[file];
    if (signature === undefined) {
      throw new Error(`No signature for ${file}`);
    }
    const url = `https://github.com/${input.repo}/releases/download/v${input.version}/${file}`;
    return [platform, { url, signature }];
  });
  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.date,
    platforms: Object.fromEntries(entries) as Manifest["platforms"],
  };
}

if (import.meta.main) {
  const [version, repo, dir, out] = Bun.argv.slice(2);
  if (
    version === undefined ||
    repo === undefined ||
    dir === undefined ||
    out === undefined
  ) {
    console.error(
      "usage: bun scripts/updater-manifest.ts <version> <owner/repo> <sig dir> <out>",
    );
    process.exit(2);
  }
  const signatures = Object.fromEntries(
    Object.values(ASSETS)
      .map((file) => [file, join(dir, `${file}.sig`)] as const)
      .filter(([, sig]) => existsSync(sig))
      .map(([file, sig]) => [file, readFileSync(sig, "utf8").trim()]),
  );
  const json = manifest({
    version,
    repo,
    notes: `Ogmios ${version}`,
    date: new Date().toISOString(),
    signatures,
  });
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
}
