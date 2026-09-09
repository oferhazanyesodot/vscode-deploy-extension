import { RunSummary } from "./types";

// Select the newest run matching workflow + branch created at/after dispatchedAt
// (within a clock-skew tolerance). Returns undefined when no such run exists.
export function identifyRun(
  runs: RunSummary[],
  workflowName: string,
  branch: string,
  dispatchedAt: Date,
  skewMs = 60_000
): RunSummary | undefined {
  const threshold = dispatchedAt.getTime() - skewMs;
  let best: RunSummary | undefined;
  let bestTime = -Infinity;
  for (const r of runs) {
    if (r.headBranch !== branch) {
      continue;
    }
    if (r.name !== workflowName) {
      continue;
    }
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t)) {
      continue;
    }
    if (t < threshold) {
      continue;
    }
    if (t > bestTime) {
      bestTime = t;
      best = r;
    }
  }
  return best;
}
