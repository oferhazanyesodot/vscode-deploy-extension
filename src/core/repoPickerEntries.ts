import { RepoCandidate } from "./types";
import { ProfileInfo, RepoPickerEntry } from "./profileTypes";

// Pure: build the repo picker entries — one individual entry per repo plus one
// profile entry per detected profile. When there are no profiles, only individual
// entries are produced.
export function buildEntries(
  repos: RepoCandidate[],
  profiles: ProfileInfo[]
): RepoPickerEntry[] {
  const entries: RepoPickerEntry[] = [];
  for (const p of profiles) {
    entries.push({
      kind: "profile",
      branch: p.branch,
      repos: p.repos,
      count: p.count,
      label: `Deploy profile: ${p.branch} (${p.count} repos)`,
    });
  }
  for (const r of repos) {
    entries.push({ kind: "repo", candidate: r, label: r.name });
  }
  return entries;
}