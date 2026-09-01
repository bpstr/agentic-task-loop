import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StateMachine, type RunEvent } from "../runtime/state-machine.js";
import type { Phase, RunState } from "../runtime/types.js";

interface Scenario {
  name: string;
  events: RunEvent[];
  expectedPhase: Phase;
}

function initialState(name: string): RunState {
  const now = new Date().toISOString();
  return {
    runId: `ATL-EVAL-${name.replaceAll(/[^A-Za-z0-9-]/g, "-")}`,
    taskId: name,
    phase: "intake",
    provider: "mock",
    iteration: 0,
    reviewCycle: 0,
    planRevision: 0,
    toolCalls: 0,
    changedFiles: [],
    checks: {},
    review: { blocking: 0, nonBlocking: 0 },
    budget: { maxImplementationIterations: 4, maxReviewCycles: 2, maxPlanRevisions: 1, maxToolCalls: 150 },
    createdAt: now,
    updatedAt: now,
  };
}

async function main(): Promise<void> {
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const fixtures = path.join(pluginRoot, "evals", "fixtures");
  const filenames = (await readdir(fixtures)).filter((filename) => filename.endsWith(".json")).sort();
  const machine = new StateMachine();
  const results = [];

  for (const filename of filenames) {
    const scenario = JSON.parse(await readFile(path.join(fixtures, filename), "utf8")) as Scenario;
    const state = scenario.events.reduce((current, event) => machine.transition(current, event), initialState(scenario.name));
    results.push({ name: scenario.name, phase: state.phase, expected: scenario.expectedPhase, passed: state.phase === scenario.expectedPhase });
  }

  const passed = results.filter((result) => result.passed).length;
  const summary = { scenarios: results.length, passed, passRate: results.length ? passed / results.length : 0, results };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
