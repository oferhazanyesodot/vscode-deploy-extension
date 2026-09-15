import { BranchLocation, CandidateRepo, CheckoutPlan } from "./profileTypes";

export interface RepoBranchSets {
  name: string;
  rootPath: string;
  local: Set<string>;
  remote: Set<string>;
}

export interface ClassifyResult {
  candidates: CandidateRepo[];
  excluded: string[]; // repo names not containing the branch
}

// Pure: classify each repo's ownership of the given branch.
export function classify(branch: string, repos: RepoBranchSets[]): ClassifyResult {
  const candidates: CandidateRepo[] = [];
  const excluded: string[] = [];
  for (const repo of repos) {
    const inLocal = repo.local.has(branch);
    const inRemote = repo.remote.has(branch);
    if (inLocal && inRemote) {
      candidates.push({ name: repo.name, rootPath: repo.rootPath, branch, location: "both" });
    } else if (inLocal) {
      candidates.push({ name: repo.name, rootPath: repo.rootPath, branch, location: "local" });
    } else if (inRemote) {
      candidates.push({ name: repo.name, rootPath: repo.rootPath, branch, location: "remote" });
    } else {
      excluded.push(repo.name);
    }
  }
  return { candidates, excluded };
}

// Pure: how to check out a branch given its location.
export function checkoutPlan(location: BranchLocation, branch: string): CheckoutPlan {
  if (location === "remote") {
    return { kind: "fetch-track", branch };
  }
  if (location === "not-found") {
    return { kind: "not-found", branch };
  }
  return { kind: "local", branch };
}
import { Profile } from "./profileTypes";

export interface RepoBranchInfo {
  rootPath: string;
  local: Set<string>;
  remote: Set<string>;
}

function locationOf(branch: string, info: RepoBranchInfo | undefined): BranchLocation {
  if (!info) {
    return "not-found";
  }
  const inLocal = info.local.has(branch);
  const inRemote = info.remote.has(branch);
  if (inLocal && inRemote) return "both";
  if (inLocal) return "local";
  if (inRemote) return "remote";
  return "not-found";
}

// Pure: classify each target of a profile against ITS OWN branch.
// - Manual profile: one candidate per target (a not-found target is retained).
// - Auto profile: repos whose shared branch is not-found are excluded.
export function classifyProfile(
  profile: Profile,
  repoBranches: Map<string, RepoBranchInfo>
): CandidateRepo[] {
  const candidates: CandidateRepo[] = [];
  for (const target of profile.targets) {
    const info = repoBranches.get(target.repo);
    const location = locationOf(target.branch, info);
    if (profile.kind === "auto" && location === "not-found") {
      continue; // auto excludes repos not containing the shared branch
    }
    candidates.push({
      name: target.repo,
      rootPath: info?.rootPath ?? "",
      branch: target.branch,
      location,
    });
  }
  return candidates;
}