/**
 * `ogmios-agent`: the sidecar that talks to Claude for Ogmios.
 *
 * Reads one JSON request per line on stdin and writes responses and events as
 * JSON lines on stdout (see `shared/protocol.ts`). Requests run concurrently;
 * each ends in exactly one response carrying its id.
 */
import { createInterface } from "node:readline";

import type { ConfigureParams, Outgoing } from "../shared/protocol.ts";
import { Dispatcher } from "./dispatch.ts";
import { log } from "./log.ts";
import { ApiKeyProvider, messagesApi } from "./providers/apiKey.ts";
import { ClaudeCodeProvider } from "./providers/claudeCode.ts";
import { FakeProvider } from "./providers/fake.ts";
import type { Provider } from "./providers/provider.ts";

// A stray console.log from a dependency would corrupt the protocol stream.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

function write(message: Outgoing): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function makeProvider(config: ConfigureParams): Provider {
  if (config.mode === "apiKey") {
    return new ApiKeyProvider(
      messagesApi(config.apiKey ?? ""),
      config.model,
      config.effort,
    );
  }
  return new ClaudeCodeProvider(
    config.claudePath ?? "",
    config.model,
    config.effort,
  );
}

// The fake answers every call without configuration, whatever `configure` says.
const fake = process.env["OGMIOS_FAKE"] === "1";
const dispatcher = new Dispatcher(
  fake ? () => new FakeProvider() : makeProvider,
  fake ? new FakeProvider() : null,
);
log(`started${fake ? " with the fake provider" : ""}`);

const pending: Set<Promise<void>> = new Set();
for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  if (line.trim() === "") {
    continue;
  }
  const task = dispatcher.handleLine(line, write).finally(() => {
    pending.delete(task);
  });
  pending.add(task);
}

// stdin closed: Rust is done with us. Finish what was asked, then leave.
await Promise.allSettled(pending);
process.exit(0);
