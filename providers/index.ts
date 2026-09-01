import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { MockProvider } from "./mock.js";
import type { AgentProvider, ProviderName } from "../runtime/types.js";

export function createProvider(name: ProviderName): AgentProvider {
  if (name === "codex") return new CodexProvider();
  if (name === "claude") return new ClaudeProvider();
  return new MockProvider();
}
