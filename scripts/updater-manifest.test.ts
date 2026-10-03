import { describe, expect, test } from "bun:test";
import { ASSETS, manifest } from "./updater-manifest";

describe("updater manifest", () => {
  const signatures = Object.fromEntries(
    Object.values(ASSETS).map((file) => [file, `sig of ${file}`]),
  );

  test("points every platform at its asset in the tagged release", () => {
    const json = manifest({
      version: "0.2.0",
      repo: "ilien-dev/ogmios",
      notes: "Fixes",
      date: "2026-10-02T00:00:00.000Z",
      signatures,
    });

    expect(json.version).toBe("0.2.0");
    expect(json.notes).toBe("Fixes");
    expect(Object.keys(json.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "windows-x86_64",
    ]);
    expect(json.platforms["windows-x86_64"]).toEqual({
      url: "https://github.com/ilien-dev/ogmios/releases/download/v0.2.0/Ogmios_x64-setup.exe",
      signature: "sig of Ogmios_x64-setup.exe",
    });
  });

  test("refuses to publish with a platform unsigned", () => {
    const { [ASSETS["darwin-x86_64"]]: _dropped, ...partial } = signatures;
    expect(() =>
      manifest({
        version: "0.2.0",
        repo: "ilien-dev/ogmios",
        notes: "",
        date: "2026-10-02T00:00:00.000Z",
        signatures: partial,
      }),
    ).toThrow(/Ogmios_x64.app.tar.gz/u);
  });
});
