import { RunPhase } from "../core/types";
import { classifyPhase } from "../core/runPhase";
import { computeJobProgress, RunProgress } from "../core/jobProgress";
import { GhCliService } from "./ghCliService";
import { realSleep } from "./runTracker";

export interface TrackedRun {
  repoName: string;
  runId: string;
  repoRoot: string;
  runUrl?: string;
}

export interface RepoPhase {
  repoName: string;
  phase: RunPhase;
  progress?: RunProgress;
  runUrl?: string;
}

export interface MultiPollDeps {
  viewRun: (repoRoot: string, runId: string) => Promise<{ status: string; conclusion: string | null; url: string; jobs?: { name: string; status: string; conclusion: string | null }[] } | undefined>;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
  onUpdate: (phases: RepoPhase[]) => void;
  maxConsecutiveErrors?: number;
}

// Pure-ish multi-run poll loop. Polls every not-yet-completed run each tick, maps
// each to a RepoPhase, invokes onUpdate with the full set, and resolves when all
// runs are completed (or cancelled).
export async function pollRuns(
  runs: TrackedRun[],
  intervalMs: number,
  deps: MultiPollDeps
): Promise<RepoPhase[]> {
  const maxErrors = deps.maxConsecutiveErrors ?? 3;
  const errorCounts = new Map<string, number>();
  // Latest known phase per repo; start all as pending.
  const latest = new Map<string, RepoPhase>();
  for (const run of runs) {
    latest.set(run.repoName, {
      repoName: run.repoName,
      phase: { kind: "pending" },
      runUrl: run.runUrl,
    });
  }

  const isDone = () =>
    [...latest.values()].every((p) => p.phase.kind === "completed");

  for (;;) {
    if (deps.isCancelled()) {
      return [...latest.values()];
    }
    for (const run of runs) {
      const current = latest.get(run.repoName);
      if (current && current.phase.kind === "completed") {
        continue; // stop polling completed runs
      }
      const view = await deps.viewRun(run.repoRoot, run.runId);
      if (view === undefined) {
        const n = (errorCounts.get(run.repoName) ?? 0) + 1;
        errorCounts.set(run.repoName, n);
        continue;
      }
      errorCounts.set(run.repoName, 0);
      const phase = classifyPhase({
        databaseId: run.runId,
        status: view.status,
        conclusion: view.conclusion,
        url: view.url,
      });
      const progress = computeJobProgress(view.jobs ?? []);
      latest.set(run.repoName, {
        repoName: run.repoName,
        phase,
        progress,
        runUrl: view.url ?? run.runUrl,
      });
    }
    deps.onUpdate([...latest.values()]);
    if (isDone()) {
      return [...latest.values()];
    }
    await deps.sleep(intervalMs);
  }
}

export class MultiRunTracker {
  constructor(private readonly gh: GhCliService) {}

  track(
    runs: TrackedRun[],
    intervalMs: number,
    onUpdate: (phases: RepoPhase[]) => void,
    isCancelled: () => boolean
  ): Promise<RepoPhase[]> {
    return pollRuns(runs, intervalMs, {
      viewRun: (repoRoot, runId) => this.gh.viewRun(repoRoot, runId),
      sleep: realSleep,
      isCancelled,
      onUpdate,
    });
  }
}