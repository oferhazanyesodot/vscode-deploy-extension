// Pure: determine whether a repo's currently checked-out branch matches the
// branch a profile targets for that repo.

export interface DriftResult {
  drifted: boolean;
  current: string;
  target: string;
}

export function computeDrift(current: string, target: string): DriftResult {
  const c = current.trim();
  const t = target.trim();
  return { drifted: c !== "" && t !== "" && c !== t, current: c, target: t };
}

// Short label for the tree row description.
export function driftLabel(result: DriftResult): string {
  if (!result.drifted) {
    return "";
  }
  return `on ${result.current}, wants ${result.target}`;
}
