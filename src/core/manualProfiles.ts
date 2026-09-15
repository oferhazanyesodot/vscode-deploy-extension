import { Profile } from "./profileTypes";

// Pure: build a manual Profile from a { repo -> branch } mapping.
export function manualProfileToTargets(
  name: string,
  mapping: Record<string, string>
): Profile {
  return {
    name,
    kind: "manual",
    targets: Object.entries(mapping).map(([repo, branch]) => ({ repo, branch })),
  };
}

// Pure: union auto + manual profiles. An auto and a manual profile that share a name
// remain distinct entries (no merge, no dedupe across kinds).
export function assembleProfiles(
  autoProfiles: Profile[],
  manualProfiles: Profile[]
): Profile[] {
  return [...manualProfiles, ...autoProfiles];
}

// Convenience: turn the raw deploy.manualProfiles config into Profile[].
export function manualProfilesFromConfig(
  config: Record<string, Record<string, string>>
): Profile[] {
  return Object.entries(config).map(([name, mapping]) => manualProfileToTargets(name, mapping));
}