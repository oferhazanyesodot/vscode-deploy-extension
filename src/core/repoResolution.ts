import { RepoCandidate, NoDeployableRepo, NO_DEPLOYABLE_REPO } from "./types";

// Normalize a filesystem path for ancestor comparison.
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// True if `root` is an ancestor of (or equal to) `filePath`.
export function isAncestor(root: string, filePath: string): boolean {
  const r = normalize(root);
  const f = normalize(filePath);
  if (f === r) {
    return true;
  }
  return f.startsWith(r + "/");
}

// Pure: choose the candidate to preselect given the active file path.
// Returns the candidate whose rootPath is an ancestor of the active file, if any.
export function preselect(
  candidates: RepoCandidate[],
  activeFilePath?: string
): RepoCandidate | undefined {
  const deployable = candidates.filter((c) => c.hasDeployWorkflow);
  if (activeFilePath === undefined) {
    return undefined;
  }
  // Prefer the deepest matching root (most specific).
  let best: RepoCandidate | undefined;
  for (const c of deployable) {
    if (isAncestor(c.rootPath, activeFilePath)) {
      if (best === undefined || c.rootPath.length > best.rootPath.length) {
        best = c;
      }
    }
  }
  return best;
}

export type RepoDecision =
  | { kind: "resolved"; repo: RepoCandidate }
  | { kind: "needs-picker"; candidates: RepoCandidate[]; preselected?: RepoCandidate }
  | NoDeployableRepo;

// Pure: decide repo resolution based on candidate count and active file.
export function decideRepo(
  candidates: RepoCandidate[],
  activeFilePath?: string
): RepoDecision {
  const deployable = candidates.filter((c) => c.hasDeployWorkflow);
  if (deployable.length === 0) {
    return NO_DEPLOYABLE_REPO;
  }
  if (deployable.length === 1) {
    return { kind: "resolved", repo: deployable[0] };
  }
  return {
    kind: "needs-picker",
    candidates: deployable,
    preselected: preselect(candidates, activeFilePath),
  };
}
