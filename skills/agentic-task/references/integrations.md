# Runtime configuration

Read the section relevant to the current run. Integrations enrich context or evaluation; native Git and repository tools remain the fallback.

## Capabilities

The runtime discovers Codex, Claude, Git repositories, `graphify-out/`, and a `deep-review` executable. Configure command-backed integrations in the target repository at `.agentic/capabilities.json`:

```json
{
  "jira": { "command": "jira-mcp-client", "args": ["invoke"] },
  "codebase": { "command": "codebase-client", "args": ["query"] },
  "graphify": { "command": "graphify", "args": ["query", "--json"] },
  "deepReview": { "command": "/path/to/deep-review.sh", "args": ["--changes"] }
}
```

Each command receives one final JSON argument and must return JSON, except Deep Code Review, whose text output is normalized by the review evaluator. Environment fallbacks are `JIRA_MCP_COMMAND`, `CODEBASE_MCP_COMMAND`, `GRAPHIFY_COMMAND`, and `DEEP_REVIEW_COMMAND`.

## Authority

Policies live under `policies/`. `allow` runs immediately, `allow_with_warning` records permitted risk, `approve` requires a matching `--approve <action>`, and `deny` cannot be overridden by a model.

Jira reads use `jira.read`. A comment requires all of:

1. `--post-jira`;
2. `--approve jira.comment` when the selected policy requires approval;
3. a configured Jira command.

Transitions, closing tickets, pushes, commits, and deployments are separate actions and are never inferred from implementation authority.

## Durable artifacts

Every run writes `.agentic/runs/<run-id>/` with `state.json`, `task.json`, `context.json`, `plan.json`, `test-results.json`, `review.json`, `verification.json`, `decisions.jsonl`, `final-report.json`, and `final.md` as stages complete. Resume uses `state.json`; it does not repeat completed phases.
