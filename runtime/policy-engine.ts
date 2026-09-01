import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ActionDecision, Policy } from "./types.js";

export class PolicyError extends Error {}

export class PolicyEngine {
  constructor(
    readonly policy: Policy,
    private readonly approvals: Set<string> = new Set(),
  ) {}

  static async load(pluginRoot: string, name: string, approvals: Set<string> = new Set()): Promise<PolicyEngine> {
    if (!/^[a-z0-9-]+$/i.test(name)) {
      throw new PolicyError(`Invalid policy name: ${name}`);
    }
    const policyPath = path.join(pluginRoot, "policies", `${name}.yaml`);
    const parsed = parse(await readFile(policyPath, "utf8")) as Policy;
    if (!parsed?.name || !parsed.budgets || !parsed.actions || !Array.isArray(parsed.commands?.allow)) {
      throw new PolicyError(`Malformed policy: ${policyPath}`);
    }
    return new PolicyEngine(parsed, approvals);
  }

  decision(action: string): ActionDecision {
    return this.policy.actions[action] ?? "deny";
  }

  assertAllowed(action: string): ActionDecision {
    const decision = this.decision(action);
    if (decision === "deny") {
      throw new PolicyError(`Policy ${this.policy.name} denies ${action}`);
    }
    if (decision === "approve" && !this.approvals.has(action)) {
      throw new PolicyError(`Action ${action} requires approval; pass --approve ${action}`);
    }
    return decision;
  }

  assertCommandAllowed(command: string, args: string[]): void {
    this.assertAllowed("test.run");
    const display = [command, ...args].join(" ");
    const allowed = this.policy.commands.allow.some((pattern) => new RegExp(pattern).test(display));
    if (!allowed) {
      throw new PolicyError(`Validation command is outside policy allowlist: ${display}`);
    }
  }
}
