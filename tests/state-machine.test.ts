import assert from "node:assert/strict";
import test from "node:test";
import { StateMachine, StateTransitionError, type RunEvent } from "../runtime/state-machine.js";
import type { RunState } from "../runtime/types.js";

function initialState(): RunState {
  const now = new Date().toISOString();
  return {
    runId: "ATL-TEST-0001",
    taskId: "TASK-1",
    phase: "intake",
    provider: "mock",
    iteration: 0,
    reviewCycle: 0,
    planRevision: 0,
    toolCalls: 0,
    changedFiles: [],
    checks: {},
    review: { blocking: 0, nonBlocking: 0 },
    budget: { maxImplementationIterations: 2, maxReviewCycles: 1, maxPlanRevisions: 1, maxToolCalls: 20 },
    createdAt: now,
    updatedAt: now,
  };
}

test("happy path is deterministic", () => {
  const machine = new StateMachine();
  const events: RunEvent[] = [
    "TASK_READY", "CONTEXT_READY", "INVESTIGATION_READY", "PLAN_READY", "PLAN_APPROVED",
    "IMPLEMENTED", "CHECKS_PASSED", "REVIEW_CLEAR", "VERIFIED", "FINALIZED",
  ];
  const state = events.reduce((current, event) => machine.transition(current, event), initialState());
  assert.equal(state.phase, "completed");
});

test("invalid event cannot skip a gate", () => {
  assert.throws(() => new StateMachine().transition(initialState(), "IMPLEMENTED"), StateTransitionError);
});

test("implementation remediation budget blocks a run", () => {
  const machine = new StateMachine();
  let state = initialState();
  for (const event of ["TASK_READY", "CONTEXT_READY", "INVESTIGATION_READY", "PLAN_READY", "PLAN_APPROVED", "IMPLEMENTED", "CHECKS_FAILED"] as RunEvent[]) {
    state = machine.transition(state, event);
  }
  state.iteration = state.budget.maxImplementationIterations;
  state = machine.transition(state, "DIAGNOSED_REMEDIABLE");
  assert.equal(state.phase, "blocked");
  assert.match(state.blockedReason ?? "", /budget exhausted/i);
});
