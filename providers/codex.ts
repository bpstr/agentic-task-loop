import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess, parseStructuredJson } from "./process-runner.js";
import type { AgentProvider, AgentRequest, AgentResult } from "../runtime/types.js";

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;

  async capabilities(): Promise<Record<string, boolean>> {
    return { structuredOutput: true, readOnlySandbox: true, workspaceWriteSandbox: true };
  }

  async runAgent<T>(request: AgentRequest): Promise<AgentResult<T>> {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "agentic-task-codex-"));
    const outputPath = path.join(temporary, "result.json");
    try {
      const args = [
        "exec",
        "--ephemeral",
        "--color",
        "never",
        "-C",
        request.cwd,
        "--sandbox",
        request.writable ? "workspace-write" : "read-only",
        "--output-schema",
        request.schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ];
      const result = await runProcess("codex", args, { cwd: request.cwd, stdin: request.prompt });
      if (result.exitCode !== 0) {
        throw new Error(`Codex ${request.role} failed (${result.exitCode}): ${result.stderr.trim()}`);
      }
      const raw = await readFile(outputPath, "utf8");
      return { data: parseStructuredJson(raw) as T, raw };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
