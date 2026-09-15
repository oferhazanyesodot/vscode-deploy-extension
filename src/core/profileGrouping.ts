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

// Pure: produce the three ordered sections (live, environment, hidden), preserving
// input order within each section. A hidden profile appears only in `hidden`.
export function buildProfileSections(
  profiles: Profile[],
  hiddenNames: string[],
  envNames: readonly string[] = ENVIRONMENT_PROFILE_NAMES
): ProfileSections {
  const { visible, hidden } = partitionByHidden(profiles, hiddenNames);
  const live: Profile[] = [];
  const environment: Profile[] = [];
  for (const p of visible) {
    if (classifyProfileGroup(p.name, envNames) === "environment") {
      environment.push(p);
    } else {
      live.push(p);
    }
  }
  return { live, environment, hidden };
}

// Pure: add name if absent, remove all occurrences if present.
export function toggleHidden(list: string[], name: string): string[] {
  if (list.includes(name)) {
    return list.filter((n) => n !== name);
  }
  return [...list, name];
}