import assert from "node:assert/strict";
import test from "node:test";
import { parseCodexMcpConfig, parseProviderMcpListing } from "../runtime/capability-discovery.js";

test("discovers enabled MCP servers from Codex config without explicit ATL config", () => {
  const config = `
[mcp_servers.atlassian]
url = "https://mcp.atlassian.com/v1/sse"

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.disabled]
command = "example"
enabled = false
`;
  assert.deepEqual(parseCodexMcpConfig(config), ["atlassian", "context7"]);
});

test("parses provider MCP list output conservatively", () => {
  const listing = `Name              Status\natlassian         connected\ncontext7: Connected\nChecking MCP server health...\n`;
  assert.deepEqual(parseProviderMcpListing(listing), ["atlassian", "context7"]);
});
