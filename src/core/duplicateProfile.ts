import { Profile, ProfileTarget } from "./profileTypes";

// Pure: snapshot a profile's current per-repo targets into a manual-profile
// mapping ({ repo -> branch }). Used to "Duplicate as manual profile".
export function targetsToManualMapping(targets: ProfileTarget[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const t of targets) {
    mapping[t.repo] = t.branch;
  }
  return mapping;
}

// Pure: pick an available name for the duplicate that does not collide with an
// existing manual profile name. Appends " copy", then " copy 2", etc.
export function uniqueManualName(base: string, existingNames: string[]): string {
  const set = new Set(existingNames);
  let candidate = `${base} copy`;
  if (!set.has(candidate)) {
    return candidate;
  }
  let n = 2;
  while (set.has(`${base} copy ${n}`)) {
    n++;
  }
  return `${base} copy ${n}`;
}

// Pure: add a repo->branch to a mapping (overwrites existing repo entry).
export function addRepoToMapping(
  mapping: Record<string, string>,
  repo: string,
  branch: string
): Record<string, string> {
  return { ...mapping, [repo]: branch };
}

// Pure: remove a repo from a mapping.
export function removeRepoFromMapping(
  mapping: Record<string, string>,
  repo: string
): Record<string, string> {
  const next = { ...mapping };
  delete next[repo];
  return next;
}
