import { readFile } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "../providers/process-runner.js";

export interface NativeRepositoryContext {
  status: string;
  recentCommits: string;
  instructions: Array<{ path: string; content: string }>;
}

export class NativeRepositoryIntegration {
  constructor(private readonly cwd: string) {}

  async collect(): Promise<NativeRepositoryContext> {
    const [status, recentCommits, instructions] = await Promise.all([
      runProcess("git", ["status", "--short"], { cwd: this.cwd }),
      runProcess("git", ["log", "-5", "--oneline"], { cwd: this.cwd }),
      this.readInstructions(),
    ]);
    return { status: status.stdout, recentCommits: recentCommits.stdout, instructions };
  }

  async changedFiles(): Promise<string[]> {
    const results = await Promise.all([
      runProcess("git", ["diff", "--name-only", "-z"], { cwd: this.cwd }),
      runProcess("git", ["diff", "--cached", "--name-only", "-z"], { cwd: this.cwd }),
      runProcess("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: this.cwd }),
    ]);
    if (results.some((result) => result.exitCode !== 0)) return [];
    return [...new Set(results.flatMap((result) => result.stdout.split("\0").filter(Boolean)))];
  }

  private async readInstructions(): Promise<Array<{ path: string; content: string }>> {
    const found: Array<{ path: string; content: string }> = [];
    for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
      try {
        found.push({ path: filename, content: await readFile(path.join(this.cwd, filename), "utf8") });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
    }
    return found;
  }
}
