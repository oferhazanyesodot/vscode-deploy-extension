import { RunView, RunPhase, RunConclusion } from "./types";

function mapConclusion(conclusion: string | null): RunConclusion {
  switch (conclusion) {
    case "success":
      return "success";
    case "cancelled":
      return "cancelled";
    case "failure":
    case "timed_out":
    case "startup_failure":
    case "action_required":
    case "stale":
    case "neutral":
    case "skipped":
      return "failure";
    default:
      return "other";
  }
}

// Classify a raw gh run view into the UI-facing phase. Total over all inputs.
export function classifyPhase(view: RunView): RunPhase {
  if (view.status === "completed") {
    return { kind: "completed", conclusion: mapConclusion(view.conclusion) };
  }
  if (view.status === "waiting") {
    return { kind: "waiting-approval" };
  }
  return { kind: "pending" };
}
