import { access, readFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import type { Capability, CapabilityConfig } from "./types.js";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function executableOnPath(command: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return pathValue.split(path.delimiter).some((directory) =>
    extensions.some((extension) => {
      try {
        requireAccess(path.join(directory, `${command}${extension}`));
        return true;
      } catch {
        return false;
      }
    }),
  );
}

function requireAccess(target: string): void {
  accessSync(target, process.platform === "win32" ? constants.F_OK : constants.X_OK);
}

export class CapabilityDiscovery {
  constructor(private readonly cwd: string) {}

  async discover(): Promise<{ capabilities: Capability[]; config: CapabilityConfig }> {
    const configPath = path.join(this.cwd, ".agentic", "capabilities.json");
    const config = await this.readConfig(configPath);
    const capabilities: Capability[] = [
      { name: "native-repository", available: await exists(path.join(this.cwd, ".git")), source: "native" },
      { name: "codex", available: executableOnPath("codex"), source: "executable" },
      { name: "claude", available: executableOnPath("claude"), source: "executable" },
      { name: "jira", available: Boolean(config.jira || process.env.JIRA_MCP_COMMAND), source: config.jira ? "configuration" : "environment" },
      { name: "codebase-mcp", available: Boolean(config.codebase || process.env.CODEBASE_MCP_COMMAND), source: config.codebase ? "configuration" : "environment" },
      { name: "graphify", available: Boolean(config.graphify || process.env.GRAPHIFY_COMMAND || await exists(path.join(this.cwd, "graphify-out"))), source: config.graphify ? "configuration" : "repository" },
      { name: "deep-code-review", available: Boolean(config.deepReview || process.env.DEEP_REVIEW_COMMAND || executableOnPath("deep-review")), source: config.deepReview ? "configuration" : "executable" },
    ];
    return { capabilities, config };
  }

  private async readConfig(configPath: string): Promise<CapabilityConfig> {
    if (!(await exists(configPath))) return {};
    return JSON.parse(await readFile(configPath, "utf8")) as CapabilityConfig;
  }
}
