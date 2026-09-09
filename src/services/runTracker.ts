import { RunSummary, RunView, RunPhase } from "../core/types";
import { classifyPhase } from "../core/runPhase";
import { identifyRun } from "../core/runIdentification";
import { computeJobProgress, RunProgress } from "../core/jobProgress";
import { GhCliService } from "./ghCliService";

export interface PollDeps {
  viewRun: (runId: string) => Promise<RunView | undefined>;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
  onPhase: (phase: RunPhase, progress: RunProgress) => void;
  maxConsecutiveErrors?: number;
}

// Pure-ish poll loop: dependencies are injected so it can be tested with a fake
// clock and scripted viewRun sequence. Polls until the run completes, invoking
// onPhase (with computed job progress) for each observed phase; tolerates a
// bounded number of transient errors.
export async function pollRun(
  runId: string,
  intervalMs: number,
  deps: PollDeps
): Promise<RunView | undefined> {
  const maxErrors = deps.maxConsecutiveErrors ?? 3;
  let consecutiveErrors = 0;
  let last: RunView | undefined;

  for (;;) {
    if (deps.isCancelled()) {
      return last;
    }
    const view = await deps.viewRun(runId);
    if (view === undefined) {
      consecutiveErrors++;
      if (consecutiveErrors > maxErrors) {
        return last;
      }
      await deps.sleep(intervalMs);
      continue;
    }
    consecutiveErrors = 0;
    last = view;
    const phase = classifyPhase(view);
    const progress = computeJobProgress(view.jobs ?? []);
    deps.onPhase(phase, progress);
    if (phase.kind === "completed") {
      return view;
    }
    await deps.sleep(intervalMs);
  }
}

export function realSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class RunTracker {
  constructor(private readonly gh: GhCliService) {}

  async identifyRun(
    repoRoot: string,
    workflowName: string,
    branch: string,
    dispatchedAt: Date,
    attempts = 10,
    delayMs = 2000
  ): Promise<RunSummary | undefined> {
    for (let i = 0; i < attempts; i++) {
      const runs = await this.gh.listRuns(repoRoot, workflowName, branch);
      const found = identifyRun(runs, workflowName, branch, dispatchedAt);
      if (found) {
        return found;
      }
      await realSleep(delayMs);
    }
    return undefined;
  }

  track(
    repoRoot: string,
    runId: string,
    intervalMs: number,
    onPhase: (phase: RunPhase, progress: RunProgress) => void,
    isCancelled: () => boolean
  ): Promise<RunView | undefined> {
    return pollRun(runId, intervalMs, {
      viewRun: (id) => this.gh.viewRun(repoRoot, id),
      sleep: realSleep,
      isCancelled,
      onPhase,
    });
  }
}