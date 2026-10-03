import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The release runs each bundled sidecar before uploading it. An Apple Silicon
 * runner runs the Intel one under Rosetta, which on macOS 14 offers no AVX:
 * Bun died there with an illegal instruction and 0.1.1 was never published.
 * No Mac that Bun supports lacks AVX, so the Intel build is checked on Intel.
 */
interface Build {
  os: string;
  target: string;
}

const workflow = Bun.YAML.parse(
  readFileSync(
    join(import.meta.dirname, "..", ".github", "workflows", "release.yml"),
    "utf8",
  ),
) as { jobs: { build: { strategy: { matrix: { include: Build[] } } } } };

test("the Intel macOS release is built and checked on an Intel runner", () => {
  const intel = workflow.jobs.build.strategy.matrix.include.filter(
    (build) => build.target === "x86_64-apple-darwin",
  );
  expect(intel.map((build) => build.os)).toEqual(["macos-15-intel"]);
});
