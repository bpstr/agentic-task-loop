import { CommandIntegration } from "./command-integration.js";
import type { CapabilityCommand, Task } from "../runtime/types.js";

export class CodebaseIntegration {
  private readonly command: CommandIntegration;

  constructor(config: CapabilityCommand, cwd: string) {
    this.command = new CommandIntegration("codebase-mcp", config, cwd);
  }

  async investigate(task: Task): Promise<unknown> {
    return this.command.invoke({ operation: "investigate", task, include: ["architecture", "symbols", "dependencies", "tests"] });
  }
}
