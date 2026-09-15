// Pure: order candidates so those named in `deployOrder` come first (in that order),
// unknown names in deployOrder are ignored, and the rest follow in discovery order.
export function orderRepos<T extends { name: string }>(
  candidates: T[],
  deployOrder: string[]
): T[] {
  const used = new Set<number>();
  const ordered: T[] = [];
  for (const name of deployOrder) {
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) {
        continue;
      }
      if (candidates[i].name === name) {
        ordered.push(candidates[i]);
        used.add(i);
      }
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    if (!used.has(i)) {
      ordered.push(candidates[i]);
    }
  }
  return ordered;
}