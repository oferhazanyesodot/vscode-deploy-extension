import { WorkflowSummary, NoWorkflowFound } from "./types";

export type WorkflowDecision =
  | { kind: "mapped"; workflow: string }
  | { kind: "resolved"; workflow: WorkflowSummary }
  | { kind: "needs-picker"; workflows: WorkflowSummary[] }
  | NoWorkflowFound;

// Pure: resolve the deploy workflow using mapping first, then discovery count.
export function decideWorkflow(
  repoName: string,
  mappedWorkflow: string | undefined,
  discovered: WorkflowSummary[]
): WorkflowDecision {
  if (mappedWorkflow !== undefined && mappedWorkflow !== "") {
    return { kind: "mapped", workflow: mappedWorkflow };
  }
  if (discovered.length === 0) {
    return { kind: "no-workflow-found", repo: repoName };
  }
  if (discovered.length === 1) {
    return { kind: "resolved", workflow: discovered[0] };
  }
  return { kind: "needs-picker", workflows: discovered };
}
