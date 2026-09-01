import type { Workstream } from "./types.js";

export interface Schedule {
  mode: "single" | "parallel";
  workstreams: Workstream[];
  reason: string;
}

function overlaps(left: Workstream, right: Workstream): boolean {
  const owned = new Set(left.files);
  return right.files.some((file) => owned.has(file));
}

export class Scheduler {
  schedule(workstreams: Workstream[]): Schedule {
    if (workstreams.length < 2) {
      return { mode: "single", workstreams, reason: "The plan has one implementation workstream" };
    }
    for (let index = 0; index < workstreams.length; index += 1) {
      for (let other = index + 1; other < workstreams.length; other += 1) {
        const left = workstreams[index];
        const right = workstreams[other];
        if (left && right && overlaps(left, right)) {
          return { mode: "single", workstreams, reason: `Workstreams ${left.id} and ${right.id} overlap` };
        }
      }
    }
    return { mode: "parallel", workstreams, reason: "File ownership is disjoint" };
  }
}
