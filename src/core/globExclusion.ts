// Pure glob matching for global exclusions. Supports the `*` wildcard.
export function matchesGlob(name: string, pattern: string): boolean {
  // Escape every regex special char except `*`, then turn `*` into `.*`, anchored.
  let re = "";
  for (const ch of pattern) {
    if (ch === "*") {
      re += ".*";
    } else if (".[]{}()+?^$|\\/-".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`).test(name);
}

export function isGloballyExcluded(name: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(name, p));
}