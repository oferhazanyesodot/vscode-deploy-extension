import { WorkflowSummary } from "./types";

// The file name of a workflow (basename of its path), used for matching.
export function workflowFileName(w: WorkflowSummary): string {
  const parts = w.path.split(/[\\/]/);
  return parts[parts.length - 1] ?? w.path;
}

// True if a pinned identifier matches a workflow by file name or id.
function matchesPin(w: WorkflowSummary, pin: string): boolean {
  return pin === w.id || pin === workflowFileName(w) || pin === w.path;
}

// Pure: reorder discovered workflows so pinned ones come first (in pinned-list order),
// followed by the remaining workflows in their original order.
// - Output is always a permutation of `workflows` (no additions/removals).
// - Pinned identifiers that match no workflow are ignored.
// - A workflow matched by multiple pinned ids appears once, at its earliest pin position.
export function orderByPinned(
  workflows: WorkflowSummary[],
  pinned: string[]
): WorkflowSummary[] {
  const used = new Set<number>();
  const pinnedResult: WorkflowSummary[] = [];

  for (const pin of pinned) {
    for (let i = 0; i < workflows.length; i++) {
      if (used.has(i)) {
        continue;
      }
      if (matchesPin(workflows[i], pin)) {
        pinnedResult.push(workflows[i]);
        used.add(i);
      }
    }
  }

  const rest: WorkflowSummary[] = [];
  for (let i = 0; i < workflows.length; i++) {
    if (!used.has(i)) {
      rest.push(workflows[i]);
    }
  }

  return [...pinnedResult, ...rest];
}

// Pure: is a given workflow pinned by any of the pinned identifiers?
export function isPinned(w: WorkflowSummary, pinned: string[]): boolean {
  return pinned.some((p) => matchesPin(w, p));
}