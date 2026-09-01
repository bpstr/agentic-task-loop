import { randomUUID } from "node:crypto";
import path from "node:path";
import { CapabilityDiscovery } from "./capability-discovery.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { CheckRunner } from "./check-runner.js";
import { EventLog } from "./event-log.js";
import { PolicyEngine, PolicyError } from "./policy-engine.js";
import { PromptLoader } from "./prompt-loader.js";
import { Scheduler } from "./scheduler.js";
import { SchemaRegistry } from "./schema-registry.js";
import { StateMachine, type RunEvent } from "./state-machine.js";
import { WorktreeManager } from "./worktree-manager.js";
import { createProvider } from "../providers/index.js";
import { CodebaseIntegration } from "../integrations/codebase-mcp.js";
import { DeepCodeReviewIntegration } from "../integrations/deep-code-review.js";
import { GraphifyIntegration } from "../integrations/graphify.js";
import { JiraIntegration } from "../integrations/jira-mcp.js";
import { NativeRepositoryIntegration } from "../integrations/native-repository.js";
import type {
  AgentProvider,
  Capability,
  CapabilityCommand,
  CapabilityConfig,
  CheckResult,
  ContextPackage,
  Diagnosis,
  FinalReport,
  ImplementationResult,
  Plan,
  PlanReview,
  ProviderName,
  ReviewResult,
  RunOptions,
  RunState,
  Task,
  VerificationResult,
  Workstream,
} from "./types.js";

export type ProgressReporter = (phase: string, message: string) => void;

interface OrchestratorDependencies {
  provider?: AgentProvider;
  progress?: ProgressReporter;
}

function runId(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `ATL-${date}-${randomUUID().slice(0, 8)}`;
}

function taskFromRequest(request: string): Task {
  const trimmed = request.trim();
  if (!trimmed) throw new Error("A task description or --resume run id is required");
  const reference = trimmed.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0];
  return {
    id: reference ?? `TASK-${randomUUID().slice(0, 8)}`,
    source: reference ? "jira" : "plain",
    title: trimmed.split("\n", 1)[0]?.slice(0, 160) || "Software-development task",
    description: trimmed,
    acceptanceCriteria: [],
    constraints: [],
    ...(reference ? { externalReference: reference } : {}),
  };
}

function commandFromEnvironment(name: string): CapabilityCommand | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const [command, ...args] = value.split(/\s+/);
  return command ? { command, args } : undefined;
}

function mergeCapabilityConfig(config: CapabilityConfig): CapabilityConfig {
  return {
    ...(config.jira || process.env.JIRA_MCP_COMMAND ? { jira: config.jira ?? commandFromEnvironment("JIRA_MCP_COMMAND") } : {}),
    ...(config.codebase || process.env.CODEBASE_MCP_COMMAND ? { codebase: config.codebase ?? commandFromEnvironment("CODEBASE_MCP_COMMAND") } : {}),
    ...(config.graphify || process.env.GRAPHIFY_COMMAND ? { graphify: config.graphify ?? commandFromEnvironment("GRAPHIFY_COMMAND") } : {}),
    ...(config.deepReview || process.env.DEEP_REVIEW_COMMAND ? { deepReview: config.deepReview ?? commandFromEnvironment("DEEP_REVIEW_COMMAND") } : {}),
  } as CapabilityConfig;
}

function reportMarkdown(report: FinalReport): string {
  const validation = report.validation.length
    ? report.validation.map((check) => `- ${check.status.toUpperCase()}: ${check.name} — \`${check.command}\``).join("\n")
    : "- No deterministic checks were declared.";
  return `# Agentic Task Loop result\n\nStatus: **${report.status}**\n\n${report.summary}\n\n## Files changed\n\n${report.filesChanged.map((file) => `- ${file}`).join("\n") || "- None recorded"}\n\n## Validation\n\n${validation}\n\n## Review\n\n${report.reviewSummary || "No review summary."}\n\n## Remaining risks\n\n${report.remainingRisks.map((risk) => `- ${risk}`).join("\n") || "- None recorded"}\n`;
}

export class Orchestrator {
  private readonly store: CheckpointStore;
  private readonly schemas: SchemaRegistry;
  private readonly prompts: PromptLoader;
  private readonly machine = new StateMachine();
  private readonly scheduler = new Scheduler();
  private policy!: PolicyEngine;
  private provider!: AgentProvider;
  private capabilities: Capability[] = [];
  private capabilityConfig: CapabilityConfig = {};
  private readonly progress: ProgressReporter;

  constructor(
    private readonly pluginRoot: string,
    private readonly options: RunOptions,
    dependencies: OrchestratorDependencies = {},
  ) {
    this.store = new CheckpointStore(options.cwd);
    this.schemas = new SchemaRegistry(path.join(pluginRoot, "schemas"));
    this.prompts = new PromptLoader(pluginRoot);
    this.progress = dependencies.progress ?? (() => undefined);
    if (dependencies.provider) this.provider = dependencies.provider;
  }

  async preview(): Promise<{ policy: string; provider: ProviderName; capabilities: Capability[] }> {
    await this.prepare();
    return { policy: this.policy.policy.name, provider: this.provider.name, capabilities: this.capabilities };
  }

  async run(request = ""): Promise<{ state: RunState; report?: FinalReport }> {
    await this.prepare(request);
    let state: RunState;
    let task: Task;

    if (this.options.resumeRunId) {
      state = await this.store.loadState(this.options.resumeRunId);
      task = await this.store.readJson<Task>(state.runId, "task.json");
      if (state.provider !== this.provider.name && this.options.provider === "auto") {
        this.provider = createProvider(state.provider);
      }
      if (state.phase === "completed") {
        return { state, report: await this.store.readJson<FinalReport>(state.runId, "final-report.json") };
      }
      state = await this.recoverInterruptedOperation(state);
    } else {
      task = await this.schemas.validate<Task>("task", taskFromRequest(request));
      const now = new Date().toISOString();
      state = {
        runId: runId(),
        taskId: task.id,
        phase: "intake",
        provider: this.provider.name,
        iteration: 0,
        reviewCycle: 0,
        planRevision: 0,
        toolCalls: 0,
        changedFiles: [],
        checks: {},
        review: { blocking: 0, nonBlocking: 0 },
        budget: this.policy.policy.budgets,
        createdAt: now,
        updatedAt: now,
      };
      await this.schemas.validate<RunState>("run-state", state);
      await this.store.initialize(state, task);
      state = await this.move(state, "TASK_READY", { taskId: task.id });
    }

    const log = new EventLog(this.store.runDirectory(state.runId));
    try {
      while (state.phase !== "completed" && state.phase !== "blocked") {
        this.progress(state.phase, `Starting ${state.phase.replaceAll("_", " ")}`);
        switch (state.phase) {
          case "context": {
            const resolved = await this.resolveTask(task);
            const native = await new NativeRepositoryIntegration(this.options.cwd).collect();
            task = await this.callAgent<Task>(state, "requirements-analyst", "investigate", "task", {
              task: resolved,
              native,
              capabilities: this.agentCapabilities(),
            });
            await this.store.writeJson(state.runId, "task.json", task);
            state.taskId = task.id;
            state = await this.move(state, "CONTEXT_READY", { sources: task.source });
            break;
          }
          case "investigation": {
            const evidence = await this.repositoryEvidence(task);
            const context = await this.callAgent<ContextPackage>(state, "investigator", "investigate", "context", {
              task,
              evidence,
              capabilities: this.agentCapabilities(),
            });
            await this.store.writeContext(state.runId, context);
            state = await this.move(state, "INVESTIGATION_READY", { files: context.relevantFiles.length, symbols: context.relevantSymbols.length });
            break;
          }
          case "plan": {
            const context = await this.store.readJson<ContextPackage>(state.runId, "context.json");
            const criticism = state.planRevision > 0 ? await this.store.readJson<PlanReview>(state.runId, "plan-review.json") : undefined;
            const plan = await this.callAgent<Plan>(state, "planner", "plan", "plan", { task, context, criticism });
            await this.store.writePlan(state.runId, plan);
            state = await this.move(state, "PLAN_READY", { steps: plan.steps.length, checks: plan.checks.length });
            break;
          }
          case "plan_review": {
            const context = await this.store.readJson<ContextPackage>(state.runId, "context.json");
            const plan = await this.store.readJson<Plan>(state.runId, "plan.json");
            const review = await this.callAgent<PlanReview>(state, "plan-critic", "plan", "plan-review", { task, context, plan });
            await this.store.writeJson(state.runId, "plan-review.json", review);
            state = await this.move(state, review.decision === "approve" ? "PLAN_APPROVED" : "PLAN_REVISE", review);
            break;
          }
          case "implementation": {
            this.policy.assertAllowed("repository.write");
            state = await this.beginOperation(state, "implementation");
            const plan = await this.store.readJson<Plan>(state.runId, "plan.json");
            const schedule = this.scheduler.schedule(plan.workstreams);
            await log.append(state.phase, "SCHEDULED", schedule);
            const workstreams = schedule.workstreams.length
              ? schedule.workstreams
              : [{ id: "implementation", files: [], stepIds: plan.steps.map((step) => step.id) }];
            const results = await this.implementWorkstreams(state, task, plan, workstreams, schedule.mode);
            const implementation = {
              summary: results.map((result) => result.summary).join("\n"),
              changedFiles: [...new Set([
                ...results.flatMap((result) => result.changedFiles),
                ...await new NativeRepositoryIntegration(this.options.cwd).changedFiles(),
              ])],
              decisions: results.flatMap((result) => result.decisions),
            } satisfies ImplementationResult;
            state.changedFiles = implementation.changedFiles;
            state.activeOperation = undefined;
            await this.store.writeJson(state.runId, "implementation.json", implementation);
            state = await this.move(state, "IMPLEMENTED", { files: implementation.changedFiles });
            break;
          }
          case "validation": {
            const plan = await this.store.readJson<Plan>(state.runId, "plan.json");
            this.reserveToolCalls(state, plan.checks.length);
            const results = await new CheckRunner(this.options.cwd, this.policy).runAll(plan.checks);
            await this.store.writeJson(state.runId, "test-results.json", results);
            state.checks = Object.fromEntries(results.map((result) => [result.name, result.status]));
            const failed = results.some((result) => result.status !== "passed");
            if (!failed) state.remediationCause = undefined;
            state = await this.move(state, failed ? "CHECKS_FAILED" : "CHECKS_PASSED", {
              results: results.map(({ name, status, exitCode }) => ({ name, status, exitCode })),
            });
            break;
          }
          case "diagnosis": {
            const results = await this.store.readJson<CheckResult[]>(state.runId, "test-results.json");
            const diagnosis = await this.callAgent<Diagnosis>(state, "test-diagnostician", "remediate", "diagnosis", { task, results, iteration: state.iteration });
            await this.store.writeJson(state.runId, "diagnosis.json", diagnosis);
            const remediable = diagnosis.remediable && !["ENVIRONMENT_FAILURE", "DEPENDENCY_FAILURE", "REQUIREMENT_AMBIGUITY", "ARCHITECTURAL_BLOCKER"].includes(diagnosis.class);
            if (remediable) state.remediationCause = { type: "validation_failure", artifact: "diagnosis.json" };
            state = await this.move(state, remediable ? "DIAGNOSED_REMEDIABLE" : "DIAGNOSED_BLOCKED", diagnosis, diagnosis.evidence);
            break;
          }
          case "remediation": {
            this.policy.assertAllowed("repository.write");
            if (!state.remediationCause) throw new Error("Remediation entered without an explicit cause");
            state = await this.beginOperation(state, "remediation");
            const plan = await this.store.readJson<Plan>(state.runId, "plan.json");
            const diagnosis = state.remediationCause.type === "validation_failure"
              ? await this.store.readJson<Diagnosis>(state.runId, state.remediationCause.artifact)
              : undefined;
            const review = state.remediationCause.type === "review_findings"
              ? await this.store.readJson<ReviewResult>(state.runId, state.remediationCause.artifact)
              : undefined;
            const result = await this.callAgent<ImplementationResult>(state, "remediation-agent", "remediate", "implementation", {
              task,
              plan,
              diagnosis,
              review,
              cause: state.remediationCause,
              iteration: state.iteration,
              reviewCycle: state.reviewCycle,
            });
            state.changedFiles = [...new Set([...state.changedFiles, ...result.changedFiles, ...await new NativeRepositoryIntegration(this.options.cwd).changedFiles()])];
            state.activeOperation = undefined;
            await this.store.writeJson(state.runId, `remediation-${state.iteration}-${state.reviewCycle}.json`, result);
            state = await this.move(state, "REMEDIATED", { files: result.changedFiles, cause: state.remediationCause });
            break;
          }
          case "deep_review": {
            const rawReview = await this.externalReview();
            const review = await this.callAgent<ReviewResult>(state, "review-evaluator", "verify", "finding", {
              task,
              changedFiles: state.changedFiles,
              externalReview: rawReview,
            });
            await this.store.writeReview(state.runId, review);
            const p0 = review.findings.filter((finding) => finding.severity === "P0").length;
            const p1 = review.findings.filter((finding) => finding.severity === "P1").length;
            const p2 = review.findings.filter((finding) => finding.severity === "P2").length;
            state.review = { blocking: p0 + p1, nonBlocking: p2 };
            if (p1 && !p0) state.remediationCause = { type: "review_findings", artifact: "review.json" };
            if (!p0 && !p1) state.remediationCause = undefined;
            state = await this.move(state, p0 ? "REVIEW_P0" : p1 ? "REVIEW_P1" : "REVIEW_CLEAR", { p0, p1, p2 }, p0 ? "Deep review reported a P0 finding" : undefined);
            break;
          }
          case "final_verification": {
            const [context, plan, results, review] = await Promise.all([
              this.store.readJson<ContextPackage>(state.runId, "context.json"),
              this.store.readJson<Plan>(state.runId, "plan.json"),
              this.store.readJson<CheckResult[]>(state.runId, "test-results.json"),
              this.store.readJson<ReviewResult>(state.runId, "review.json"),
            ]);
            const verification = await this.callAgent<VerificationResult>(state, "final-verifier", "verify", "verification", { task, context, plan, results, review, state });
            await this.store.writeJson(state.runId, "verification.json", verification);
            const verified = verification.taskSatisfied
              && verification.testsPassed
              && verification.blockingFindings === 0
              && Object.values(verification.acceptanceCriteria).every((status) => status !== "unverified");
            state = await this.move(state, verified ? "VERIFIED" : "VERIFICATION_FAILED", verification, verification.summary);
            break;
          }
          case "finalize": {
            const [implementation, results, review, verification] = await Promise.all([
              this.store.readJson<ImplementationResult>(state.runId, "implementation.json"),
              this.store.readJson<CheckResult[]>(state.runId, "test-results.json"),
              this.store.readJson<ReviewResult>(state.runId, "review.json"),
              this.store.readJson<VerificationResult>(state.runId, "verification.json"),
            ]);
            const report = await this.callAgent<FinalReport>(state, "finalizer", "finalize", "finalize", { task, implementation, results, review, verification, state });
            await this.store.writeJson(state.runId, "final-report.json", report);
            await this.store.writeText(state.runId, "final.md", reportMarkdown(report));
            await this.maybePostJira(task, report);
            state = await this.move(state, "FINALIZED", { status: report.status });
            return { state, report };
          }
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state = this.machine.block(state, reason);
      await log.append(state.phase, "BLOCKED", { reason });
      await this.store.saveState(state);
    }

    if (state.phase === "blocked") {
      const report = this.blockedReport(state);
      await this.store.writeJson(state.runId, "final-report.json", report);
      await this.store.writeText(state.runId, "final.md", reportMarkdown(report));
      return { state, report };
    }
    return { state };
  }

  private async prepare(request = ""): Promise<void> {
    this.policy = await PolicyEngine.load(this.pluginRoot, this.options.policyName, this.options.approvals);
    const discovery = await new CapabilityDiscovery(this.options.cwd).discover();
    this.capabilities = discovery.capabilities;
    this.capabilityConfig = mergeCapabilityConfig(discovery.config);
    if (!this.provider) {
      const selected = this.options.provider === "auto" ? this.selectAutoProvider(request) : this.options.provider;
      if (selected !== "codex" && selected !== "claude" && selected !== "mock") {
        throw new Error("No supported agent provider is available");
      }
      this.provider = createProvider(selected);
    }
  }

  private selectAutoProvider(request: string): ProviderName {
    const available = (["codex", "claude"] as const).filter((provider) =>
      this.capabilities.some((capability) => capability.name === provider && capability.available),
    );
    if (!available.length) throw new Error("No supported agent provider is available");
    const externalReference = /\b[A-Z][A-Z0-9]+-\d+\b/.test(request);
    return [...available].sort((left, right) => this.providerScore(right, externalReference) - this.providerScore(left, externalReference))[0] ?? available[0]!;
  }

  private providerScore(provider: ProviderName, externalReference: boolean): number {
    const mcp = this.capabilities.filter((capability) => capability.provider === provider && capability.kind === "mcp-server" && capability.available);
    const issueTracker = mcp.some((capability) => /jira|atlassian|linear|issue/i.test(capability.name));
    return mcp.length + (externalReference && issueTracker ? 100 : 0);
  }

  private agentCapabilities(): Capability[] {
    return this.capabilities.filter((capability) => !capability.provider || capability.provider === this.provider.name);
  }

  private async callAgent<T>(
    state: RunState,
    role: string,
    skill: string,
    schema: string,
    input: unknown,
    cwd = this.options.cwd,
    artifactSuffix?: string,
  ): Promise<T> {
    this.reserveToolCalls(state, 1);
    const prompt = await this.prompts.compose(role, skill, input);
    const writable = role === "implementer" || role === "remediation-agent";
    const result = await this.provider.runAgent<T>({ role, phase: state.phase, prompt, schemaPath: this.schemas.schemaPath(schema), cwd, writable });
    const suffix = artifactSuffix ? `-${artifactSuffix.replace(/[^A-Za-z0-9._-]/g, "-")}` : "";
    await this.store.writeText(state.runId, `${state.phase}-${role}${suffix}.md`, result.raw);
    return this.schemas.validate<T>(schema, result.data);
  }

  private async implementWorkstreams(
    state: RunState,
    task: Task,
    plan: Plan,
    workstreams: Workstream[],
    requestedMode: "single" | "parallel",
  ): Promise<ImplementationResult[]> {
    if (requestedMode !== "parallel") {
      return [await this.callAgent<ImplementationResult>(state, "implementer", "implement", "implementation", {
        task,
        plan,
        workstreams,
        ownership: workstreams.flatMap((item) => item.files),
      })];
    }

    const manager = new WorktreeManager(this.options.cwd, state.runId);
    const isolation = await manager.canIsolate();
    if (!isolation.allowed) {
      await new EventLog(this.store.runDirectory(state.runId)).append(state.phase, "PARALLEL_FALLBACK", { reason: isolation.reason });
      return [await this.callAgent<ImplementationResult>(state, "implementer", "implement", "implementation", {
        task,
        plan,
        workstreams,
        ownership: workstreams.flatMap((item) => item.files),
        parallelFallback: isolation.reason,
      })];
    }

    const workers = await Promise.all(workstreams.map((workstream) => manager.create(workstream)));
    try {
      const completed = await Promise.all(workers.map(async (worker) => {
        const result = await this.callAgent<ImplementationResult>(state, "implementer", "implement", "implementation", {
          task,
          plan,
          workstream: worker.workstream,
          ownership: worker.workstream.files,
        }, worker.cwd, worker.workstream.id);
        const patch = await manager.collectPatch(worker);
        return {
          result: { ...result, changedFiles: patch.changedFiles },
          patchPath: patch.patchPath,
        };
      }));
      for (const item of completed) await manager.applyPatch(item.patchPath);
      return completed.map((item) => item.result);
    } finally {
      for (const worker of workers) await manager.cleanup(worker);
      await manager.cleanup();
    }
  }

  private reserveToolCalls(state: RunState, count: number): void {
    if (state.toolCalls + count > state.budget.maxToolCalls) {
      throw new PolicyError("Tool-call budget exhausted");
    }
    state.toolCalls += count;
  }

  private async move(state: RunState, event: RunEvent, evidence?: unknown, blockedReason?: string): Promise<RunState> {
    const previous = state.phase;
    const next = this.machine.transition(state, event, blockedReason);
    await new EventLog(this.store.runDirectory(state.runId)).append(previous, event, evidence);
    await this.schemas.validate<RunState>("run-state", next);
    await this.store.saveState(next);
    this.progress(next.phase, `${previous} → ${next.phase}`);
    return next;
  }

  private async beginOperation(state: RunState, phase: "implementation" | "remediation"): Promise<RunState> {
    const baselineChangedFiles = await new NativeRepositoryIntegration(this.options.cwd).changedFiles();
    state.activeOperation = {
      id: `${phase}-${randomUUID().slice(0, 8)}`,
      phase,
      startedAt: new Date().toISOString(),
      baselineChangedFiles,
    };
    await this.store.saveState(state);
    await new EventLog(this.store.runDirectory(state.runId)).append(phase, "OPERATION_STARTED", state.activeOperation);
    return state;
  }

  private async recoverInterruptedOperation(state: RunState): Promise<RunState> {
    if (!state.activeOperation) return state;
    const current = await new NativeRepositoryIntegration(this.options.cwd).changedFiles();
    const baseline = new Set(state.activeOperation.baselineChangedFiles);
    const unexpected = current.filter((file) => !baseline.has(file));
    if (unexpected.length) {
      const reason = `Interrupted ${state.activeOperation.phase} operation left repository changes: ${unexpected.join(", ")}. Inspect or revert them before starting a new run.`;
      const blocked = this.machine.block(state, reason);
      await this.store.saveState(blocked);
      return blocked;
    }
    await new EventLog(this.store.runDirectory(state.runId)).append(state.phase, "OPERATION_RECOVERED", { operation: state.activeOperation.id });
    state.activeOperation = undefined;
    await this.store.saveState(state);
    return state;
  }

  private async resolveTask(task: Task): Promise<Task> {
    if (task.source !== "jira" || !task.externalReference || !this.capabilityConfig.jira) return task;
    this.policy.assertAllowed("jira.read");
    const resolved = await new JiraIntegration(this.capabilityConfig.jira, this.options.cwd).resolve(task.externalReference);
    return resolved.task;
  }

  private async repositoryEvidence(task: Task): Promise<Record<string, unknown>> {
    this.policy.assertAllowed("repository.read");
    const evidence: Record<string, unknown> = { native: await new NativeRepositoryIntegration(this.options.cwd).collect() };
    if (this.capabilityConfig.codebase) evidence.codebase = await new CodebaseIntegration(this.capabilityConfig.codebase, this.options.cwd).investigate(task);
    if (this.capabilityConfig.graphify) evidence.graphify = await new GraphifyIntegration(this.capabilityConfig.graphify, this.options.cwd).investigate(task);
    return evidence;
  }

  private async externalReview(): Promise<string | undefined> {
    const configured = this.capabilityConfig.deepReview
      ?? (this.capabilities.find((capability) => capability.name === "deep-code-review" && capability.available) ? { command: "deep-review", args: ["--changes"] } : undefined);
    if (!configured) return undefined;
    this.policy.assertAllowed("review.run");
    return new DeepCodeReviewIntegration(configured, this.options.cwd).review();
  }

  private async maybePostJira(task: Task, report: FinalReport): Promise<void> {
    if (!this.options.postJira || task.source !== "jira" || !task.externalReference || !this.capabilityConfig.jira) return;
    this.policy.assertAllowed("jira.comment");
    await new JiraIntegration(this.capabilityConfig.jira, this.options.cwd).comment(task.externalReference, report.jiraUpdate ?? report.summary);
  }

  private blockedReport(state: RunState): FinalReport {
    return {
      status: "blocked",
      summary: state.blockedReason ?? "The deterministic workflow blocked the run.",
      filesChanged: state.changedFiles,
      validation: Object.entries(state.checks).map(([name, status]) => ({ name, status, command: "See test-results.json" })),
      iterations: state.iteration,
      reviewSummary: `${state.review.blocking} blocking and ${state.review.nonBlocking} non-blocking findings recorded.`,
      decisions: [],
      remainingRisks: [state.blockedReason ?? "Unknown blocker"],
      humanReviewPoints: ["Resolve the blocker before resuming this run."],
    };
  }
}
