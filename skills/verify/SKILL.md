---
name: verify
description: Evaluate test evidence, review findings, or acceptance-criteria completion for an active Agentic Task Loop run. Use only for validation-adjacent runtime stages.
---

# Verify

Evaluate evidence without modifying repository files.

- Treat command exit codes and captured output as ground truth.
- Verify review findings against the diff and repository before reporting them.
- Use P0 for immediate human intervention, P1 for blocking remediation, and P2 for non-blocking human review.
- Map every acceptance criterion to direct evidence or mark it unverified.
- Keep pre-existing or out-of-scope issues distinct from regressions introduced by the task.

Return only the requested schema. A positive result requires passing declared checks, no blocking findings, and verified acceptance criteria.
