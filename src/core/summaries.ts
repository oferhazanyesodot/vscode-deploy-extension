import {
  SwitchResult,
  SwitchSummary,
  PerRepositoryResult,
  DeploymentSummary,
} from "./profileTypes";
import { DeployEnvironment } from "./types";

// Pure: summarize switch results into partitioned counts.
export function buildSwitchSummary(branch: string, results: SwitchResult[]): SwitchSummary {
  let switchedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const r of results) {
    if (r.outcome.kind === "switched") {
      switchedCount++;
    } else if (r.outcome.kind === "skipped") {
      skippedCount++;
    } else {
      failedCount++;
    }
  }
  return { branch, results, switchedCount, skippedCount, failedCount };
}

// A per-repo deploy result counts as "succeeded" iff it was dispatched and, where a
// run completed, its conclusion is a success. Everything else is a failure.
export function isRepoSuccess(r: PerRepositoryResult): boolean {
  if (r.dispatch.kind !== "dispatched") {
    return false;
  }
  if (r.runConclusion === undefined) {
    // Dispatched but no run conclusion recorded (e.g. untracked) — treat as success
    // for dispatch purposes only if it dispatched cleanly.
    return true;
  }
  return r.runConclusion === "success";
}

// Pure: summarize per-repo deploy results into partitioned counts.
export function buildDeploymentSummary(
  branch: string,
  environment: DeployEnvironment,
  results: PerRepositoryResult[]
): DeploymentSummary {
  let succeededCount = 0;
  let failedCount = 0;
  for (const r of results) {
    if (isRepoSuccess(r)) {
      succeededCount++;
    } else {
      failedCount++;
    }
  }
  return { branch, environment, results, succeededCount, failedCount };
}