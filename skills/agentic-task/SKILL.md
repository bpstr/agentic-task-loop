---
name: agentic-task
description: Run a software-development task through the Agentic Task Loop's deterministic runtime, durable checkpoints, clarification gate, policy gates, specialist stages, deterministic validation, and independent review. Use when the user invokes $agentic-task, supplies a development ticket, or asks for a resumable end-to-end implementation workflow. Do not use for explanation-only or review-only requests.
---

# Agentic Task Loop

Use the packaged `agentic-task` runtime for the requested repository. The runtime owns phase transitions, budgets, checkpoints, clarification, validation gates, and external-write policy. Agents reason only inside the phase assigned to them.

## Run

From the target repository, invoke the installed CLI with the user's request:

```bash
agentic-task --provider auto --policy default --clarification auto "<task or ticket>"
```

Use `--clarification human` when requirement decisions should pause for a person before planning. If the run returns `awaiting_clarification`, preserve the run id and ask the returned blocking questions. Resume with one or more explicit answers:

```bash
agentic-task --resume <run-id> --answer 'Q-1=CSV' --answer 'Q-2=Keep the existing public API'
```

Use `--resume <run-id>` when the user asks to continue an interrupted run. Use `--dry-run` to inspect provider and integration discovery without starting agent work.

Pass `--approve <action>` only when the user explicitly authorizes that action. Posting a Jira summary also requires `--post-jira`; neither flag alone grants authority.

## Runtime contract

- Treat `.agentic/runs/<run-id>/state.json` as the authoritative phase and budget state.
- Treat `clarification.json` as the resolved requirement contract handed to planning and verification.
- In auto clarification mode, never let unresolved blocking ambiguity reach planning.
- In human clarification mode, treat `awaiting_clarification` as a durable pause, not a failure.
- Treat schema-validated artifacts as evidence; prose is supplementary.
- Let deterministic command exit codes control validation transitions.
- Resume from the recorded phase instead of repeating completed stages.
- Return the generated `final.md` and run directory to the user whether the run completes or blocks.

For capability configuration, policies, and state artifacts, read [references/integrations.md](references/integrations.md).
