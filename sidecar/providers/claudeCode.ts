import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

import type {
  CanUseTool,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatResult, CheckResult } from "../../shared/protocol.ts";
import { AgentError, providerError } from "../errors.ts";
import { log } from "../log.ts";
import { modelKnobs } from "./models.ts";
import type {
  ChatTask,
  DeltaSink,
  Provider,
  StructuredTask,
} from "./provider.ts";
import { firstIssues, outputSchema, parseValue } from "./structured.ts";

/**
 * Structured output rides on this end-turn tool. It is the one tool the
 * session may hold; anything else means the isolation below failed.
 */
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

// Claude Code counts the structured-output tool call as a turn of its own.
const CHAT_MAX_TURNS = 1;
const STRUCTURED_MAX_TURNS = 3;

const denyTools: CanUseTool = (toolName) =>
  Promise.resolve(
    toolName === STRUCTURED_OUTPUT_TOOL
      ? { behavior: "allow" }
      : { behavior: "deny", message: "No tools are available here." },
  );

interface Run {
  result: SDKResultSuccess;
  sessionId: string;
}

/**
 * Reads what Claude Code printed when a turn failed and says what to do
 * about it. The CLI reports these as text, so text is what there is to read.
 */
export function describeClaudeFailure(text: string): AgentError {
  if (/not logged in|log ?in|\/login|authenticat|401|credential/iu.test(text)) {
    return providerError(
      "Claude Code is not logged in. Run `claude` in a terminal and log in.",
    );
  }
  if (/usage limit|rate limit|429|quota/iu.test(text)) {
    return providerError(
      "Your Claude plan has reached its usage limit. Try again later.",
    );
  }
  if (/overloaded|529/iu.test(text)) {
    return providerError("Claude is overloaded right now. Try again shortly.");
  }
  return providerError(`Claude Code failed: ${text.slice(0, 300)}`);
}

function assertNoTools(tools: string[]): void {
  const extra = tools.filter((tool) => tool !== STRUCTURED_OUTPUT_TOOL);
  if (extra.length > 0) {
    throw new AgentError(
      "internal",
      `Claude Code started with tools it must not have: ${extra.join(", ")}`,
    );
  }
}

function textDelta(message: SDKMessage): string | null {
  if (message.type !== "stream_event") {
    return null;
  }
  const { event } = message;
  return event.type === "content_block_delta" &&
    event.delta.type === "text_delta"
    ? event.delta.text
    : null;
}

function logResult(method: string, result: SDKResultMessage): void {
  log("usage", {
    method,
    usage: result.usage,
    modelUsage: result.modelUsage,
    costUsd: result.total_cost_usd,
  });
}

/** Runs the user's own `claude` with nothing of theirs loaded (SPEC §13). */
export class ClaudeCodeProvider implements Provider {
  readonly #claudePath: string;
  readonly #model: string;

  constructor(claudePath: string, model: string) {
    this.#claudePath = claudePath;
    this.#model = model;
  }

  options(system: string, purpose: "chat" | "structured"): Options {
    const { thinking, effort } = modelKnobs(this.#model, purpose);
    return {
      pathToClaudeCodeExecutable: this.#claudePath,
      model: this.#model,
      systemPrompt: system,
      // None of their CLAUDE.md, settings or MCP servers. Installed plugins
      // still load, so their hooks and every skill are switched off by flag.
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      settings: { disableAllHooks: true, disableBundledSkills: true },
      extraArgs: { "disable-slash-commands": null },
      skills: [],
      tools: [],
      canUseTool: denyTools,
      permissionPrompts: "none",
      includePartialMessages: purpose === "chat",
      maxTurns: purpose === "chat" ? CHAT_MAX_TURNS : STRUCTURED_MAX_TURNS,
      // Sessions are filed under the working directory; one fixed place keeps
      // `resume` finding them and keeps any project's files out of reach.
      cwd: tmpdir(),
      ...(thinking === false ? { thinking: { type: "disabled" } } : {}),
      ...(effort === null ? {} : { effort }),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "ogmios" },
      stderr: (data) => {
        log("claude stderr", { data: data.trim() });
      },
    };
  }

  async #run(
    prompt: string,
    options: Options,
    onDelta: DeltaSink | null,
  ): Promise<Run> {
    if (!existsSync(this.#claudePath)) {
      throw providerError(`Claude Code was not found at ${this.#claudePath}.`);
    }
    let result: SDKResultMessage | null = null;
    let sessionId = "";
    try {
      for await (const message of query({ prompt, options })) {
        if (message.type === "system" && message.subtype === "init") {
          log("claude session", {
            version: message.claude_code_version,
            model: message.model,
            tools: message.tools,
            mcpServers: message.mcp_servers.map((server) => server.name),
            skills: message.skills.length,
            plugins: message.plugins.length,
          });
          assertNoTools(message.tools);
          sessionId = message.session_id;
        } else if (message.type === "result") {
          result = message;
        } else if (onDelta !== null) {
          const delta = textDelta(message);
          if (delta !== null) {
            onDelta(delta);
          }
        }
      }
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      throw describeClaudeFailure(String(error));
    }
    if (result === null) {
      throw providerError("Claude Code ended without an answer.");
    }
    if (result.subtype !== "success") {
      throw describeClaudeFailure(result.errors.join("; ") || result.subtype);
    }
    if (result.is_error) {
      throw describeClaudeFailure(result.result);
    }
    return { result, sessionId };
  }

  async check(): Promise<CheckResult> {
    try {
      const { result } = await this.#run(
        "Reply with the single word OK.",
        {
          ...this.options("You answer in one word.", "chat"),
          persistSession: false,
        },
        null,
      );
      logResult("check", result);
      return { ok: true, message: null };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async chat(task: ChatTask, onDelta: DeltaSink): Promise<ChatResult> {
    const last = task.history.at(-1);
    const options = this.options(task.system, "chat");
    let prompt = task.kickoff;
    if (last !== undefined && task.providerRef !== null) {
      prompt = last.text;
      options.resume = task.providerRef;
    } else if (last !== undefined) {
      // No session to resume (a restart, a switched provider): replay it.
      prompt = replayPrompt(task.history);
    }
    const { result, sessionId } = await this.#run(prompt, options, onDelta);
    logResult("chat", result);
    return { text: result.result.trim(), providerRef: sessionId || null };
  }

  async structured<T>(task: StructuredTask<T>): Promise<T> {
    const options: Options = {
      ...this.options(task.system, "structured"),
      outputFormat: { type: "json_schema", schema: outputSchema(task.schema) },
      persistSession: false,
    };
    const attempt = async (prompt: string) => {
      const { result } = await this.#run(prompt, options, null);
      logResult(task.request.method, result);
      return parseValue(task.schema, result.structured_output);
    };
    const first = await attempt(task.user);
    if (first.ok) {
      return first.value;
    }
    log("retrying after invalid output", { method: task.request.method });
    // One retry, with what was wrong, before giving up on the call.
    const second = await attempt(
      `${task.user}\n\nA previous answer failed validation:\n${first.issues}\nAnswer again, fixing those problems.`,
    );
    if (second.ok) {
      return second.value;
    }
    throw providerError(
      `Claude's answer did not match the expected format: ${firstIssues(second.issues)}`,
    );
  }
}

/** The whole conversation as one prompt, for a partner with no session. */
export function replayPrompt(history: ChatTask["history"]): string {
  const lines = history.map(
    (turn) => `${turn.role === "user" ? "Learner" : "You"}: ${turn.text}`,
  );
  return `The conversation so far:\n\n${lines.join("\n\n")}\n\nReply to the learner's last turn.`;
}
