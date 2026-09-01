import { CommandIntegration } from "./command-integration.js";
import type { CapabilityCommand, Task } from "../runtime/types.js";

interface JiraTicket {
  key: string;
  summary: string;
  description?: string;
  acceptanceCriteria?: string[];
  comments?: string[];
  linkedIssues?: string[];
}

export class JiraIntegration {
  private readonly command: CommandIntegration;

  constructor(config: CapabilityCommand, cwd: string) {
    this.command = new CommandIntegration("Jira", config, cwd);
  }

  async resolve(reference: string): Promise<{ task: Task; raw: JiraTicket }> {
    const ticket = await this.command.invoke<JiraTicket>({ operation: "get", issue: reference });
    return {
      raw: ticket,
      task: {
        id: ticket.key,
        source: "jira",
        title: ticket.summary,
        description: [ticket.description, ...(ticket.comments ?? [])].filter(Boolean).join("\n\n"),
        acceptanceCriteria: ticket.acceptanceCriteria ?? [],
        constraints: [],
        externalReference: reference,
      },
    };
  }

  async comment(reference: string, body: string): Promise<unknown> {
    return this.command.invoke({ operation: "comment", issue: reference, body });
  }
}
