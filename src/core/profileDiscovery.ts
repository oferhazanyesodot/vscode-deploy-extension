import { ProfileInfo } from "./profileTypes";

// Pure: given a map of repo name -> branch names, return the branches present in
// two or more repositories, each with its exact repo list and count.
export function discoverProfiles(
  repoBranches: Record<string, string[]>
): ProfileInfo[] {
  const branchToRepos = new Map<string, string[]>();
  for (const [repo, branches] of Object.entries(repoBranches)) {
    const seen = new Set<string>();
    for (const b of branches) {
      if (seen.has(b)) {
        continue; // dedupe within a repo
      }
      seen.add(b);
      const list = branchToRepos.get(b) ?? [];
      list.push(repo);
      branchToRepos.set(b, list);
    }
  }
  const profiles: ProfileInfo[] = [];
  for (const [branch, repos] of branchToRepos) {
    if (repos.length >= 2) {
      profiles.push({ branch, repos, count: repos.length });
    }
  }
  return profiles;
}