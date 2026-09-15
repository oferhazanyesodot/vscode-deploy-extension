import { RepoCandidate } from "./types";
import { Profile, RepoPickerEntry, ProfileGroup } from "./profileTypes";
import { classifyProfileGroup } from "./profileGrouping";

// Pure: build the repo picker entries — one individual entry per repo plus one
// profile entry per profile. Profiles carry their section (live/environment/hidden)
// and a manual tag. `hiddenNames` marks which profiles belong to the hidden section.
export function buildEntries(
  repos: RepoCandidate[],
  profiles: Profile[],
  hiddenNames: string[] = []
): RepoPickerEntry[] {
  const entries: RepoPickerEntry[] = [];
  const hiddenSet = new Set(hiddenNames);
  for (const p of profiles) {
    const manual = p.kind === "manual";
    const section: ProfileGroup | "hidden" = hiddenSet.has(p.name)
      ? "hidden"
      : classifyProfileGroup(p.name);
    const count = p.targets.length;
    const tag = manual ? " (manual)" : "";
    entries.push({
      kind: "profile",
      profile: p,
      count,
      manual,
      section,
      label: `Deploy profile: ${p.name} (${count} repos)${tag}`,
    });
  }
  for (const r of repos) {
    entries.push({ kind: "repo", candidate: r, label: r.name });
  }
  return entries;
}