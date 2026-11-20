import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS } from "./updater-manifest";

/**
 * macOS ships for Apple Silicon only. An Intel build was dropped after 0.1.1
 * failed to publish over it: the release runs each bundled sidecar, and the
 * x64 one died under Rosetta on the Apple Silicon runner.
 */
interface Build {
  run: string;
}

const workflow = Bun.YAML.parse(
  readFileSync(
    join(import.meta.dirname, "..", ".github", "workflows", "release.yml"),
    "utf8",
  ),
) as { jobs: { build: { strategy: { matrix: { include: Build[] } } } } };

/** Each build runs `scripts/release-build.sh <target> <arch>`. */
const targets = workflow.jobs.build.strategy.matrix.include.map(
  (build) => /release-build\.sh (\S+)/u.exec(build.run)?.[1],
);

test("every release build names its target", () => {
  expect(targets).not.toContain(undefined);
});

test("the release builds macOS for Apple Silicon only", () => {
  expect(
    targets.filter((target) => target?.endsWith("-apple-darwin") === true),
  ).toEqual(["aarch64-apple-darwin"]);
});

// The finish step refuses a manifest with a platform missing, so a platform
// the updater expects and nothing builds would leave every release a draft.
test("the release builds every platform the updater manifest lists", () => {
  expect(targets).toHaveLength(Object.keys(ASSETS).length);
});
