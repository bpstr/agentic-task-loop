import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MockProvider } from "../providers/mock.js";
import { Orchestrator } from "../runtime/orchestrator.js";
import { CheckpointStore } from "../runtime/checkpoint-store.js";
import type { ClarificationResult, ContextPackage, RunState, Task } from "../runtime/types.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function clearClarification(statement: string): ClarificationResult {
  return {
    summary: "Requirements are sufficiently clear for planning.",
    requirements: [{ id: "REQ-1", statement, status: "clear", evidence: ["task"], issueIds: [] }],
    issues: [],
  };
}

function queueCompletion(provider: MockProvider, task: Task, planSummary = "Update documentation"): MockProvider {
  return provider
    .enqueue("planner", {
      summary: planSummary,
      steps: [{ id: "docs", title: "Update README", files: ["README.md"], acceptanceCriteria: task.acceptanceCriteria }],
      workstreams: [{ id: "docs", files: ["README.md"], stepIds: ["docs"] }],
      checks: [{ name: "npm availability", command: "npm", args: ["--version"] }],
      risks: [],
      acceptanceCriteriaCoverage: Object.fromEntries(task.acceptanceCriteria.map((criterion) => [criterion, ["docs"]])),
    })
    .enqueue("plan-critic", { decision: "approve", issues: [] })
    .enqueue("implementer", { summary: "Updated docs", changedFiles: ["README.md"], decisions: [] })
    .enqueue("review-evaluator", { summary: "No findings", findings: [] })
    .enqueue("final-verifier", {
      taskSatisfied: true,
      acceptanceCriteria: Object.fromEntries(task.acceptanceCriteria.map((criterion) => [criterion, "verified"])),
      testsPassed: true,
      blockingFindings: 0,
      summary: "Verified",
    })
    .enqueue("finalizer", {
      status: "complete",
      summary: "Task completed",
      filesChanged: ["README.md"],
      validation: [{ name: "npm availability", status: "passed", command: "npm --version" }],
      iterations: 0,
      reviewSummary: "No findings",
      decisions: [],
      remainingRisks: [],
      humanReviewPoints: [],
    });
}

test("runs a schema-validated task through clarification to completion", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-task-test-"));
  const task: Task = { id: "TASK-1", source: "plain", title: "Document behavior", description: "Document behavior", acceptanceCriteria: ["Documentation exists"], constraints: [] };
  const provider = new MockProvider()
    .enqueue("requirements-analyst", task)
    .enqueue("investigator", {
      requirements: ["Document behavior"], acceptanceCriteria: task.acceptanceCriteria, relevantFiles: ["README.md"], relevantSymbols: [], architectureConstraints: [], relatedTests: [], unknowns: [], risks: [], sources: ["user request"],
    })
    .enqueue("clarifier", clearClarification("Document behavior"));
  queueCompletion(provider, task);

  const orchestrator = new Orchestrator(pluginRoot, {
    cwd, provider: "mock", policyName: "default", approvals: new Set(), clarificationMode: "auto", dryRun: false, postJira: false,
  }, { provider });
  const result = await orchestrator.run("Document behavior");
  assert.equal(result.state.phase, "completed");
  assert.equal(result.report?.status, "complete");
  assert.equal(result.clarification?.issues.length, 0);
  const persisted = JSON.parse(await readFile(path.join(cwd, ".agentic", "runs", result.state.runId, "state.json"), "utf8")) as { phase: string };
  assert.equal(persisted.phase, "completed");
});

test("auto clarification blocks instead of guessing a blocking requirement", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-task-auto-clarification-"));
  const task: Task = { id: "TASK-AUTO", source: "plain", title: "Add export", description: "Add export", acceptanceCriteria: [], constraints: [] };
  const provider = new MockProvider()
    .enqueue("requirements-analyst", task)
    .enqueue("investigator", {
      requirements: ["Add export"], acceptanceCriteria: [], relevantFiles: [], relevantSymbols: [], architectureConstraints: [], relatedTests: [], unknowns: ["Export format"], risks: [], sources: ["task"],
    })
    .enqueue("clarifier", {
      summary: "Export format is unspecified.",
      requirements: [{ id: "REQ-1", statement: "Add export", status: "ambiguous", evidence: ["task"], issueIds: ["Q-1"] }],
      issues: [{ id: "Q-1", kind: "question", statement: "Which export format is required?", blocking: true, evidence: ["No format specified"], options: ["CSV", "JSON"] }],
    });

  const result = await new Orchestrator(pluginRoot, {
    cwd, provider: "mock", policyName: "default", approvals: new Set(), clarificationMode: "auto", dryRun: false, postJira: false,
  }, { provider }).run("Add export");

  assert.equal(result.state.phase, "blocked");
  assert.match(result.state.blockedReason ?? "", /Q-1/);
  assert.equal(result.clarification?.issues[0]?.resolution, undefined);
});

test("human clarification pauses durably and resumes with explicit answers", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-task-human-clarification-"));
  const task: Task = { id: "TASK-HUMAN", source: "plain", title: "Add export", description: "Add export", acceptanceCriteria: ["Export is available"], constraints: [] };
  const unresolved = {
    summary: "Export format requires a product decision.",
    requirements: [{ id: "REQ-1", statement: "Add export", status: "ambiguous", evidence: ["task"], issueIds: ["Q-1"] }],
    issues: [{ id: "Q-1", kind: "question", statement: "Which export format is required?", blocking: true, evidence: ["No format specified"], options: ["CSV", "JSON"] }],
  } satisfies ClarificationResult;
  const provider = new MockProvider()
    .enqueue("requirements-analyst", task)
    .enqueue("investigator", {
      requirements: ["Add export"], acceptanceCriteria: task.acceptanceCriteria, relevantFiles: [], relevantSymbols: [], architectureConstraints: [], relatedTests: [], unknowns: ["Export format"], risks: [], sources: ["task"],
    })
    .enqueue("clarifier", unresolved)
    .enqueue("clarifier", unresolved);
  queueCompletion(provider, task, "Implement CSV export");

  const first = await new Orchestrator(pluginRoot, {
    cwd, provider: "mock", policyName: "default", approvals: new Set(), clarificationMode: "human", dryRun: false, postJira: false,
  }, { provider }).run("Add export");

  assert.equal(first.state.phase, "awaiting_clarification");
  assert.equal(first.clarification?.issues[0]?.id, "Q-1");
  assert.equal(first.report, undefined);

  const resumed = await new Orchestrator(pluginRoot, {
    cwd,
    provider: "mock",
    policyName: "default",
    approvals: new Set(),
    resumeRunId: first.state.runId,
    clarificationAnswers: { "Q-1": "CSV" },
    dryRun: false,
    postJira: false,
  }, { provider }).run();

  assert.equal(resumed.state.phase, "completed");
  assert.equal(resumed.clarification?.issues[0]?.resolution?.source, "human");
  assert.equal(resumed.clarification?.issues[0]?.resolution?.value, "CSV");
});

test("resumes from the persisted plan phase without replaying completed stages", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-task-resume-"));
  const task: Task = { id: "TASK-RESUME", source: "plain", title: "Resume task", description: "Resume task", acceptanceCriteria: ["Run resumes"], constraints: [] };
  const context: ContextPackage = {
    requirements: ["Resume task"], acceptanceCriteria: task.acceptanceCriteria, relevantFiles: ["README.md"], relevantSymbols: [], architectureConstraints: [], relatedTests: [], unknowns: [], risks: [], sources: ["saved context"],
  };
  const clarification = clearClarification("Resume task");
  const now = new Date().toISOString();
  const state: RunState = {
    runId: "ATL-RESUME-0001", taskId: task.id, phase: "plan", provider: "mock", clarificationMode: "auto", iteration: 0, reviewCycle: 0, planRevision: 0, toolCalls: 3, changedFiles: [], checks: {}, review: { blocking: 0, nonBlocking: 0 }, budget: { maxImplementationIterations: 4, maxReviewCycles: 2, maxPlanRevisions: 1, maxToolCalls: 150 }, createdAt: now, updatedAt: now,
  };
  const store = new CheckpointStore(cwd);
  await store.initialize(state, task);
  await store.writeContext(state.runId, context);
  await store.writeJson(state.runId, "clarification.json", clarification);

  const provider = new MockProvider();
  queueCompletion(provider, task, "Resume plan");

  const orchestrator = new Orchestrator(pluginRoot, {
    cwd, provider: "mock", policyName: "default", approvals: new Set(), resumeRunId: state.runId, dryRun: false, postJira: false,
  }, { provider });
  const result = await orchestrator.run();
  assert.equal(result.state.phase, "completed");
  assert.equal(result.report?.summary, "Task completed");
});
