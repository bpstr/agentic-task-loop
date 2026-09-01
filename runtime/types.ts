export const phases = [
  "intake",
  "context",
  "investigation",
  "clarification",
  "awaiting_clarification",
  "plan",
  "plan_review",
  "implementation",
  "validation",
  "diagnosis",
  "remediation",
  "deep_review",
  "final_verification",
  "finalize",
  "blocked",
  "completed",
] as const;

export type Phase = (typeof phases)[number];
export type ProviderName = "codex" | "claude" | "mock";
export type ClarificationMode = "auto" | "human";
export type ActionDecision = "allow" | "allow_with_warning" | "approve" | "deny";
export type CheckStatus = "pending" | "passed" | "failed" | "blocked";
export type FailureClass =
  | "IMPLEMENTATION_DEFECT"
  | "TEST_DEFECT"
  | "ENVIRONMENT_FAILURE"
  | "DEPENDENCY_FAILURE"
  | "FLAKY_TEST"
  | "REQUIREMENT_AMBIGUITY"
  | "ARCHITECTURAL_BLOCKER";

export interface Budget {
  maxImplementationIterations: number;
  maxReviewCycles: number;
  maxPlanRevisions: number;
  maxToolCalls: number;
}

export interface Policy {
  name: string;
  budgets: Budget;
  actions: Record<string, ActionDecision>;
  commands: { allow: string[]; deny?: string[] };
}

export interface Task {
  id: string;
  source: "plain" | "jira";
  title: string;
  description: string;
  acceptanceCriteria: string[];
  constraints: string[];
  externalReference?: string;
}

export interface ContextPackage {
  requirements: string[];
  acceptanceCriteria: string[];
  relevantFiles: string[];
  relevantSymbols: string[];
  architectureConstraints: string[];
  relatedTests: string[];
  unknowns: string[];
  risks: string[];
  sources: string[];
}

export type RequirementClarity = "clear" | "ambiguous" | "conflicting" | "missing";
export type ClarificationIssueKind = "question" | "conflict" | "assumption" | "missing_information";
export type ClarificationResolutionSource = "evidence" | "policy" | "human";

export interface ClarificationRequirement {
  id: string;
  statement: string;
  status: RequirementClarity;
  evidence: string[];
  issueIds: string[];
}

export interface ClarificationResolution {
  value: string;
  source: ClarificationResolutionSource;
  rationale: string;
  confidence: number;
}

export interface ClarificationIssue {
  id: string;
  kind: ClarificationIssueKind;
  statement: string;
  blocking: boolean;
  evidence: string[];
  options: string[];
  resolution?: ClarificationResolution;
}

export interface ClarificationResult {
  summary: string;
  requirements: ClarificationRequirement[];
  issues: ClarificationIssue[];
}

export interface CheckCommand {
  name: string;
  command: string;
  args: string[];
}

export interface PlanStep {
  id: string;
  title: string;
  files: string[];
  acceptanceCriteria: string[];
}

export interface Workstream {
  id: string;
  files: string[];
  stepIds: string[];
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
  workstreams: Workstream[];
  checks: CheckCommand[];
  risks: string[];
  acceptanceCriteriaCoverage: Record<string, string[]>;
}

export interface PlanReview {
  decision: "approve" | "revise";
  issues: string[];
}

export interface Diagnosis {
  class: FailureClass;
  confidence: number;
  evidence: string;
  hypothesis: string;
  remediable: boolean;
}

export interface Finding {
  severity: "P0" | "P1" | "P2";
  title: string;
  file?: string;
  line?: number;
  evidence: string;
  recommendation: string;
}

export interface ReviewResult {
  summary: string;
  findings: Finding[];
}

export interface ImplementationResult {
  summary: string;
  changedFiles: string[];
  decisions: string[];
}

export interface VerificationResult {
  taskSatisfied: boolean;
  acceptanceCriteria: Record<string, "verified" | "unverified" | "not_applicable">;
  testsPassed: boolean;
  blockingFindings: number;
  summary: string;
}

export interface FinalReport {
  status: "complete" | "partial" | "blocked";
  summary: string;
  filesChanged: string[];
  validation: Array<{ name: string; status: CheckStatus; command: string }>;
  iterations: number;
  reviewSummary: string;
  decisions: string[];
  remainingRisks: string[];
  humanReviewPoints: string[];
  jiraUpdate?: string;
}

export type RemediationCause =
  | { type: "validation_failure"; artifact: "diagnosis.json" }
  | { type: "review_findings"; artifact: "review.json" };

export interface ActiveOperation {
  id: string;
  phase: "implementation" | "remediation";
  startedAt: string;
  baselineChangedFiles: string[];
}

export interface RunState {
  runId: string;
  taskId: string;
  phase: Phase;
  provider: ProviderName;
  clarificationMode?: ClarificationMode;
  iteration: number;
  reviewCycle: number;
  planRevision: number;
  toolCalls: number;
  changedFiles: string[];
  checks: Record<string, CheckStatus>;
  review: { blocking: number; nonBlocking: number };
  budget: Budget;
  remediationCause?: RemediationCause | undefined;
  activeOperation?: ActiveOperation | undefined;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRequest {
  role: string;
  phase: Phase;
  prompt: string;
  schemaPath: string;
  cwd: string;
  writable: boolean;
}

export interface AgentResult<T = unknown> {
  data: T;
  raw: string;
}

export interface AgentProvider {
  readonly name: ProviderName;
  runAgent<T>(request: AgentRequest): Promise<AgentResult<T>>;
  capabilities(): Promise<Record<string, boolean>>;
}

export interface CheckResult {
  name: string;
  command: string;
  args: string[];
  exitCode: number | null;
  status: Exclude<CheckStatus, "pending">;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Capability {
  name: string;
  available: boolean;
  source: "native" | "executable" | "environment" | "repository" | "configuration" | "provider";
  detail?: string;
  provider?: ProviderName;
  kind?: "provider" | "mcp-server" | "repository" | "integration";
}

export interface CapabilityCommand {
  command: string;
  args?: string[];
}

/**
 * Legacy direct command adapters. Provider-native MCP servers are discovered
 * automatically and do not need to be repeated here.
 */
export interface CapabilityConfig {
  jira?: CapabilityCommand;
  codebase?: CapabilityCommand;
  graphify?: CapabilityCommand;
  deepReview?: CapabilityCommand;
}

export interface RunOptions {
  cwd: string;
  provider: ProviderName | "auto";
  policyName: string;
  approvals: Set<string>;
  resumeRunId?: string;
  clarificationMode?: ClarificationMode;
  clarificationAnswers?: Record<string, string>;
  dryRun: boolean;
  postJira: boolean;
}
