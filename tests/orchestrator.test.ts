import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MockProvider } from "../providers/mock.js";
import { Orchestrator } from "../runtime/orchestrator.js";
import { CheckpointStore } from "../runtime/checkpoint-store.js";
import type { ContextPackage, RunState, Task } from "../runtime/types.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("runs a schema-validated task to completion with durable artifacts", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-task-test-"));
  const task = { id: "TASK-1", source: "plain", title: "Document behavior", description: "Document behavior", acceptanceCriteria: ["Documentation exists"], constraints: [] };
  const provider = new MockProvider()
    .enqueue("requirements-analyst", task)
    .enqueue("investigator", {
      requirements: ["Document behavior"], acceptanceCriteria: task.acceptanceCriteria, relevantFiles: ["README.md"], relevantSymbols: [], architectureConstraints: [], relatedTests: [], unknowns: [], risks: [], sources: ["user request"],
    })
    .enqueue("planner", {
      summary: "Update documentation", steps: [{ id: "docs", title: "Update README", files: ["README.md"], acceptanceCriteria: task.acceptanceCriteria }], workstreams: [{ id: "docs", files: ["README.md"], stepIds: ["docs"] }], checks: [{ name: "npm availability", command: "npm", args: ["--version"] }], risks: [], acceptanceCriteriaCoverage: { "Documentation exists": ["docs"] },
    })
    .enqueue("plan-critic", { decision: "approve", issues: [] })
    .enqueue("implementer", { summary: "Updated docs", changedFiles: ["README.md"], decisions: [] })
    .enqueue("review-evaluator", { summary: "No findings", findings: [] })
    .enqueue("final-verifier", { taskSatisfied: true, acceptanceCriteria: { "Documentation exists": "verified" }, testsPassed: true, blockingFindings: 0, summary: "Verified" })
    .enqueue("finalizer", { status: "complete", summary: "Documentation completed", filesChanged: ["README.md"], validation: [{ name: "npm availability", status: "passed", command: "npm --version" }], iterations: 0, reviewSummary: "No findings", decisions: [], remainingRisks: [], humanReviewPoints: [] });

  const orchestrator = new Orchestrator(pluginRoot, {
    cwd, provider: "mock", policyName: "default", approvals: new Set(), dryRun: false, postJira: false,
  }, { provider });
  const result = await orchestrator.run("Document behavior");
  assert.equal(result.state.phase, "completed");
  assert.equal(result.report?.status, "complete");
  const persisted = JSON.parse(await readFile(path.join(cwd, ".agentic", "runs", result.state.runId, "state.json"), "utf8")) as { phase: string };
  assert.equal(persisted.phase, "completed");
});

test("resumes from the persisted phase without replaying completed stages", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-task-resume-"));
  const task: Task = { id: "TASK-RESUME", source: "plain", title: "Resume task", description: "Resume task", acceptanceCriteria: ["Run resumes"], constraints: [] };
  const context: ContextPackage = {
    requirements: ["Resume task"], acceptanceCriteria: task.acceptanceCriteria, relevantFiles: ["README.md"], relevantSymbols: [], architectureConstraints: [], relatedTests: [], unknowns: [], risks: [], sources: ["saved context"],
  };
  const now = new Date().toISOString();
  const state: RunState = {
    runId: "ATL-RESUME-0001", taskId: task.id, phase: "plan", provider: "mock", iteration: 0, reviewCycle: 0, planRevision: 0, toolCalls: 2, changedFiles: [], checks: {}, review: { blocking: 0, nonBlocking: 0 }, budget: { maxImplementationIterations: 4, maxReviewCycles: 2, maxPlanRevisions: 1, maxToolCalls: 150 }, createdAt: now, updatedAt: now,
  };
  const store = new CheckpointStore(cwd);
  await store.initialize(state, task);
  await store.writeContext(state.runId, context);

  const provider = new MockProvider()
    .enqueue("planner", { summary: "Resume plan", steps: [{ id: "resume", title: "Resume", files: ["README.md"], acceptanceCriteria: task.acceptanceCriteria }], workstreams: [{ id: "resume", files: ["README.md"], stepIds: ["resume"] }], checks: [{ name: "npm availability", command: "npm", args: ["--version"] }], risks: [], acceptanceCriteriaCoverage: { "Run resumes": ["resume"] } })
    .enqueue("plan-critic", { decision: "approve", issues: [] })
    .enqueue("implementer", { summary: "Resumed", changedFiles: ["README.md"], decisions: [] })
    .enqueue("review-evaluator", { summary: "No findings", findings: [] })
    .enqueue("final-verifier", { taskSatisfied: true, acceptanceCriteria: { "Run resumes": "verified" }, testsPassed: true, blockingFindings: 0, summary: "Verified" })
    .enqueue("finalizer", { status: "complete", summary: "Resumed run completed", filesChanged: ["README.md"], validation: [{ name: "npm availability", status: "passed", command: "npm --version" }], iterations: 0, reviewSummary: "No findings", decisions: [], remainingRisks: [], humanReviewPoints: [] });

  const orchestrator = new Orchestrator(pluginRoot, {
    cwd, provider: "mock", policyName: "default", approvals: new Set(), resumeRunId: state.runId, dryRun: false, postJira: false,
  }, { provider });
  const result = await orchestrator.run();
  assert.equal(result.state.phase, "completed");
  assert.equal(result.report?.summary, "Resumed run completed");
});
