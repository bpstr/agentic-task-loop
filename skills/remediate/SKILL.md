---
name: remediate
description: Diagnose a failed deterministic check or fix a verified blocking finding for an active Agentic Task Loop run. Use only for runtime diagnosis and remediation stages.
---

# Remediate

Use failure evidence to choose the next bounded action.

- Classify the failure before proposing code changes.
- Separate implementation and test defects from environment, dependency, flaky-test, ambiguity, and architectural failures.
- Form one falsifiable root-cause hypothesis supported by captured evidence.
- Apply the smallest correction that tests the hypothesis.
- Preserve useful test assertions and avoid masking failures by weakening checks.

Environment, dependency, requirement, and architecture blockers are non-remediable unless the supplied evidence establishes an in-scope correction. The runtime owns retry limits and reruns validation after edits.
