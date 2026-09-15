import { describe, it, expect, vi } from "vitest";
import { SwitchProfileHandler, SwitchProfileDeps } from "../src/switchProfileHandler";
import { RepoCandidate } from "../src/core/types";
import { RepoBranches } from "../src/core/profileTypes";

const repos: RepoCandidate[] = [
  { name: "a", rootPath: "C:/r/a", hasDeployWorkflow: true },
  { name: "b", rootPath: "C:/r/b", hasDeployWorkflow: true },
];

function branches(name: string): RepoBranches {
  return { repoName: name, local: ["main", "fix/x"], remote: ["main", "fix/x"] };
}

function ok() { return { code: 0, stdout: "", stderr: "" }; }
function fail(msg: string) { return { code: 1, stdout: "", stderr: msg }; }

function baseDeps(over: Partial<SwitchProfileDeps> = {}): SwitchProfileDeps {
  return {
    discoverRepos: vi.fn(() => repos),
    listBranches: vi.fn(async (name: string) => branches(name)),
    pickProfile: vi.fn(async () => "fix/x"),
    status: vi.fn(async () => ({ staged: false, unstaged: false, untracked: false })),
    promptDirtyAction: vi.fn(async () => "stash" as const),
    stashChanges: vi.fn(async () => ok()),
    fetchBranch: vi.fn(async () => ok()),
    checkoutBranch: vi.fn(async () => ok()),
    checkoutTrackingBranch: vi.fn(async () => ok()),
    dirtyHandlingDefault: vi.fn(() => "prompt" as const),
    notifyError: vi.fn(),
    reportSummary: vi.fn(),
    ...over,
  };
}

describe("SwitchProfileHandler", () => {
  it("switches matching repos and never dispatches (checkout only)", async () => {
    const d = baseDeps();
    await new SwitchProfileHandler(d).execute();
    expect(d.checkoutBranch).toHaveBeenCalledTimes(2);
    expect(d.reportSummary).toHaveBeenCalled();
  });

  it("cancelled profile picker ends with no checkout", async () => {
    const d = baseDeps({ pickProfile: vi.fn(async () => ({ kind: "cancelled" as const })) });
    await new SwitchProfileHandler(d).execute();
    expect(d.checkoutBranch).not.toHaveBeenCalled();
  });

  it("no candidate repo shows error and ends", async () => {
    const d = baseDeps({ pickProfile: vi.fn(async () => "does-not-exist") });
    await new SwitchProfileHandler(d).execute();
    expect(d.notifyError).toHaveBeenCalled();
    expect(d.checkoutBranch).not.toHaveBeenCalled();
  });

  it("dirty + stash stashes before checkout", async () => {
    const d = baseDeps({
      status: vi.fn(async () => ({ staged: true, unstaged: false, untracked: false })),
      dirtyHandlingDefault: vi.fn(() => "stash" as const),
    });
    await new SwitchProfileHandler(d).execute();
    expect(d.stashChanges).toHaveBeenCalled();
    expect(d.checkoutBranch).toHaveBeenCalled();
  });

  it("dirty + abort performs zero checkouts", async () => {
    const d = baseDeps({
      status: vi.fn(async () => ({ staged: true, unstaged: false, untracked: false })),
      dirtyHandlingDefault: vi.fn(() => "abort" as const),
    });
    await new SwitchProfileHandler(d).execute();
    expect(d.checkoutBranch).not.toHaveBeenCalled();
  });

  it("dirty + skip removes repo and records skipped, others still switch", async () => {
    let first = true;
    const d = baseDeps({
      status: vi.fn(async () => {
        if (first) { first = false; return { staged: true, unstaged: false, untracked: false }; }
        return { staged: false, unstaged: false, untracked: false };
      }),
      dirtyHandlingDefault: vi.fn(() => "skip" as const),
    });
    await new SwitchProfileHandler(d).execute();
    expect(d.checkoutBranch).toHaveBeenCalledTimes(1);
  });

  it("checkout failure in one repo does not stop others", async () => {
    let n = 0;
    const d = baseDeps({
      checkoutBranch: vi.fn(async () => { n++; return n === 1 ? fail("conflict") : ok(); }),
    });
    await new SwitchProfileHandler(d).execute();
    expect(d.checkoutBranch).toHaveBeenCalledTimes(2);
    const summaryArg = (d.reportSummary as any).mock.calls[0][1];
    expect(summaryArg.some((r: any) => r.outcome.kind === "failed")).toBe(true);
    expect(summaryArg.some((r: any) => r.outcome.kind === "switched")).toBe(true);
  });
});