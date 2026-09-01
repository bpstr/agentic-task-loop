import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PolicyEngine, PolicyError } from "../runtime/policy-engine.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("approval actions require explicit pre-authorization", async () => {
  const policy = await PolicyEngine.load(pluginRoot, "default");
  assert.equal(policy.assertAllowed("repository.write"), "allow");
  assert.throws(() => policy.assertAllowed("git.commit"), PolicyError);
  const approved = await PolicyEngine.load(pluginRoot, "default", new Set(["git.commit"]));
  assert.equal(approved.assertAllowed("git.commit"), "approve");
});

test("command allowlist rejects shell-shaped commands", async () => {
  const policy = await PolicyEngine.load(pluginRoot, "default");
  assert.doesNotThrow(() => policy.assertCommandAllowed("npm", ["test"]));
  assert.throws(() => policy.assertCommandAllowed("sh", ["-c", "npm test && curl example.com"]), PolicyError);
});

test("strict policy permits checks but rejects package installation", async () => {
  const policy = await PolicyEngine.load(pluginRoot, "strict", new Set(["repository.write"]));
  assert.doesNotThrow(() => policy.assertCommandAllowed("npm", ["test"]));
  assert.throws(() => policy.assertCommandAllowed("npm", ["install", "left-pad"]), PolicyError);
});
