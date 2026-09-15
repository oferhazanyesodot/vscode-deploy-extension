import { RepoCandidate, Cancelled, isCancelled } from "./core/types";
import {
  Profile,
  CandidateRepo,
  DirtyHandlingDefault,
  DirtyHandlingAction,
  SwitchResult,
  CheckoutOutcome,
} from "./core/profileTypes";
import { discoverProfiles } from "./core/profileDiscovery";
import { classifyProfile, RepoBranchInfo, checkoutPlan } from "./core/branchClassification";
import { decideAction } from "./core/dirtyHandling";
import { isDirty } from "./core/gitStatus";
import { buildSwitchSummary } from "./core/summaries";

// A profile chosen for switching, plus a way to obtain its per-target candidates.
export interface SwitchProfileDeps {
  discoverRepos(): RepoCandidate[];
  listBranches(repoName: string, repoRoot: string): Promise<{ repoName: string; local: string[]; remote: string[] }>;
  pickProfile(autoProfiles: Profile[]): Promise<Profile | Cancelled>;
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

function autoProfile(branch: string, repos: string[]): Profile {
  return { name: branch, kind: "auto", targets: repos.map((repo) => ({ repo, branch })) };
}

export class SwitchProfileHandler {
  constructor(private readonly deps: SwitchProfileDeps) {}

  async execute(): Promise<void> {
    const d = this.deps;

    const repos = d.discoverRepos().filter((r) => r.hasDeployWorkflow);
    const repoBranches: Record<string, string[]> = {};
    const branchInfo = new Map<string, RepoBranchInfo>();
    for (const repo of repos) {
      const b = await d.listBranches(repo.name, repo.rootPath);
      repoBranches[repo.name] = [...new Set([...b.local, ...b.remote])];
      branchInfo.set(repo.name, {
        rootPath: repo.rootPath,
        local: new Set(b.local),
        remote: new Set(b.remote),
      });
    }
    const autoProfiles = discoverProfiles(repoBranches).map((p) => autoProfile(p.branch, p.repos));

    const chosen = await d.pickProfile(autoProfiles);
    if (isCancelled(chosen)) {
      return;
    }
    const profile = chosen as Profile;

    const candidates = classifyProfile(profile, branchInfo);
    if (candidates.length === 0) {
      d.notifyError(`No repository is included in profile "${profile.name}".`);
      return;
    }

    // Dirty pre-flight.
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
          return;
        }
        action = picked as DirtyHandlingAction;
      } else {
        action = decision;
      }

      if (action === "abort") {
        return;
      }
      if (action === "skip") {
        results.push({ repoName: repo.name, branch: repo.branch, location: repo.location, stashed: false, outcome: { kind: "skipped" } });
        continue;
      }
      let stashed = false;
      if (action === "stash") {
        const s = await d.stashChanges(repo.rootPath);
        stashed = s.code === 0;
      }
      toCheckout.push({ repo, stashed });
    }

    // Checkout per remaining candidate using its OWN target branch.
    for (const { repo, stashed } of toCheckout) {
      const plan = checkoutPlan(repo.location, repo.branch);
      let outcome: CheckoutOutcome;
      if (plan.kind === "not-found") {
        outcome = { kind: "failed", error: `Branch "${repo.branch}" not found in ${repo.name}.` };
      } else if (plan.kind === "fetch-track") {
        const fetch = await d.fetchBranch(repo.rootPath, repo.branch);
        if (fetch.code !== 0) {
          outcome = { kind: "failed", error: fetch.stderr || fetch.stdout };
        } else {
          const co = await d.checkoutTrackingBranch(repo.rootPath, repo.branch);
          outcome = co.code === 0 ? { kind: "switched" } : { kind: "failed", error: co.stderr || co.stdout };
        }
      } else {
        const co = await d.checkoutBranch(repo.rootPath, repo.branch);
        outcome = co.code === 0 ? { kind: "switched" } : { kind: "failed", error: co.stderr || co.stdout };
      }
      results.push({ repoName: repo.name, branch: repo.branch, location: repo.location, stashed, outcome });
    }

    buildSwitchSummary(profile.name, results);
    d.reportSummary(profile.name, results);
  }
}