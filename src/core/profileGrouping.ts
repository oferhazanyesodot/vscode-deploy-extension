import { Profile, ProfileGroup, ProfileSections, ENVIRONMENT_PROFILE_NAMES } from "./profileTypes";

// Pure: classify a profile name as environment (member of the built-in set) or live.
export function classifyProfileGroup(
  name: string,
  envNames: readonly string[] = ENVIRONMENT_PROFILE_NAMES
): ProfileGroup {
  return envNames.includes(name) ? "environment" : "live";
}

// Pure: split profiles into visible vs hidden by name membership.
export function partitionByHidden(
  profiles: Profile[],
  hiddenNames: string[]
): { visible: Profile[]; hidden: Profile[] } {
  const hiddenSet = new Set(hiddenNames);
  const visible: Profile[] = [];
  const hidden: Profile[] = [];
  for (const p of profiles) {
    if (hiddenSet.has(p.name)) {
      hidden.push(p);
    } else {
      visible.push(p);
    }
  }
  return { visible, hidden };
}

// Pure: produce the ordered sections, preserving input order within each section.
// Precedence for placement (a profile appears in exactly ONE section):
//   1. hidden   (strongest "get it out of my way")
//   2. starred  (pin to the top, regardless of natural group)
//   3. manual   (manual-kind profiles get their own section)
//   4. environment (dev/preprod/prod/main/master/staging by name)
//   5. live     (everything else â€” feature/auto branches)
export function buildProfileSections(
  profiles: Profile[],
  hiddenNames: string[],
  starredNames: string[] = [],
  envNames: readonly string[] = ENVIRONMENT_PROFILE_NAMES
): ProfileSections {
  const hiddenSet = new Set(hiddenNames);
  const starredSet = new Set(starredNames);

  const starred: Profile[] = [];
  const live: Profile[] = [];
  const manual: Profile[] = [];
  const environment: Profile[] = [];
  const hidden: Profile[] = [];

  for (const p of profiles) {
    if (hiddenSet.has(p.name)) {
      hidden.push(p);
    } else if (starredSet.has(p.name)) {
      starred.push(p);
    } else if (p.kind === "manual") {
      manual.push(p);
    } else if (classifyProfileGroup(p.name, envNames) === "environment") {
      environment.push(p);
    } else {
      live.push(p);
    }
  }
  return { starred, live, manual, environment, hidden };
}

// Pure: add name if absent, remove all occurrences if present.
// Used for both hidden and starred lists.
export function toggleHidden(list: string[], name: string): string[] {
  if (list.includes(name)) {
    return list.filter((n) => n !== name);
  }
  return [...list, name];
}

// Alias for readability at call sites dealing with the starred list.
export const toggleStarred = toggleHidden;