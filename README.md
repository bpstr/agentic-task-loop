# Agentic Task Loop

Agentic Task Loop is a provider-neutral orchestration runtime for autonomous software-development tasks. It runs Codex or Claude inside deterministic lifecycle stages, persists evidence after every gate, reconciles requirements before planning, enforces policy and retry budgets, validates changes with real commands, isolates parallel workers, and produces a resumable audit trail.

The central rule is:

> The runtime decides what may happen next. The model reasons and uses tools only inside the current stage.

This repository is an executable agent harness, not a prompt collection.

## Architecture

```text
Task / ticket
    │
    ▼
Capability discovery
    │
    ├── Codex + globally configured MCP servers
    ├── Claude + globally configured MCP servers
    └── native repository / optional runtime adapters
    │
    ▼
Requirements analyst
    ▼
Repository + MCP investigation
    ▼
Clarification gate
    │
    ├── clear / evidence-resolved ───────────────┐
    ├── human mode → awaiting clarification      │
    └── auto unresolved blocker → blocked        │
                                                 ▼
                                      Planner → plan critic
                                                 ▼
                                      Approved workstreams
                              ┌──────────────────┼──────────────────┐
                              ▼                  ▼                  ▼
                         worker A           worker B           worker C
                         worktree A         worktree B         worktree C
                              └──────────────────┼──────────────────┘
                                                 ▼
                                  Ownership check + patch integration
                                                 ▼
                                      Deterministic validation
                                                 │
                              failed → diagnosis → remediation → validation
                                                 │
                                               passed
                                                 ▼
                                            deep review
                                                 │
                              P0 → blocked · P1 → remediation
                                                 │
                                            clear / P2
                                                 ▼
                                        final verification
                                                 ▼
                                              finalize
```

## What is implemented

| Component | Responsibility |
| --- | --- |
| State machine | Allows only explicit lifecycle transitions and bounded retry paths |
| Checkpoint store | Persists run state and stage artifacts under `.agentic/runs/` |
| Clarification gate | Maps requirements, detects ambiguity/conflicts, and prevents planning against unresolved blocking questions |
| Operation journal state | Detects interrupted writable stages before unsafe replay |
| Policy engine | Enforces actions, approvals, safe validation commands, and budgets |
| Schema registry | Validates model output with JSON Schema and Ajv |
| Capability discovery | Finds providers and their already configured MCP servers automatically |
| Scheduler | Parallelizes only declared disjoint workstreams |
| Worktree manager | Gives parallel workers isolated Git worktrees and enforces actual file ownership |
| Check runner | Executes deterministic validation without a shell |
| Provider adapters | Runs Codex or Claude with structured output contracts |
| Specialist agents | Separate requirements, investigation, clarification, planning, implementation, remediation, review, verification, and finalization |
| Evals + tests | Exercise lifecycle paths, clarification, policy bypasses, capability parsing, resume, and worktree isolation |

## Install

```bash
git clone https://github.com/bpstr/agentic-task-loop.git
cd agentic-task-loop
npm install
npm run build
npm link
```

Requirements:

- Node.js 20+
- Git
- authenticated `codex` and/or `claude` CLI

### Codex skill

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/agentic-task" ~/.codex/skills/agentic-task
```

### Claude Code plugin

```bash
claude plugin marketplace add bpstr/agentic-task-loop
claude plugin install agentic-task-loop@agentic-task-loop
```

## Use

Automatic clarification is the default behavior:

```bash
agentic-task "Implement notification preferences"
agentic-task PROJ-142
agentic-task --provider claude --policy strict "Fix checkout retries"
agentic-task --provider codex --policy autonomous "Add audit logging"
```

Require a human decision before planning whenever a blocking question cannot be established from evidence:

```bash
agentic-task --clarification human "Add data export"
```

A paused run returns `phase: "awaiting_clarification"` and the structured clarification artifact. Resume it with stable issue IDs:

```bash
agentic-task \
  --resume ATL-20260901-a1b2c3d4 \
  --answer 'Q-1=CSV' \
  --answer 'Q-2=Keep the existing public API'
```

Answers are persisted and can be accumulated across multiple clarification rounds.

Inspect what the runtime can use without starting a task:

```bash
agentic-task --dry-run --provider auto
```

Resume any other interrupted run:

```bash
agentic-task --resume ATL-20260901-a1b2c3d4
```

From Codex:

```text
$agentic-task implement notification preferences
```

Claude Code can invoke the equivalent packaged skill.

## Clarification before planning

Investigation intentionally does **not** flow directly into planning. The clarification specialist first reconciles:

- normalized task requirements and acceptance criteria;
- information discovered from repository code, tests, history, and instructions;
- authoritative information available through inherited MCP tools;
- architecture and compatibility constraints;
- previous clarification decisions and human answers.

The resulting `clarification.json` is a structured requirement contract. Each requirement is classified as:

```text
clear
ambiguous
conflicting
missing
```

Clarification issues record:

- stable issue ID;
- question / conflict / assumption / missing-information type;
- whether it blocks planning;
- supporting evidence;
- candidate options;
- an optional resolution with source, rationale, and confidence.

Resolution sources are explicit:

```text
evidence
policy
human
```

### Auto mode

`--clarification auto` allows the clarifier to resolve implementation questions only when repository/MCP evidence or policy clearly supports the resolution. It must not invent product behavior, security tradeoffs, compatibility promises, destructive behavior, or public API semantics.

If a blocking issue remains unresolved, the deterministic runtime transitions to `blocked` rather than letting the planner guess.

### Human mode

`--clarification human` still resolves objectively answerable questions from evidence, but genuine decision-dependent blockers cause a durable `awaiting_clarification` pause.

Human answers are stored separately in `clarification-answers.json`, supplied back into the clarifier on resume, and deterministically overlaid onto the matching stable issue IDs as human resolutions.

Planning, plan review, and final verification all receive the completed clarification contract. Resolved decisions therefore remain traceable through implementation instead of disappearing into conversational context.

## MCP tools are inherited automatically

You should not configure Jira, Atlassian, Linear, GitHub, documentation servers, code-intelligence MCPs, or other MCP servers a second time for Agentic Task Loop.

The runtime discovers the tools already configured for the selected provider:

### Codex

Typical sources:

```text
~/.codex/config.toml
$CODEX_HOME/config.toml
<repo>/.codex/config.toml
codex mcp list
```

### Claude Code

Typical sources:

```text
~/.claude.json
<repo>/.mcp.json
claude mcp list
```

Discovered tools are attached to the matching provider as capabilities. The provider continues to own authentication, OAuth sessions, secrets, and the actual MCP connection. Agentic Task Loop does not copy credentials.

For example, if Jira/Atlassian is already configured in Codex and the task is `PROJ-142`, the requirements analyst, investigator, and clarifier can use that MCP directly to read authoritative task context. No `.agentic/capabilities.json` entry is required.

`--provider auto` also considers discovered tools. For ticket-like tasks it prefers an available provider that already exposes a matching issue-tracker MCP.

### Optional runtime adapters

`.agentic/capabilities.json` still exists, but it is an escape hatch for commands the deterministic runtime itself must invoke or for integrations that are not registered with the provider.

```json
{
  "jira": { "command": "jira-mcp-client", "args": ["invoke"] },
  "codebase": { "command": "codebase-client", "args": ["query"] },
  "graphify": { "command": "graphify", "args": ["query", "--json"] },
  "deepReview": { "command": "/path/to/deep-review.sh", "args": ["--changes"] }
}
```

These adapters are optional compatibility hooks, not the normal MCP setup path.

See [`skills/agentic-task/references/integrations.md`](skills/agentic-task/references/integrations.md) for the full capability and authority model.

## Deterministic lifecycle

```text
INTAKE
  → CONTEXT
  → INVESTIGATION
  → CLARIFICATION
      ├── ready → PLAN
      ├── human needed → AWAITING_CLARIFICATION → CLARIFICATION
      └── auto unresolved → BLOCKED
  → PLAN_REVIEW
  → IMPLEMENTATION
  → VALIDATION
```

Validation controls the next edge:

```text
pass → DEEP_REVIEW
fail → DIAGNOSIS
       ├── remediable → REMEDIATION → VALIDATION
       └── blocked    → BLOCKED
```

Review controls the final gate:

```text
P0 → BLOCKED
P1 → REMEDIATION → VALIDATION → DEEP_REVIEW
P2 / clear → FINAL_VERIFICATION
verified → FINALIZE → COMPLETED
```

The model never chooses an arbitrary next lifecycle state.

## Safe parallel workers

The planner may declare independent workstreams. Parallel execution happens only when their declared file ownership is disjoint and the main checkout is clean.

Each worker receives a disposable detached Git worktree. After the worker finishes, the runtime inspects the files it actually changed. If it touched anything outside its declared ownership, the workstream is rejected instead of being merged.

Successful workstreams produce patches that are integrated back into the main checkout before whole-repository validation.

If existing user changes are present, the runtime falls back to a single worker rather than silently creating clean worktrees that omit those edits.

## Durable resume

Every run creates a directory similar to:

```text
.agentic/runs/ATL-<date>-<id>/
├── state.json
├── task.json
├── context.json
├── clarification.json
├── clarification-answers.json      # when supplied
├── plan.json
├── plan-review.json
├── implementation.json
├── test-results.json
├── diagnosis.json
├── remediation-*.json
├── review.json
├── verification.json
├── decisions.jsonl
├── final-report.json
└── final.md
```

Completed phases are not replayed on resume. `awaiting_clarification` is also resumable and is not treated as a failed run.

Writable implementation/remediation stages additionally persist an active-operation marker before edits start. If a process dies after changing the repository but before completing the stage, resume compares the current working tree with the recorded baseline. Unexpected changes block the run for inspection instead of blindly invoking the writer again.

## Policies and authority

Three policy profiles ship with the runtime:

| Policy | Character |
| --- | --- |
| `strict` | Minimal mutation, repository writes require approval, dependency installation denied |
| `default` | Normal local edits/checks, external and Git mutations require explicit authority |
| `autonomous` | Larger local retry budget while deployment/external authority remains bounded |

Actions resolve to:

```text
allow
allow_with_warning
approve
deny
```

Discovery does **not** imply authority. Finding a Jira MCP does not grant permission to comment, transition, or close a ticket. Finding GitHub does not grant permission to push. Deployments remain independently denied unless a policy explicitly permits them.

Validation commands are intentionally narrower than arbitrary executable access. Test/check/build-shaped commands are allowed according to policy; package execution, deployment/release scripts, pushes, destructive infrastructure commands, and similar policy bypasses are rejected even when their parent executable would otherwise be familiar.

## Provider model

Both providers implement the same runtime contract:

```ts
interface AgentProvider {
  runAgent<T>(request: AgentRequest): Promise<AgentResult<T>>;
  capabilities(): Promise<Record<string, boolean>>;
}
```

Codex and Claude receive schema-bound stage prompts. The runtime validates provider output again before accepting an artifact or moving the state machine.

Provider-native MCP servers remain available through the provider's own global/project configuration, so the agent can use its existing tool ecosystem without Agentic Task Loop recreating it.

## Development

```bash
npm run build
npm test
npm run eval
npm run check
```

`npm run check` runs the complete test and eval suite. GitHub Actions runs it for pushes and pull requests.

Key regression coverage includes:

- deterministic transitions and retry limits;
- auto clarification success and unresolved blocking behavior;
- durable human clarification pause/resume;
- durable phase resume;
- command-policy bypass attempts;
- provider MCP discovery parsing;
- parallel worktree isolation;
- actual changed-file ownership enforcement.

## Design principle

The project deliberately separates **agent reasoning** from **runtime authority**:

```text
LLM / MCP tools
    ↓
bounded stage
    ↓
schema artifact
    ↓
deterministic runtime gate
    ↓
next stage
```

Agents can investigate deeply, reconcile requirements, use the tools already available to them, write code in authorized stages, diagnose failures, and review changes. They cannot redefine the workflow, silently expand authority, convert failed checks into passes, plan through unresolved blocking ambiguity, or bypass policy by emitting prose.
