import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContextPackage, Plan, ReviewResult, RunState, Task } from "./types.js";

export class CheckpointStore {
  readonly runsRoot: string;

  constructor(readonly repositoryRoot: string) {
    this.runsRoot = path.join(repositoryRoot, ".agentic", "runs");
  }

  runDirectory(runId: string): string {
    if (!/^ATL-[A-Za-z0-9-]+$/.test(runId)) {
      throw new Error(`Invalid run id: ${runId}`);
    }
    return path.join(this.runsRoot, runId);
  }

  async initialize(state: RunState, task: Task): Promise<void> {
    await mkdir(this.runDirectory(state.runId), { recursive: true });
    await Promise.all([this.saveState(state), this.writeJson(state.runId, "task.json", task)]);
  }

  async saveState(state: RunState): Promise<void> {
    await this.writeJson(state.runId, "state.json", state);
  }

  async loadState(runId: string): Promise<RunState> {
    return this.readJson<RunState>(runId, "state.json");
  }

  async writeContext(runId: string, context: ContextPackage): Promise<void> {
    await this.writeJson(runId, "context.json", context);
  }

  async writePlan(runId: string, plan: Plan): Promise<void> {
    await this.writeJson(runId, "plan.json", plan);
  }

  async writeReview(runId: string, review: ReviewResult): Promise<void> {
    await this.writeJson(runId, "review.json", review);
  }

  async writeJson(runId: string, filename: string, value: unknown): Promise<void> {
    const directory = this.runDirectory(runId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, filename);
    const temporary = `${target}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async writeText(runId: string, filename: string, value: string): Promise<void> {
    const directory = this.runDirectory(runId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), value.endsWith("\n") ? value : `${value}\n`, "utf8");
  }

  async readJson<T>(runId: string, filename: string): Promise<T> {
    return JSON.parse(await readFile(path.join(this.runDirectory(runId), filename), "utf8")) as T;
  }

  async readJsonIfExists<T>(runId: string, filename: string): Promise<T | undefined> {
    try {
      return await this.readJson<T>(runId, filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
