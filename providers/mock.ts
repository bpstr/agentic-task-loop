import type { AgentProvider, AgentRequest, AgentResult } from "../runtime/types.js";

export type MockResponse = unknown | ((request: AgentRequest) => unknown | Promise<unknown>);

export class MockProvider implements AgentProvider {
  readonly name = "mock" as const;
  private readonly responses = new Map<string, MockResponse[]>();

  enqueue(role: string, response: MockResponse): this {
    const queue = this.responses.get(role) ?? [];
    queue.push(response);
    this.responses.set(role, queue);
    return this;
  }

  async capabilities(): Promise<Record<string, boolean>> {
    return { structuredOutput: true, deterministic: true };
  }

  async runAgent<T>(request: AgentRequest): Promise<AgentResult<T>> {
    const queue = this.responses.get(request.role) ?? [];
    const response = queue.shift();
    if (response === undefined) throw new Error(`No mock response queued for ${request.role}`);
    const data = typeof response === "function" ? await response(request) : response;
    return { data: data as T, raw: JSON.stringify(data) };
  }
}
