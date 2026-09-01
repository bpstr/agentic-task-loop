import { CommandIntegration } from "./command-integration.js";
import type { CapabilityCommand, Task } from "../runtime/types.js";

export class GraphifyIntegration {
  private readonly command: CommandIntegration;

  constructor(config: CapabilityCommand, cwd: string) {
    this.command = new CommandIntegration("Graphify", config, cwd);
  }

  async investigate(task: Task): Promise<unknown> {
    return this.command.invoke({ operation: "query", query: task.description, taskId: task.id });
  }
}
