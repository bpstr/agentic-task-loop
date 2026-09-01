import { runProcess } from "../providers/process-runner.js";
import type { CapabilityCommand } from "../runtime/types.js";

export class DeepCodeReviewIntegration {
  constructor(
    private readonly config: CapabilityCommand,
    private readonly cwd: string,
  ) {}

  async review(): Promise<string> {
    const result = await runProcess(this.config.command, this.config.args ?? ["--changes"], { cwd: this.cwd, timeoutMs: 60 * 60 * 1000 });
    if (result.exitCode !== 0) {
      throw new Error(`Deep Code Review failed (${result.exitCode}): ${result.stderr.trim()}`);
    }
    return result.stdout;
  }
}
