---
name: plan
description: Create or critique a structured implementation plan for an active Agentic Task Loop run. Use only for the runtime's plan and plan-review stages.
---

# Plan

Translate the context package into the requested structured plan.

- Cover every acceptance criterion without inventing requirements.
- Name files conservatively and keep the scope minimal.
- Make migrations, APIs, compatibility, rollback concerns, and tests explicit when relevant.
- Declare deterministic checks as an executable plus argument array, never as a shell expression.
- Split workstreams only when their file ownership is disjoint.
- Map each acceptance criterion to one or more plan steps.

When acting as critic, return `revise` for missing coverage, unjustified scope, architecture conflicts, or weak validation. Approve only when all criteria and consequential risks are accounted for.
