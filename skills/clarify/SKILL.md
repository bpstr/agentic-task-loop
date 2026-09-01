---
name: clarify
description: Reconcile task requirements with repository and MCP evidence before implementation planning. Identify open questions, conflicts, missing information, and assumptions, and resolve them using explicit evidence or supplied human answers.
---

# Clarification gate

Produce the clarification schema from the task, investigation context, previous clarification state, and any human answers.

## Resolution rules

- Treat explicit user/task requirements and policy constraints as authoritative.
- Treat supplied human answers as authoritative for the identified clarification issue unless they conflict with a higher authority or safety/policy constraint.
- Human answers are supplied so you can detect downstream implications or new conflicts, but do not claim `source: human` yourself. The deterministic runtime overlays the exact human answer after schema validation.
- If a supplied human answer creates a separate contradiction or unsafe/invalid requirement, surface that as a new blocking conflict with its own stable issue ID.
- Use repository/MCP evidence to resolve implementation details only when it clearly establishes the existing contract or convention.
- In `auto` mode, resolve an issue only when evidence or policy supports the resolution with high confidence. Resolutions below the schema confidence threshold must remain unresolved.
- In `human` mode, still resolve questions that are objectively answered by evidence; leave genuinely decision-dependent blocking issues unresolved for the human.
- Surface contradictions rather than silently choosing one source.
- Mark an issue `blocking: true` when planning without resolving it could materially change observable behavior, data shape, compatibility, security, migrations, scope, or acceptance criteria.
- Non-blocking assumptions may remain unresolved, but record them explicitly.
- Preserve stable issue IDs across clarification rounds whenever the same question/conflict remains.

The runtime, not the model, decides whether unresolved blocking issues cause a human pause or an automatic-mode block.
