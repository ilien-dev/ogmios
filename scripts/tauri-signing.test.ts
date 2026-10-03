import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tauri signs the sidecar with the same options as the app. `ogmios-agent` is
 * a Bun executable, and under the hardened runtime macOS denies its JIT the
 * memory it needs unless an entitlement allows it: the agent died on launch
 * in 0.1.0. The release is ad-hoc signed and not notarised, so it simply does
 * without the hardened runtime.
 */
const release: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "src-tauri", "tauri.release.conf.json"),
    "utf8",
  ),
);

test("the macOS release leaves the sidecar its JIT", () => {
  expect(release).toMatchObject({
    bundle: { macOS: { hardenedRuntime: false } },
  });
});
