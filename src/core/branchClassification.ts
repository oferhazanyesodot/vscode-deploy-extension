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
      candidates.push({ name: repo.name, rootPath: repo.rootPath, location: "both" });
    } else if (inLocal) {
      candidates.push({ name: repo.name, rootPath: repo.rootPath, location: "local" });
    } else if (inRemote) {
      candidates.push({ name: repo.name, rootPath: repo.rootPath, location: "remote" });
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
  return { kind: "local", branch };
}