import { isGloballyExcluded } from "./globExclusion";

// Pure helpers for adding/removing an exact repo name from the globalExclusions
// list. Adding uses the exact repo name (not a glob); removing strips any exact
// match AND, when possible, patterns that specifically match this repo by exact
// name. Glob patterns like "*-manifests" are left untouched by include() unless
// they equal the repo name exactly, so a user's broad rules are preserved.

export function addExclusion(patterns: string[], repoName: string): string[] {
  if (patterns.includes(repoName)) {
    return patterns.slice();
  }
  return [...patterns, repoName];
}

// Remove any pattern that is exactly the repo name. Broad globs are preserved,
// so callers should check isEffectivelyExcluded to warn the user when a repo is
// still excluded by a surviving glob.
export function removeExclusion(patterns: string[], repoName: string): string[] {
  return patterns.filter((p) => p !== repoName);
}

// True if the repo is currently excluded by any pattern (exact or glob).
export function isEffectivelyExcluded(patterns: string[], repoName: string): boolean {
  return isGloballyExcluded(repoName, patterns);
}

// After removeExclusion, is the repo STILL excluded by a surviving glob pattern?
export function stillExcludedByGlob(patterns: string[], repoName: string): boolean {
  const remaining = removeExclusion(patterns, repoName);
  return isGloballyExcluded(repoName, remaining);
}
