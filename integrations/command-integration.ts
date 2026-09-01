import { runProcess, parseStructuredJson } from "../providers/process-runner.js";
import type { CapabilityCommand } from "../runtime/types.js";

export class CommandIntegration {
  constructor(
    readonly name: string,
    private readonly configured: CapabilityCommand,
    private readonly cwd: string,
  ) {}

  async invoke<T>(input: unknown): Promise<T> {
    const result = await runProcess(
      this.configured.command,
      [...(this.configured.args ?? []), JSON.stringify(input)],
      { cwd: this.cwd },
    );
    if (result.exitCode !== 0) {
      throw new Error(`${this.name} failed (${result.exitCode}): ${result.stderr.trim()}`);
    }
    return parseStructuredJson(result.stdout) as T;
  }
}
