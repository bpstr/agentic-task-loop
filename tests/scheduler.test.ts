import assert from "node:assert/strict";
import test from "node:test";
import { Scheduler } from "../runtime/scheduler.js";

test("parallelizes only disjoint ownership", () => {
  const scheduler = new Scheduler();
  assert.equal(scheduler.schedule([
    { id: "backend", files: ["src/api.ts"], stepIds: ["1"] },
    { id: "frontend", files: ["ui/App.tsx"], stepIds: ["2"] },
  ]).mode, "parallel");

  assert.equal(scheduler.schedule([
    { id: "one", files: ["src/shared.ts"], stepIds: ["1"] },
    { id: "two", files: ["src/shared.ts"], stepIds: ["2"] },
  ]).mode, "single");
});
