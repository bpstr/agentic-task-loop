import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProcess } from "../providers/process-runner.js";
import { WorktreeManager } from "../runtime/worktree-manager.js";

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await runProcess("git", args, { cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

async function repository(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agentic-worktree-test-"));
  await git(cwd, "init");
  await git(cwd, "config", "user.email", "agentic-task-loop@example.invalid");
  await git(cwd, "config", "user.name", "Agentic Task Loop tests");
  await writeFile(path.join(cwd, "api.txt"), "api before\n", "utf8");
  await writeFile(path.join(cwd, "web.txt"), "web before\n", "utf8");
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-m", "baseline");
  return cwd;
}

test("isolates a worker, enforces ownership, and applies its patch to the main checkout", async () => {
  const cwd = await repository();
  const manager = new WorktreeManager(cwd, "ATL-WORKTREE-TEST");
  const isolation = await manager.canIsolate();
  assert.equal(isolation.allowed, true);

  const worker = await manager.create({ id: "api", files: ["api.txt"], stepIds: ["api"] });
  try {
    await writeFile(path.join(worker.cwd, "api.txt"), "api after\n", "utf8");
    const patch = await manager.collectPatch(worker);
    assert.deepEqual(patch.changedFiles, ["api.txt"]);
    await manager.applyPatch(patch.patchPath);
    assert.equal(await readFile(path.join(cwd, "api.txt"), "utf8"), "api after\n");
  } finally {
    await manager.cleanup(worker);
    await manager.cleanup();
  }
});

test("rejects actual changes outside the declared workstream ownership", async () => {
  const cwd = await repository();
  const manager = new WorktreeManager(cwd, "ATL-WORKTREE-OWNERSHIP");
  const worker = await manager.create({ id: "api", files: ["api.txt"], stepIds: ["api"] });
  try {
    await writeFile(path.join(worker.cwd, "web.txt"), "unexpected\n", "utf8");
    await assert.rejects(() => manager.collectPatch(worker), /outside its ownership boundary/);
  } finally {
    await manager.cleanup(worker);
    await manager.cleanup();
  }
});
