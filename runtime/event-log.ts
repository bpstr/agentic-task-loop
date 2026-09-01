import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Phase } from "./types.js";

export interface RunEventRecord {
  at: string;
  phase: Phase;
  event: string;
  evidence?: unknown;
}

export class EventLog {
  constructor(private readonly runDirectory: string) {}

  async append(phase: Phase, event: string, evidence?: unknown): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
    const record: RunEventRecord = {
      at: new Date().toISOString(),
      phase,
      event,
      ...(evidence === undefined ? {} : { evidence }),
    };
    await appendFile(path.join(this.runDirectory, "decisions.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  }
}
