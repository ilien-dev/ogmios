/**
 * What `shared/protocol.ts` was when this sidecar was built, as one number.
 * Rust holds the same number of the file it was built from
 * (`agent/mod.rs`) and refuses a sidecar that answers `configure` with
 * another: a sidecar left over from an older build fails at once, not on the
 * first call it has never heard of.
 */
import { readFileSync } from "node:fs";

const OFFSET = 2_166_136_261;
const PRIME = 16_777_619;

/** 32-bit FNV-1a of the text's UTF-8 bytes, whatever its line endings. */
export function fingerprintOf(text: string): number {
  let hash = OFFSET;
  for (const byte of new TextEncoder().encode(text.replaceAll("\r", ""))) {
    hash = Math.imul(hash ^ byte, PRIME) >>> 0;
  }
  return hash;
}

/**
 * The fingerprint of the protocol. Imported as a macro where the sidecar
 * uses it, so the compiled binary carries the number, not the file.
 */
export function protocolFingerprint(): number {
  return fingerprintOf(
    readFileSync(new URL("../shared/protocol.ts", import.meta.url), "utf8"),
  );
}
