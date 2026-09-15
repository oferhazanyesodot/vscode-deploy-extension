// Pure, deterministic, injective key for a (profile, repo) pair.
export function checkboxKey(profile: string, repo: string): string {
  return `${profile}::${repo}`;
}