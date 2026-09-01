import type { Phase, RunState } from "./types.js";

export type RunEvent =
  | "TASK_READY"
  | "CONTEXT_READY"
  | "INVESTIGATION_READY"
  | "PLAN_READY"
  | "PLAN_APPROVED"
  | "PLAN_REVISE"
  | "IMPLEMENTED"
  | "CHECKS_PASSED"
  | "CHECKS_FAILED"
  | "DIAGNOSED_REMEDIABLE"
  | "DIAGNOSED_BLOCKED"
  | "REMEDIATED"
  | "REVIEW_CLEAR"
  | "REVIEW_P1"
  | "REVIEW_P0"
  | "VERIFIED"
  | "VERIFICATION_FAILED"
  | "FINALIZED";

const transitions: Record<Phase, Partial<Record<RunEvent, Phase>>> = {
  intake: { TASK_READY: "context" },
  context: { CONTEXT_READY: "investigation" },
  investigation: { INVESTIGATION_READY: "plan" },
  plan: { PLAN_READY: "plan_review" },
  plan_review: { PLAN_APPROVED: "implementation", PLAN_REVISE: "plan" },
  implementation: { IMPLEMENTED: "validation" },
  validation: { CHECKS_PASSED: "deep_review", CHECKS_FAILED: "diagnosis" },
  diagnosis: { DIAGNOSED_REMEDIABLE: "remediation", DIAGNOSED_BLOCKED: "blocked" },
  remediation: { REMEDIATED: "validation" },
  deep_review: { REVIEW_CLEAR: "final_verification", REVIEW_P1: "remediation", REVIEW_P0: "blocked" },
  final_verification: { VERIFIED: "finalize", VERIFICATION_FAILED: "blocked" },
  finalize: { FINALIZED: "completed" },
  blocked: {},
  completed: {},
};

export class StateTransitionError extends Error {}

export class StateMachine {
  transition(state: RunState, event: RunEvent, blockedReason?: string): RunState {
    const next = transitions[state.phase][event];
    if (!next) {
      throw new StateTransitionError(`Event ${event} is invalid during ${state.phase}`);
    }

    if (event === "PLAN_REVISE" && state.planRevision >= state.budget.maxPlanRevisions) {
      return this.block(state, "Plan revision budget exhausted");
    }
    if (event === "DIAGNOSED_REMEDIABLE" && state.iteration >= state.budget.maxImplementationIterations) {
      return this.block(state, "Implementation remediation budget exhausted");
    }
    if (event === "REVIEW_P1" && state.reviewCycle >= state.budget.maxReviewCycles) {
      return this.block(state, "Review remediation budget exhausted");
    }
    if (state.toolCalls > state.budget.maxToolCalls) {
      return this.block(state, "Tool-call budget exhausted");
    }

    const now = new Date().toISOString();
    return {
      ...state,
      phase: next,
      planRevision: event === "PLAN_REVISE" ? state.planRevision + 1 : state.planRevision,
      iteration: event === "DIAGNOSED_REMEDIABLE" ? state.iteration + 1 : state.iteration,
      reviewCycle: event === "REVIEW_P1" ? state.reviewCycle + 1 : state.reviewCycle,
      ...(next === "blocked" ? { blockedReason: blockedReason ?? "Run blocked by policy or evidence" } : {}),
      updatedAt: now,
    };
  }

  block(state: RunState, reason: string): RunState {
    return { ...state, phase: "blocked", blockedReason: reason, updatedAt: new Date().toISOString() };
  }
}
