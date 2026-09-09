import { describe, it, expect } from "vitest";
import { pollRun } from "../src/services/runTracker";
import { RunView, RunPhase } from "../src/core/types";

describe("pollRun loop", () => {
  it("polls pending -> waiting -> completed, reports phases, and stops on completion", async () => {
    const sequence: RunView[] = [
      { databaseId: "1", status: "queued", conclusion: null, url: "u" },
      { databaseId: "1", status: "in_progress", conclusion: null, url: "u" },
      { databaseId: "1", status: "waiting", conclusion: null, url: "u" },
      { databaseId: "1", status: "completed", conclusion: "success", url: "u" },
    ];
    let idx = 0;
    const phases: RunPhase[] = [];
    let sleeps = 0;

    const result = await pollRun("1", 5, {
      viewRun: async () => sequence[Math.min(idx++, sequence.length - 1)],
      sleep: async () => {
        sleeps++;
      },
      isCancelled: () => false,
      onPhase: (p) => phases.push(p),
    });

    expect(result?.status).toBe("completed");
    expect(phases.map((p) => p.kind)).toEqual([
      "pending",
      "pending",
      "waiting-approval",
      "completed",
    ]);
    // Slept between the 3 non-terminal polls, not after completion.
    expect(sleeps).toBe(3);
  });

  it("tolerates transient errors up to the limit then bails", async () => {
    const phases: RunPhase[] = [];
    const result = await pollRun("1", 5, {
      viewRun: async () => undefined,
      sleep: async () => {},
      isCancelled: () => false,
      onPhase: (p) => phases.push(p),
      maxConsecutiveErrors: 2,
    });
    expect(result).toBeUndefined();
    expect(phases.length).toBe(0);
  });

  it("stops early when cancelled", async () => {
    let cancelled = false;
    const result = await pollRun("1", 5, {
      viewRun: async () => ({ databaseId: "1", status: "in_progress", conclusion: null, url: "u" }),
      sleep: async () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
      onPhase: () => {},
    });
    expect(result?.status).toBe("in_progress");
  });
});