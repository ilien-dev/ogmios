/**
 * Compiles `sidecar/main.ts` into the single executable Tauri ships as an
 * `externalBin`: `src-tauri/binaries/ogmios-agent-<rust target triple>`.
 *
 *   bun run sidecar:build                     # for this machine
 *   bun run sidecar:build --target <triple>   # cross-compile
 *
 * Tauri looks the binary up by the Rust triple, and Bun names its targets
 * differently, hence the table.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUN_TARGETS: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-unknown-linux-musl": "bun-linux-x64-musl",
  "aarch64-unknown-linux-musl": "bun-linux-arm64-musl",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
};

const root = join(import.meta.dir, "..");

function hostTriple(): string {
  const rustc = Bun.spawnSync(["rustc", "-vV"]);
  if (!rustc.success) {
    throw new Error("`rustc -vV` failed; install Rust or pass --target.");
  }
  const host = /^host: (\S+)$/mu.exec(rustc.stdout.toString())?.[1];
  if (host === undefined) {
    throw new Error("`rustc -vV` printed no host line; pass --target.");
  }
  return host;
}

/** The `--target` argument, or null when building for this machine. */
function requestedTriple(): string | null {
  const index = Bun.argv.indexOf("--target");
  if (index === -1) {
    return null;
  }
  const triple = Bun.argv[index + 1];
  if (triple === undefined) {
    throw new Error("--target needs a Rust target triple.");
  }
  return triple;
}

/** Newest modification time among the files the binary is built from. */
function newestSource(): number {
  const files = [
    join(root, "bun.lock"),
    ...["sidecar", "shared"].flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map(
        (file) => join(root, dir, file),
      ),
    ),
  ];
  return Math.max(...files.map((file) => statSync(file).mtimeMs));
}

const requested = requestedTriple();
const triple = requested ?? hostTriple();
const bunTarget = BUN_TARGETS[triple];
if (bunTarget === undefined) {
  throw new Error(
    `No Bun target for ${triple}. Known: ${Object.keys(BUN_TARGETS).join(", ")}`,
  );
}

const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const extension = triple.includes("windows") ? ".exe" : "";
const outfile = join(outDir, `ogmios-agent-${triple}${extension}`);

if (existsSync(outfile) && statSync(outfile).mtimeMs > newestSource()) {
  console.log(`${outfile} is up to date`);
  process.exit(0);
}

// `--target` only when cross-compiling: naming even the host's own target
// makes Bun download a runtime for it, which turned a seconds-long build into
// minutes.
const targetArgs = requested === null ? [] : [`--target=${bunTarget}`];

// The agent SDK only embeds its own Claude Code binary when imported as a
// file asset; this sidecar always runs the user's `claude`, so none is added.
const build = Bun.spawnSync(
  [
    process.execPath,
    "build",
    "--compile",
    "--minify",
    ...targetArgs,
    join(root, "sidecar", "main.ts"),
    "--outfile",
    outfile,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (!build.success) {
  process.exit(build.exitCode);
}

const megabytes = statSync(outfile).size / 1024 / 1024;
console.log(`${outfile} (${megabytes.toFixed(1)} MB)`);
