// Pure: parse `git branch --list` or `git branch -r` output into branch names.
export function parseBranchList(output: string, kind: "local" | "remote"): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === "") {
      continue;
    }
    // Local current-branch marker.
    if (line.startsWith("* ")) {
      line = line.slice(2).trim();
    }
    // Worktree marker "+ branch".
    if (line.startsWith("+ ")) {
      line = line.slice(2).trim();
    }
    if (kind === "remote") {
      // Skip symbolic entry: origin/HEAD -> origin/main
      if (line.includes("->")) {
        continue;
      }
      // Strip a leading remote name (e.g. origin/).
      const slash = line.indexOf("/");
      if (slash >= 0) {
        line = line.slice(slash + 1);
      }
    }
    if (line === "" || seen.has(line)) {
      continue;
    }
    seen.add(line);
    names.push(line);
  }
  return names;
}