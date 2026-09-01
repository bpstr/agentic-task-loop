import { spawn } from "node:child_process";
import { PolicyEngine } from "./policy-engine.js";
import type { CheckCommand, CheckResult } from "./types.js";

const outputLimit = 64 * 1024;

export class CheckRunner {
  constructor(
    private readonly cwd: string,
    private readonly policy: PolicyEngine,
    private readonly timeoutMs = 10 * 60 * 1000,
  ) {}

  async run(check: CheckCommand): Promise<CheckResult> {
    this.policy.assertCommandAllowed(check.command, check.args);
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(check.command, check.args, { cwd: this.cwd, shell: false, env: process.env });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-outputLimit); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-outputLimit); });
      child.on("error", (error) => { stderr = `${stderr}\n${error.message}`.trim(); });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          name: check.name,
          command: check.command,
          args: check.args,
          exitCode,
          status: exitCode === 0 ? "passed" : "failed",
          stdout,
          stderr,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  async runAll(checks: CheckCommand[]): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const check of checks) results.push(await this.run(check));
    return results;
  }
}
