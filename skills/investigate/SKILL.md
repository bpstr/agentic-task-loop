---
name: investigate
description: Produce task and repository context artifacts for an active Agentic Task Loop run. Use only for the runtime's context or investigation stage.
---

# Investigate

Construct evidence for planning without editing the repository.

- Separate requested requirements from repository evidence and assumptions.
- Honor repository instructions and preserve existing user changes.
- Trace relevant symbols, callers, data flow, tests, configuration, and recent changes.
- Use code graphs when supplied; use native search for literals, configuration, and graph gaps.
- Record contradictions and unknowns explicitly.

Return only the schema requested by the runtime. Investigation is complete when every acceptance criterion maps to relevant implementation and validation surfaces or a named unknown.
