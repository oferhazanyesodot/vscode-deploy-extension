import { Profile, ProfileTarget } from "./profileTypes";
import { isGloballyExcluded } from "./globExclusion";

export type CheckboxLookup = (repo: string) => boolean | undefined;

// Pure: targets that are checked (undefined => checked) AND not globally excluded,
// preserving the profile's target order.
export function eligibleTargets(
  profile: Profile,
  checkbox: CheckboxLookup,
  globalExclusions: string[]
): ProfileTarget[] {
  return profile.targets.filter((t) => {
    if (isGloballyExcluded(t.repo, globalExclusions)) {
      return false;
    }
    const checked = checkbox(t.repo);
    return checked === undefined ? true : checked;
  });
}