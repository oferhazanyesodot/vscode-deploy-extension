import { RepoCandidate, Cancelled, isCancelled } from "./core/types";
import {
  RepoBranches,
  ProfileInfo,
  CandidateRepo,
  DirtyHandlingDefault,
  DirtyHandlingAction,
  SwitchResult,
  CheckoutOutcome,
} from "./core/profileTypes";
import { discoverProfiles } from "./core/profileDiscovery";
import { classify, checkoutPlan, RepoBranchSets } from "./core/branchClassification";
import { decideAction } from "./core/dirtyHandling";
import { isDirty } from "./core/gitStatus";
import { buildSwitchSummary } from "./core/summaries";

export interface SwitchProfileDeps {
  discoverRepos(): RepoCandidate[];
  listBranches(repoName: string, repoRoot: string): Promise<RepoBranches>;
  pickProfile(profiles: ProfileInfo[]): Promise<string | Cancelled>;
  status(repoRoot: string): Promise<{ staged: boolean; unstaged: boolean; untracked: boolean }>;
  promptDirtyAction(repoName: string): Promise<DirtyHandlingAction | Cancelled>;
  stashChanges(repoRoot: string): Promise<{ code: number; stdout: string; stderr: string }>;
  fetchBranch(repoRoot: string, branch: string): Promise<{ code: number; stdout: string; stderr: string }>;
  checkoutBranch(repoRoot: string, branch: string): Promise<{ code: number; stdout: string; stderr: string }>;
  checkoutTrackingBranch(repoRoot: string, branch: string): Promise<{ code: number; stdout: string; stderr: string }>;
  dirtyHandlingDefault(): DirtyHandlingDefault;
  notifyError(message: string): void;
  reportSummary(branch: string, results: SwitchResult[]): void;
}

export class SwitchProfileHandler {
  constructor(private readonly deps: SwitchProfileDeps) {}

  async execute(): Promise<void> {
    const d = this.deps;

    // 1. Discover repos + branches, compute profiles.
    const repos = d.discoverRepos().filter((r) => r.hasDeployWorkflow);
    const branchSets: RepoBranchSets[] = [];
    const repoBranches: Record<string, string[]> = {};
    for (const repo of repos) {
      const b = await d.listBranches(repo.name, repo.rootPath);
      repoBranches[repo.name] = [...new Set([...b.local, ...b.remote])];
      branchSets.push({
        name: repo.name,
        rootPath: repo.rootPath,
        local: new Set(b.local),
        remote: new Set(b.remote),
      });
    }
    const profiles = discoverProfiles(repoBranches);

    // 2. Profile picker (free text allowed).
    const chosen = await d.pickProfile(profiles);
    if (isCancelled(chosen)) {
      return;
    }
    const branch = chosen as string;

    // 3. Classify candidates.
    const { candidates } = classify(branch, branchSets);
    if (candidates.length === 0) {
      d.notifyError(`No repository contains the branch ${branch}.`);
      return;
    }

    // 4. Dirty pre-flight per candidate.
    const toCheckout: { repo: CandidateRepo; stashed: boolean }[] = [];
    const results: SwitchResult[] = [];
    for (const repo of candidates) {
      const status = await d.status(repo.rootPath);
      const dirty = isDirty(status);
      const decision = decideAction(d.dirtyHandlingDefault(), dirty);

      let action: DirtyHandlingAction | "proceed";
      if (decision === "proceed") {
        action = "proceed";
      } else if (decision === "prompt") {
        const picked = await d.promptDirtyAction(repo.name);
        if (isCancelled(picked)) {
          return; // cancel ends the whole flow
        }
        action = picked as DirtyHandlingAction;
      } else {
        action = decision;
      }

      if (action === "abort") {
        // End the whole flow with no checkout anywhere.
        return;
      }
      if (action === "skip") {
        results.push({ repoName: repo.name, location: repo.location, stashed: false, outcome: { kind: "skipped" } });
        continue;
      }
      let stashed = false;
      if (action === "stash") {
        const s = await d.stashChanges(repo.rootPath);
        stashed = s.code === 0;
      }
      toCheckout.push({ repo, stashed });
    }

    // 5. Checkout per remaining candidate, isolating failures.
    for (const { repo, stashed } of toCheckout) {
      const plan = checkoutPlan(repo.location, branch);
      let outcome: CheckoutOutcome;
      if (plan.kind === "fetch-track") {
        const fetch = await d.fetchBranch(repo.rootPath, branch);
        if (fetch.code !== 0) {
          outcome = { kind: "failed", error: fetch.stderr || fetch.stdout };
          results.push({ repoName: repo.name, location: repo.location, stashed, outcome });
          continue;
        }
        const co = await d.checkoutTrackingBranch(repo.rootPath, branch);
        outcome = co.code === 0 ? { kind: "switched" } : { kind: "failed", error: co.stderr || co.stdout };
      } else {
        const co = await d.checkoutBranch(repo.rootPath, branch);
        outcome = co.code === 0 ? { kind: "switched" } : { kind: "failed", error: co.stderr || co.stdout };
      }
      results.push({ repoName: repo.name, location: repo.location, stashed, outcome });
    }

    // 6. Summary.
    buildSwitchSummary(branch, results);
    d.reportSummary(branch, results);
  }
}