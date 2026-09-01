# Agentic Task Loop

Agentic Task Loop is a provider-neutral orchestration runtime for software-development agents. It runs Codex or Claude inside deterministic lifecycle stages, persists evidence after every gate, executes validation commands directly, enforces policy and retry budgets, and produces a resumable audit trail.

It is packaged as a plugin containing related skills, which follows the current [OpenAI plugin architecture](https://learn.chatgpt.com/docs/build-plugins): plugins can bundle skills and connected capabilities, while individual skills remain focused reusable workflows.

The central rule is:

> The runtime decides what may happen next. The model reasons only inside the current stage.

This repository is an executable MVP, not only a prompt collection.

## Architecture

```text
Task or Jira ticket
        │
        ▼
┌───────────────────────────┐
│ Deterministic orchestrator│
│ state · policy · budgets  │
└─────────────┬─────────────┘
              │
     ┌────────┼─────────┐
     ▼        ▼         ▼
 Requirements  Repository  Capability
 analyst       investigator discovery
     └────────┬─────────┘
              ▼
        Context package
              ▼
       Planner → critic
              ▼
       Approved workstreams
              ▼
     Implementer worker(s)
              ▼
   Deterministic checks ────────┐
       │ pass       │ fail      │
       ▼            ▼           │
   Deep review   Diagnostician  │
       │            ▼           │
       │        Remediation ────┘
       ▼
 P0 stop · P1 remediate · P2 record
              ▼
       Final verifier
              ▼
       Human handoff
              ▼
   Optional policy-gated Jira comment
```

## What is implemented

| Component | Responsibility |
| --- | --- |
| State machine | Allows only explicit lifecycle transitions and prevents stage skipping |
| Checkpoint store | Atomically persists run state and stage artifacts under `.agentic/runs/` |
| Policy engine | Enforces action decisions, approvals, command allowlists, and iteration budgets |
| Schema registry | Validates model output with JSON Schema Draft 2020-12 and Ajv |
| Capability discovery | Detects providers, repository tools, Graphify state, Jira wrappers, and Deep Code Review |
| Scheduler | Parallelizes implementation only when declared file ownership is disjoint |
| Check runner | Executes command plus argument arrays without a shell and records exit evidence |
| Provider adapters | Runs Codex or Claude non-interactively with structured output contracts |
| Integration adapters | Supports command-backed Jira, codebase, Graphify, and Deep Code Review capabilities |
| Skills and agent roles | Keep orchestration, investigation, planning, implementation, verification, remediation, and finalization separate |
| Evals | Exercise success, environment-block, and review-remediation control paths |

## Deterministic lifecycle

```text
INTAKE
  → CONTEXT
  → INVESTIGATION
  → PLAN
  → PLAN_REVIEW
  → IMPLEMENTATION
  → VALIDATION
```

Validation controls the next phase:

```text
checks pass   → DEEP_REVIEW
checks fail   → DIAGNOSIS
remediable    → REMEDIATION → VALIDATION
not remediable→ BLOCKED
```

Review controls the final gate:

```text
P0 present → BLOCKED for human intervention
P1 present → REMEDIATION → VALIDATION → DEEP_REVIEW
P2 only    → FINAL_VERIFICATION
clear      → FINAL_VERIFICATION
verified   → FINALIZE → COMPLETED
```

Invalid transitions throw instead of asking the model what to do next. Plan revisions, implementation remediation, review remediation, and provider/tool calls each have independent budgets.

## Persistent execution state

Every run creates:

```text
.agentic/runs/ATL-<date>-<id>/
├── state.json
├── task.json
├── context.json
├── plan.json
├── plan-review.json
├── implementation.json
├── test-results.json
├── diagnosis.json
├── remediation-<iteration>-<review-cycle>.json
├── review.json
├── verification.json
├── decisions.jsonl
├── final-report.json
└── final.md
```

Artifacts appear only after their stage completes. `state.json` is the authoritative phase, counter, budget, check, and blocking state. `decisions.jsonl` records transition evidence. Resume starts from the persisted phase rather than replaying completed work.

## Requirements

- Node.js 20 or newer
- Git
- At least one authenticated provider CLI:
  - `codex`
  - `claude`

Optional integrations require a local command wrapper or executable. The runtime itself does not require Jira, Graphify, codebase-mcp, or Deep Code Review.

## Install for local development

```bash
git clone https://github.com/bpstr/agentic-task-loop.git
cd agentic-task-loop
npm install
npm run build
npm link
```

`npm link` makes the `agentic-task` CLI available locally.

### Codex skill

Link the user-facing orchestration skill into the local skills directory:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/agentic-task" ~/.codex/skills/agentic-task
```

The distributable plugin manifest is [.codex-plugin/plugin.json](.codex-plugin/plugin.json). It exposes all packaged skills under `skills/`.

### Claude Code plugin

```bash
claude plugin marketplace add bpstr/agentic-task-loop
claude plugin install agentic-task-loop@agentic-task-loop
```

During local development, pass the checkout path to `claude plugin marketplace add` instead of the GitHub slug.

## Use

Run a plain development task:

```bash
agentic-task "Implement notification preferences"
```

Resolve a Jira-style reference when Jira is configured:

```bash
agentic-task PROJ-142
```

Choose a provider or policy:

```bash
agentic-task --provider claude --policy strict "Fix checkout retries"
agentic-task --provider codex --policy autonomous "Add audit logging"
```

Inspect capabilities without starting a run:

```bash
agentic-task --dry-run --provider auto
```

Resume after interruption:

```bash
agentic-task --resume ATL-20260901-a1b2c3d4
```

From Codex, the orchestration skill remains a simple entrypoint:

```text
$agentic-task implement notification preferences
```

Claude Code can invoke the equivalent `/agentic-task` skill.

## Policies and authority

Three policies ship with the runtime:

| Policy | Implementation cycles | Review cycles | Character |
| --- | ---: | ---: | --- |
| `strict` | 2 | 1 | Repository writes require approval; dependency installation is denied |
| `default` | 4 | 2 | Normal edits and tests allowed; external writes and Git mutations require approval |
| `autonomous` | 6 | 2 | Wider local iteration budget; external writes and Git mutations still require approval |

Every action resolves to one of four decisions:

- `allow`: execute;
- `allow_with_warning`: permit the action while returning a warning decision to the caller;
- `approve`: require `--approve <action>`;
- `deny`: stop regardless of model output.

Example:

```bash
agentic-task \
  --policy default \
  --post-jira \
  --approve jira.comment \
  PROJ-142
```

Jira posting requires both `--post-jira` and policy authorization. Closing tickets, transitions, commits, pushes, deployments, and production shells are separate policy actions and are never implied.

## Capability discovery

Create `.agentic/capabilities.json` in the target repository to connect command-backed integrations:

```json
{
  "jira": {
    "command": "jira-mcp-client",
    "args": ["invoke"]
  },
  "codebase": {
    "command": "codebase-client",
    "args": ["query"]
  },
  "graphify": {
    "command": "graphify",
    "args": ["query", "--json"]
  },
  "deepReview": {
    "command": "/absolute/path/to/deep-review.sh",
    "args": ["--changes"]
  }
}
```

Commands receive a final JSON argument describing the requested operation. Jira, codebase, and Graphify wrappers must return JSON. Deep Code Review may return text; the review evaluator normalizes and verifies its findings.

Environment fallbacks are also supported:

```text
JIRA_MCP_COMMAND
CODEBASE_MCP_COMMAND
GRAPHIFY_COMMAND
DEEP_REVIEW_COMMAND
```

Without configured graph integrations, investigation uses repository-native tools through the selected provider. Without Deep Code Review, the review evaluator performs a change-scoped review directly.

## Providers

Both providers implement the same runtime interface:

```ts
interface AgentProvider {
  runAgent<T>(request: AgentRequest): Promise<AgentResult<T>>;
  capabilities(): Promise<Record<string, boolean>>;
}
```

The Codex adapter uses `codex exec`, ephemeral sessions, a read-only or workspace-write sandbox, and `--output-schema`. The Claude adapter uses non-interactive print mode, plan or edit permissions, and `--json-schema`. The runtime validates both providers' output again with Ajv before accepting evidence or transitioning.

`--provider auto` prefers Codex when both executables are available, then falls back to Claude.

## Skills and reasoning roles

The plugin packages focused stage skills:

```text
skills/
├── agentic-task/  user-facing runtime entrypoint
├── investigate/   context construction
├── plan/          planning and plan criticism
├── implement/     owned workstream execution
├── verify/        review and final verification
├── remediate/     failure classification and correction
└── finalize/      human handoff
```

Stage skills are explicit-only and are loaded by the runtime. Specialized role prompts add the narrower responsibility for investigator, requirements analyst, planner, plan critic, implementer, test diagnostician, remediation agent, review evaluator, final verifier, and finalizer.

The skill is the reusable behavior contract. The role prompt is the specialist overlay. The runtime combines both with untrusted JSON input and a required output schema.

## Structured evidence

The main schemas cover:

- normalized task;
- context package;
- implementation plan and workstream ownership;
- P0/P1/P2 findings;
- diagnosis class and confidence;
- implementation evidence;
- final verification;
- durable run state;
- human handoff.

Validation commands are represented as:

```json
{
  "name": "unit tests",
  "command": "npm",
  "args": ["test"]
}
```

They execute with `shell: false`. The policy allowlist checks the complete display command before execution. Model prose cannot turn a failed exit code into a pass.

## Failure classification

The diagnostician must choose one class:

```text
IMPLEMENTATION_DEFECT
TEST_DEFECT
ENVIRONMENT_FAILURE
DEPENDENCY_FAILURE
FLAKY_TEST
REQUIREMENT_AMBIGUITY
ARCHITECTURAL_BLOCKER
```

Only evidence-backed implementation, test, or flaky-test failures enter automatic remediation. Environment, dependency, ambiguity, and architecture failures block rather than encouraging unrelated code changes.

## Deep Code Review

[Deep Code Review](https://github.com/bpstr/deep-code-review) is an optional evaluator stage after deterministic checks pass. Its P0/P1/P2 output feeds runtime policy:

- P0 blocks for human intervention;
- P1 enters a bounded remediation cycle;
- P2 is retained for human review;
- remediation reruns validation and then review;
- `maxReviewCycles` prevents an infinite loop.

## Tests and evals

Run the full local check:

```bash
npm run check
```

Or run components separately:

```bash
npm run build
npm test
npm run eval
```

The current automated suite covers:

- happy-path lifecycle completion;
- invalid-transition rejection;
- remediation budget exhaustion;
- policy approvals and command allowlists;
- disjoint-workstream scheduling;
- JSON Schema validation;
- an end-to-end durable run with a deterministic mock provider;
- resume from a persisted mid-run phase without replaying completed stages.

The eval fixtures exercise three state-machine scenarios: simple completion, environment failure, and review remediation. They prove control-flow invariants only; they are not yet evidence of model-quality improvement. Add repository-backed task fixtures before publishing comparative completion-rate claims.

## Repository structure

```text
agentic-task-loop/
├── .codex-plugin/       Codex manifest
├── .claude-plugin/      Claude manifest and marketplace
├── agents/              specialist role prompts
├── bin/                 CLI entrypoint
├── evals/               deterministic fixtures and runner
├── integrations/        optional capability adapters
├── policies/            strict, default, and autonomous authority profiles
├── providers/           Codex, Claude, and mock adapters
├── runtime/             state machine, orchestration, policy, storage, scheduler
├── schemas/             structured evidence contracts
├── skills/              orchestration and stage skills
└── tests/               deterministic unit and integration tests
```

## Security and operational boundaries

- Repository, ticket, review, and provider output is treated as untrusted data.
- Read-only stages use provider read-only or plan modes.
- Implementation stages use workspace-scoped edit modes.
- Validation commands execute without a shell.
- External writes require distinct flags and policy authorization.
- State paths and policy names are validated before filesystem access.
- Provider subprocesses inherit the local environment; run them only in repositories you trust.
- `.agentic/` is ignored by Git because it may contain ticket context and detailed execution evidence.

## Current limitations

- MCP integrations use explicit local command wrappers; the runtime does not yet implement a general MCP transport client.
- Runtime policy directly governs orchestrator-owned actions; tool calls made inside a provider process remain governed by that provider's sandbox and permission system.
- Workstream isolation is planned and prompted, but the runtime does not yet reject an agent process that edits outside its declared ownership.
- The event log is local JSONL rather than OpenTelemetry.
- Evals currently verify orchestration behavior, not comparative coding quality, cost, or token usage.
- Provider adapters require locally authenticated CLIs and may incur model usage.
- Resume assumes the target repository and provider environment remain compatible with the saved run.

These are deliberate boundaries for the executable MVP and the next concrete areas for hardening.
