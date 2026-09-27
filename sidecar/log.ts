/**
 * Diagnostics go to stderr: stdout carries the protocol and nothing else.
 * Rust forwards these lines to its own log.
 */
export function log(message: string, detail?: Record<string, unknown>): void {
  const line =
    detail === undefined ? message : `${message} ${JSON.stringify(detail)}`;
  process.stderr.write(`[ogmios-agent] ${line}\n`);
}
