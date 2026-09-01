import { readFile } from "node:fs/promises";
import { runProcess, parseStructuredJson } from "./process-runner.js";
import type { AgentProvider, AgentRequest, AgentResult } from "../runtime/types.js";

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude" as const;

  async capabilities(): Promise<Record<string, boolean>> {
    return { structuredOutput: true, readOnlyMode: true, editMode: true };
  }

  async runAgent<T>(request: AgentRequest): Promise<AgentResult<T>> {
    const schema = await readFile(request.schemaPath, "utf8");
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--permission-mode",
      request.writable ? "acceptEdits" : "plan",
    ];
    const result = await runProcess("claude", args, { cwd: request.cwd, stdin: request.prompt });
    if (result.exitCode !== 0) {
      throw new Error(`Claude ${request.role} failed (${result.exitCode}): ${result.stderr.trim()}`);
    }
    return { data: parseStructuredJson(result.stdout) as T, raw: result.stdout };
  }
}
