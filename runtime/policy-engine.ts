import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ActionDecision, Policy } from "./types.js";

export class PolicyError extends Error {}

const intrinsicDeny = [
  /^(npx|bunx)( |$)/,
  /^(npm|pnpm|yarn|bun) (install|add|remove|uninstall|update|upgrade|publish|deploy|exec|dlx|x)( |$)/,
  /^(npm|pnpm|yarn|bun) run (deploy|publish|release|ship|upload|migrate|migration|seed)(:| |$)/,
  /^composer (install|update|require|remove|global)( |$)/,
  /^php artisan (migrate|db:seed|queue:work|schedule:run|storage:link)( |$)/,
  /^python3? (?!(-m (pytest|unittest|compileall)|--version|-V)( |$))/,
  /^git (push|commit|reset|clean|checkout|switch|merge|rebase|tag)( |$)/,
  /(^|\/)(deploy|publish|release|ship)([-_.\/]| |$)/i,
  /\b(kubectl apply|kubectl delete|terraform apply|terraform destroy|docker push|gh release)\b/i,
];

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
    const display = [command, ...args].join(" ").trim();
    if (intrinsicDeny.some((pattern) => pattern.test(display))) {
      throw new PolicyError(`Validation command is intrinsically unsafe: ${display}`);
    }
    if ((this.policy.commands.deny ?? []).some((pattern) => new RegExp(pattern).test(display))) {
      throw new PolicyError(`Validation command is denied by policy: ${display}`);
    }
    const allowed = this.policy.commands.allow.some((pattern) => new RegExp(pattern).test(display));
    if (!allowed) {
      throw new PolicyError(`Validation command is outside policy allowlist: ${display}`);
    }
  }
}
