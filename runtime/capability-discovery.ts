import { access, readFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../providers/process-runner.js";
import type { Capability, CapabilityConfig, ProviderName } from "./types.js";

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
        accessSync(path.join(directory, `${command}${extension}`), process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

async function optionalText(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function optionalJson(filename: string): Promise<Record<string, unknown> | undefined> {
  const content = await optionalText(filename);
  if (!content) return undefined;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseCodexMcpConfig(content: string): string[] {
  const section = /^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\]\s*$/gm;
  const matches = [...content.matchAll(section)];
  const names: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!name || match.index === undefined) continue;
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end);
    if (/^\s*enabled\s*=\s*false\s*$/m.test(body)) continue;
    names.push(name);
  }
  return names;
}

function mcpServerNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

export function parseProviderMcpListing(output: string): string[] {
  const names = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(name|server|mcp servers?|configured|checking|no mcp)/i.test(line)) continue;
    const name = line.match(/^([A-Za-z0-9_.@/-]+)(?=\s|:)/)?.[1];
    if (name && !["status", "command", "url"].includes(name.toLowerCase())) names.add(name);
  }
  return [...names];
}

function providerCapability(provider: ProviderName, name: string, detail: string): Capability {
  return {
    name: `mcp:${name}`,
    available: true,
    source: "provider",
    provider,
    kind: "mcp-server",
    detail,
  };
}

export class CapabilityDiscovery {
  constructor(private readonly cwd: string) {}

  async discover(): Promise<{ capabilities: Capability[]; config: CapabilityConfig }> {
    const configPath = path.join(this.cwd, ".agentic", "capabilities.json");
    const config = await this.readConfig(configPath);
    const codexAvailable = executableOnPath("codex");
    const claudeAvailable = executableOnPath("claude");
    const providerMcp = await Promise.all([
      codexAvailable ? this.discoverCodexMcp() : Promise.resolve([]),
      claudeAvailable ? this.discoverClaudeMcp() : Promise.resolve([]),
    ]);

    const capabilities: Capability[] = [
      { name: "native-repository", available: await exists(path.join(this.cwd, ".git")), source: "native", kind: "repository" },
      { name: "codex", available: codexAvailable, source: "executable", kind: "provider", provider: "codex" },
      { name: "claude", available: claudeAvailable, source: "executable", kind: "provider", provider: "claude" },
      ...providerMcp.flat(),
      { name: "jira-adapter", available: Boolean(config.jira || process.env.JIRA_MCP_COMMAND), source: config.jira ? "configuration" : "environment", kind: "integration" },
      { name: "codebase-adapter", available: Boolean(config.codebase || process.env.CODEBASE_MCP_COMMAND), source: config.codebase ? "configuration" : "environment", kind: "integration" },
      { name: "graphify-adapter", available: Boolean(config.graphify || process.env.GRAPHIFY_COMMAND), source: config.graphify ? "configuration" : "environment", kind: "integration" },
      { name: "graphify-state", available: await exists(path.join(this.cwd, "graphify-out")), source: "repository", kind: "repository" },
      { name: "deep-code-review", available: Boolean(config.deepReview || process.env.DEEP_REVIEW_COMMAND || executableOnPath("deep-review")), source: config.deepReview ? "configuration" : "executable", kind: "integration" },
    ];
    return { capabilities: this.deduplicate(capabilities), config };
  }

  private async discoverCodexMcp(): Promise<Capability[]> {
    const names = new Set<string>();
    const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
    for (const filename of [path.join(codexHome, "config.toml"), path.join(this.cwd, ".codex", "config.toml")]) {
      const content = await optionalText(filename);
      if (content) for (const name of parseCodexMcpConfig(content)) names.add(name);
    }
    try {
      const listing = await runProcess("codex", ["mcp", "list"], { cwd: this.cwd, timeoutMs: 15_000 });
      if (listing.exitCode === 0) for (const name of parseProviderMcpListing(listing.stdout)) names.add(name);
    } catch {
      // Config-file discovery still provides useful metadata when the CLI cannot list servers.
    }
    return [...names].map((name) => providerCapability("codex", name, "Inherited from Codex MCP configuration"));
  }

  private async discoverClaudeMcp(): Promise<Capability[]> {
    const names = new Set<string>();
    const project = await optionalJson(path.join(this.cwd, ".mcp.json"));
    for (const name of mcpServerNames(project?.mcpServers)) names.add(name);

    const user = await optionalJson(path.join(os.homedir(), ".claude.json"));
    for (const name of mcpServerNames(user?.mcpServers)) names.add(name);
    const projects = user?.projects;
    if (projects && typeof projects === "object" && !Array.isArray(projects)) {
      const scoped = (projects as Record<string, unknown>)[this.cwd];
      if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
        for (const name of mcpServerNames((scoped as Record<string, unknown>).mcpServers)) names.add(name);
      }
    }

    try {
      const listing = await runProcess("claude", ["mcp", "list"], { cwd: this.cwd, timeoutMs: 15_000 });
      if (listing.exitCode === 0) for (const name of parseProviderMcpListing(listing.stdout)) names.add(name);
    } catch {
      // Claude may still load MCP servers from user/project settings during the agent run.
    }
    return [...names].map((name) => providerCapability("claude", name, "Inherited from Claude Code MCP configuration"));
  }

  private deduplicate(capabilities: Capability[]): Capability[] {
    const seen = new Set<string>();
    return capabilities.filter((capability) => {
      const key = `${capability.provider ?? "runtime"}:${capability.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async readConfig(configPath: string): Promise<CapabilityConfig> {
    const config = await optionalJson(configPath);
    return (config ?? {}) as CapabilityConfig;
  }
}
