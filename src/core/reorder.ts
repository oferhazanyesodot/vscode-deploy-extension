// Pure: move an item up or down within a list by name. No-op at the boundaries
// or when the item is absent. Preserves all other elements and their order.

export function moveUp(list: string[], name: string): string[] {
  const i = list.indexOf(name);
  if (i <= 0) {
    return list.slice();
  }
  const next = list.slice();
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  return next;
}

export function moveDown(list: string[], name: string): string[] {
  const i = list.indexOf(name);
  if (i < 0 || i >= list.length - 1) {
    return list.slice();
  }
  const next = list.slice();
  [next[i + 1], next[i]] = [next[i], next[i + 1]];
  return next;
}
