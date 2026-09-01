# Runtime configuration

Read the section relevant to the current run. Provider-native tools are the primary integration surface; native Git and repository tools remain the fallback.

## Provider-native MCP capabilities

Do not configure the same MCP server again for Agentic Task Loop. The runtime discovers MCP servers already configured for the provider and passes their availability into the relevant agent stages.

For Codex, discovery uses the shared Codex MCP configuration and `codex mcp list`. This includes the normal user configuration under `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) and project `.codex/config.toml` when present.

For Claude Code, discovery uses `claude mcp list`, project `.mcp.json`, and user/project MCP entries available through `~/.claude.json`.

Examples of globally configured servers that should therefore become available automatically include Jira/Atlassian, Linear, GitHub, documentation/search MCPs, code-intelligence servers, and other MCP-compatible tools. The selected provider keeps ownership of authentication and credentials; Agentic Task Loop discovers capability metadata and lets the provider use its existing authenticated tool session. It does not copy OAuth tokens or require credentials to be duplicated in repository configuration.

The requirements and investigation stages may use matching provider-native MCP tools for read-only evidence. A ticket such as `PROJ-142` can therefore be resolved through an already configured Jira/Atlassian MCP without defining a second Jira command for Agentic Task Loop.

## Explicit runtime adapters

`.agentic/capabilities.json` is optional. Use it only when a capability is not registered with the selected provider, or when the deterministic runtime itself must invoke a command outside an agent session.

```json
{
  "jira": { "command": "jira-mcp-client", "args": ["invoke"] },
  "codebase": { "command": "codebase-client", "args": ["query"] },
  "graphify": { "command": "graphify", "args": ["query", "--json"] },
  "deepReview": { "command": "/path/to/deep-review.sh", "args": ["--changes"] }
}
```

Each direct command receives one final JSON argument and must return JSON, except Deep Code Review, whose text output is normalized by the review evaluator. Environment compatibility fallbacks are `JIRA_MCP_COMMAND`, `CODEBASE_MCP_COMMAND`, `GRAPHIFY_COMMAND`, and `DEEP_REVIEW_COMMAND`.

These adapters are compatibility/automation hooks, not the normal way to expose an MCP server to the agents.

## Provider selection

With `--provider auto`, the runtime considers provider availability and discovered MCP capabilities. For ticket-like tasks it prefers a provider that already exposes a matching issue-tracker MCP such as Jira/Atlassian or Linear. Resume keeps using the provider recorded by the original run.

## Authority

Discovery never implies authority. Policies live under `policies/`. `allow` runs immediately, `allow_with_warning` records permitted risk, `approve` requires a matching `--approve <action>`, and `deny` cannot be overridden by a model.

Provider-native MCP use during requirements and investigation is read-only. External writes, repository writes, commits, pushes, and deployments remain independent policy decisions. A globally configured Jira MCP does not grant permission to comment, transition, or close tickets merely because it was discovered.

The legacy deterministic Jira comment path still requires all of:

1. `--post-jira`;
2. `--approve jira.comment` when the selected policy requires approval;
3. an explicit runtime Jira adapter, because the deterministic runtime—not an agent stage—performs that write.

## Parallel execution

Parallel implementation workers run only when the planner declares disjoint file ownership and the main checkout is clean. Each worker receives a disposable Git worktree. The runtime compares the worker's actual changed files against its declared ownership before a patch can be integrated into the main checkout.

If the target checkout already contains user changes, the runtime falls back to a single worker instead of creating parallel worktrees that would silently omit those changes.

## Durable artifacts and resume

Every run writes `.agentic/runs/<run-id>/` with `state.json`, `task.json`, `context.json`, `plan.json`, `test-results.json`, `review.json`, `verification.json`, `decisions.jsonl`, `final-report.json`, and `final.md` as stages complete.

Writable implementation and remediation stages also persist an active-operation marker before edits begin. If a run is interrupted and new repository changes remain beyond the operation baseline, resume blocks for inspection rather than blindly replaying a side-effecting stage. Completed phases still resume from the persisted state instead of being repeated.
