import { GitStatus } from "./types";

// Parse `git status --porcelain` output into change categories.
// Porcelain v1 format: XY <path>
//   X = index (staged) status, Y = worktree (unstaged) status.
//   "??" = untracked.
export function parseStatus(porcelain: string): GitStatus {
  const status: GitStatus = { staged: false, unstaged: false, untracked: false };
  const lines = porcelain.split(/\r?\n/);
  for (const raw of lines) {
    if (raw.length === 0) {
      continue;
    }
    // A valid porcelain entry has at least 2 status chars + a space.
    const x = raw[0];
    const y = raw[1];
    if (x === "?" && y === "?") {
      status.untracked = true;
      continue;
    }
    // Staged: index column is not space and not "?".
    if (x !== " " && x !== "?" && x !== undefined) {
      status.staged = true;
    }
    // Unstaged: worktree column is not space and not "?".
    if (y !== " " && y !== "?" && y !== undefined) {
      status.unstaged = true;
    }
  }
  return status;
}

export function isDirty(s: GitStatus): boolean {
  return s.staged || s.unstaged || s.untracked;
}
