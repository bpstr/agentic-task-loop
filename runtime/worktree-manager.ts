import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../providers/process-runner.js";
import { NativeRepositoryIntegration } from "../integrations/native-repository.js";
import type { Workstream } from "./types.js";

export interface IsolatedWorktree {
  workstream: Workstream;
  cwd: string;
  baseline: string;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "worker";
}

export class WorktreeManager {
  private readonly root: string;

  constructor(
    private readonly repositoryRoot: string,
    runId: string,
  ) {
    this.root = path.join(os.tmpdir(), "agentic-task-loop", safeId(runId));
  }

  async canIsolate(): Promise<{ allowed: boolean; reason?: string }> {
    const repository = new NativeRepositoryIntegration(this.repositoryRoot);
    const changed = await repository.changedFiles();
    if (changed.length) {
      return { allowed: false, reason: "The main checkout contains user changes; parallel worktrees would not inherit them safely" };
    }
    const inside = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], { cwd: this.repositoryRoot });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
      return { allowed: false, reason: "The target is not a Git worktree" };
    }
    return { allowed: true };
  }

  async create(workstream: Workstream): Promise<IsolatedWorktree> {
    await mkdir(this.root, { recursive: true });
    const head = await runProcess("git", ["rev-parse", "HEAD"], { cwd: this.repositoryRoot });
    if (head.exitCode !== 0) throw new Error(`Unable to resolve worktree baseline: ${head.stderr.trim()}`);
    const baseline = head.stdout.trim();
    const cwd = path.join(this.root, safeId(workstream.id));
    await rm(cwd, { recursive: true, force: true });
    const result = await runProcess("git", ["worktree", "add", "--detach", cwd, baseline], { cwd: this.repositoryRoot });
    if (result.exitCode !== 0) throw new Error(`Unable to create isolated worktree ${workstream.id}: ${result.stderr.trim()}`);
    return { workstream, cwd, baseline };
  }

  async collectPatch(worker: IsolatedWorktree): Promise<{ patchPath: string; changedFiles: string[] }> {
    const repository = new NativeRepositoryIntegration(worker.cwd);
    const changedFiles = await repository.changedFiles();
    const allowed = new Set(worker.workstream.files);
    const outsideOwnership = changedFiles.filter((file) => !allowed.has(file));
    if (outsideOwnership.length) {
      throw new Error(`Workstream ${worker.workstream.id} modified files outside its ownership boundary: ${outsideOwnership.join(", ")}`);
    }

    const stage = await runProcess("git", ["add", "-A"], { cwd: worker.cwd });
    if (stage.exitCode !== 0) throw new Error(`Unable to collect workstream ${worker.workstream.id}: ${stage.stderr.trim()}`);
    const diff = await runProcess("git", ["diff", "--cached", "--binary", worker.baseline], { cwd: worker.cwd });
    if (diff.exitCode !== 0) throw new Error(`Unable to build patch for ${worker.workstream.id}: ${diff.stderr.trim()}`);
    const patchPath = path.join(this.root, `${safeId(worker.workstream.id)}.patch`);
    await writeFile(patchPath, diff.stdout, "utf8");
    return { patchPath, changedFiles };
  }

  async applyPatch(patchPath: string): Promise<void> {
    const patch = await readFile(patchPath, "utf8");
    if (!patch.trim()) return;
    const result = await runProcess("git", ["apply", "--binary", "--whitespace=nowarn", patchPath], { cwd: this.repositoryRoot });
    if (result.exitCode !== 0) throw new Error(`Unable to merge isolated workstream patch: ${result.stderr.trim()}`);
  }

  async cleanup(worker?: IsolatedWorktree): Promise<void> {
    if (worker) {
      await runProcess("git", ["worktree", "remove", "--force", worker.cwd], { cwd: this.repositoryRoot }).catch(() => undefined);
      await rm(worker.cwd, { recursive: true, force: true });
      return;
    }
    await runProcess("git", ["worktree", "prune"], { cwd: this.repositoryRoot }).catch(() => undefined);
    await rm(this.root, { recursive: true, force: true });
  }
}
