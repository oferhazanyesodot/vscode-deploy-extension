import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { DeployCommandHandler, Deps } from "../src/deployCommandHandler";
import { ProfileSelection, CandidateRepo, PerRepositoryResult } from "../src/core/profileTypes";
import { DeployEnvironment } from "../src/core/types";

function baseDeps(over: Partial<Deps> = {}): Deps {
  return {
    ghIsInstalled: vi.fn(async () => true),
    ghIsAuthenticated: vi.fn(async () => true),
    resolveRepo: vi.fn(async () => ({ kind: "cancelled" as const })),
    resolveWorkflow: vi.fn(async () => "deploy.yaml"),
    pickEnvironment: vi.fn(async () => "dev" as DeployEnvironment),
    gitStatus: vi.fn(async () => ({ staged: false, unstaged: false, untracked: false })),
    currentBranch: vi.fn(async () => "main"),
    confirmDirty: vi.fn(async () => true),
    confirmPreprod: vi.fn(async () => true),
    confirmPreprodProfile: vi.fn(async () => true),
    viewWorkflowYaml: vi.fn(async () => ""),
    collectInputs: vi.fn(async () => ({})),
    runWorkflow: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    identifyRun: vi.fn(async () => ({ databaseId: "1", name: "deploy.yaml", headBranch: "fix/x", status: "completed", createdAt: new Date().toISOString(), url: "https://x/run/1" })),
    track: vi.fn(async () => ({ databaseId: "1", status: "completed", conclusion: "success", url: "u" })),
    trackMany: vi.fn(async () => []),
    deployOrder: vi.fn(() => []),
    activeFilePath: vi.fn(() => undefined),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyFailure: vi.fn(),
    notifyCancelled: vi.fn(),
    notifyInfo: vi.fn(),
    deploymentSummary: vi.fn(),
    ...over,
  };
}

function profile(candidates: CandidateRepo[]): ProfileSelection {
  return { kind: "profile", branch: "fix/x", candidates };
}

const cand = (name: string): CandidateRepo => ({ name, rootPath: `C:/r/${name}`, location: "both" });

describe("profile deploy", () => {
  it("dispatches every candidate using the profile branch as ref (no checkout)", async () => {
    const runWorkflow = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const d = baseDeps({
      resolveRepo: vi.fn(async () => profile([cand("a"), cand("b")])),
      runWorkflow,
    });
    await new DeployCommandHandler(d).execute();
    expect(runWorkflow).toHaveBeenCalledTimes(2);
    // ref (3rd arg) is the profile branch for every call
    for (const call of runWorkflow.mock.calls) {
      expect((call as unknown as unknown[])[2]).toBe("fix/x");
    }
    expect(d.deploymentSummary).toHaveBeenCalled();
  });

  it("preprod profile asks confirmation identifying repos; decline -> no dispatch", async () => {
    const runWorkflow = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const d = baseDeps({
      resolveRepo: vi.fn(async () => profile([cand("a"), cand("b")])),
      pickEnvironment: vi.fn(async () => "preprod" as DeployEnvironment),
      confirmPreprodProfile: vi.fn(async () => false),
      runWorkflow,
    });
    await new DeployCommandHandler(d).execute();
    expect(d.confirmPreprodProfile).toHaveBeenCalled();
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  // Feature: profile-deploy, Property 9: Profile dispatch is non-atomic and isolates per-repository failures
  it("Property 9: attempts dispatch for every resolvable candidate; failures isolated; one result each", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ name: fc.stringMatching(/^r[0-9]{1,2}$/), fails: fc.boolean() }), { minLength: 1, maxLength: 8 }),
        async (specs) => {
          const uniq = Array.from(new Map(specs.map((s) => [s.name, s])).values());
          const candidates = uniq.map((s) => cand(s.name));
          const failing = new Set(uniq.filter((s) => s.fails).map((s) => s.name));

          const attempted: string[] = [];
          const runWorkflow = vi.fn(async (root: string) => {
            const name = root.split("/").pop()!;
            attempted.push(name);
            return failing.has(name)
              ? { code: 1, stdout: "", stderr: "boom" }
              : { code: 0, stdout: "", stderr: "" };
          });
          let captured: PerRepositoryResult[] = [];
          const d = baseDeps({
            resolveRepo: vi.fn(async () => profile(candidates)),
            runWorkflow,
            trackMany: vi.fn(async () => []),
            deploymentSummary: vi.fn((_b, _e, results) => { captured = results; }),
          });
          await new DeployCommandHandler(d).execute();

          // Every candidate attempted (workflow resolves for all in baseDeps).
          expect(new Set(attempted)).toEqual(new Set(candidates.map((c) => c.name)));
          // Exactly one result per candidate.
          expect(captured.length).toBe(candidates.length);
          // Failing repos recorded as dispatch-failed; others dispatched.
          for (const c of candidates) {
            const res = captured.find((r) => r.repoName === c.name)!;
            if (failing.has(c.name)) {
              expect(res.dispatch.kind).toBe("dispatch-failed");
            } else {
              expect(res.dispatch.kind).toBe("dispatched");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("one unresolved workflow records resolution-failed; others continue", async () => {
    const d = baseDeps({
      resolveRepo: vi.fn(async () => profile([cand("a"), cand("b")])),
      resolveWorkflow: vi.fn(async (repo) => (repo.name === "a" ? { kind: "no-workflow-found" as const, repo: "a" } : "deploy.yaml")),
      trackMany: vi.fn(async () => []),
    });
    let captured: PerRepositoryResult[] = [];
    (d.deploymentSummary as any) = vi.fn((_b: string, _e: string, results: PerRepositoryResult[]) => { captured = results; });
    await new DeployCommandHandler(d).execute();
    const a = captured.find((r) => r.repoName === "a")!;
    const b = captured.find((r) => r.repoName === "b")!;
    expect(a.dispatch.kind).toBe("resolution-failed");
    expect(b.dispatch.kind).toBe("dispatched");
  });
});