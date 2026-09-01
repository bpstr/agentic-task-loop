import assert from "node:assert/strict";
import path from "node:path";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SchemaRegistry, SchemaValidationError } from "../runtime/schema-registry.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function clarificationWithResolution(source: string, confidence: number): unknown {
  return {
    summary: "One question resolved",
    requirements: [{ id: "REQ-1", statement: "Export data", status: "ambiguous", evidence: ["task"], issueIds: ["Q-1"] }],
    issues: [{
      id: "Q-1",
      kind: "question",
      statement: "Which format?",
      blocking: true,
      evidence: ["Existing exports are CSV"],
      options: ["CSV", "JSON"],
      resolution: { value: "CSV", source, rationale: "Matches the established repository contract", confidence },
    }],
  };
}

test("validates structured task output", async () => {
  const schemas = new SchemaRegistry(path.join(pluginRoot, "schemas"));
  const task = { id: "TASK-1", source: "plain", title: "Fix bug", description: "Fix the bug", acceptanceCriteria: [], constraints: [] };
  assert.deepEqual(await schemas.validate("task", task), task);
  await assert.rejects(() => schemas.validate("task", { title: "missing fields" }), SchemaValidationError);
});

test("validates structured clarification output", async () => {
  const schemas = new SchemaRegistry(path.join(pluginRoot, "schemas"));
  const clarification = {
    summary: "One question remains",
    requirements: [{ id: "REQ-1", statement: "Export data", status: "ambiguous", evidence: ["task"], issueIds: ["Q-1"] }],
    issues: [{ id: "Q-1", kind: "question", statement: "Which format?", blocking: true, evidence: [], options: ["CSV", "JSON"] }],
  };
  assert.deepEqual(await schemas.validate("clarification", clarification), clarification);
  await assert.doesNotReject(() => schemas.validate("clarification", clarificationWithResolution("evidence", 0.9)));
});

test("clarifier cannot manufacture human authority or low-confidence auto resolutions", async () => {
  const schemas = new SchemaRegistry(path.join(pluginRoot, "schemas"));
  await assert.rejects(() => schemas.validate("clarification", clarificationWithResolution("human", 1)), SchemaValidationError);
  await assert.rejects(() => schemas.validate("clarification", clarificationWithResolution("evidence", 0.5)), SchemaValidationError);
});

test("compiles every bundled schema", async () => {
  const directory = path.join(pluginRoot, "schemas");
  const schemas = new SchemaRegistry(directory);
  const names = (await readdir(directory)).filter((filename) => filename.endsWith(".schema.json")).map((filename) => filename.replace(".schema.json", ""));
  for (const name of names) await schemas.validator(name);
  assert.equal(names.length, 11);
});
