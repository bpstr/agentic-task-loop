#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Orchestrator } from "../runtime/orchestrator.js";
import type { ProviderName, RunOptions } from "../runtime/types.js";

interface ParsedArguments extends RunOptions {
  request: string;
}

function usage(): string {
  return `Usage: agentic-task [options] <task or ticket>\n\nOptions:\n  --provider auto|codex|claude   Provider selection (default: auto)\n  --policy default|strict|autonomous\n  --approve <action>             Pre-authorize a policy-gated action; repeatable\n  --resume <run-id>              Resume a durable run\n  --post-jira                    Post the final summary when policy and approval allow\n  --cwd <path>                   Repository root (default: current directory)\n  --dry-run                      Show discovered capabilities and exit\n  --help                         Show this help\n`;
}

function parseArguments(argv: string[]): ParsedArguments {
  const approvals = new Set<string>();
  const request: string[] = [];
  let provider: ProviderName | "auto" = "auto";
  let policyName = "default";
  let cwd = process.cwd();
  let resumeRunId: string | undefined;
  let dryRun = false;
  let postJira = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (argument === "--provider") {
      const value = argv[++index];
      if (value !== "auto" && value !== "codex" && value !== "claude") throw new Error(`Invalid provider: ${value ?? "missing"}`);
      provider = value;
    } else if (argument === "--policy") {
      policyName = argv[++index] ?? "";
    } else if (argument === "--approve") {
      const action = argv[++index];
      if (!action) throw new Error("--approve requires an action");
      approvals.add(action);
    } else if (argument === "--resume") {
      resumeRunId = argv[++index];
      if (!resumeRunId) throw new Error("--resume requires a run id");
    } else if (argument === "--cwd") {
      const value = argv[++index];
      if (!value) throw new Error("--cwd requires a path");
      cwd = path.resolve(value);
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--post-jira") {
      postJira = true;
    } else if (argument?.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument) {
      request.push(argument);
    }
  }

  return {
    request: request.join(" "),
    cwd,
    provider,
    policyName,
    approvals,
    ...(resumeRunId ? { resumeRunId } : {}),
    dryRun,
    postJira,
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const pluginRoot = path.resolve(moduleDirectory, "..", "..");
  const orchestrator = new Orchestrator(pluginRoot, args, {
    progress: (phase, message) => process.stderr.write(`[${phase.toUpperCase()}] ${message}\n`),
  });
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(await orchestrator.preview(), null, 2)}\n`);
    return;
  }
  const result = await orchestrator.run(args.request);
  process.stdout.write(`${JSON.stringify({ runId: result.state.runId, phase: result.state.phase, report: result.report }, null, 2)}\n`);
  if (result.state.phase === "blocked") process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
