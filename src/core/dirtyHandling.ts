import { DirtyHandlingDefault, DirtyDecision } from "./profileTypes";

// Pure: decide what to do for a repo given the configured default and dirtiness.
// Clean tree -> proceed (regardless of default).
// Dirty tree -> "prompt" if default is prompt, else the configured action.
export function decideAction(
  def: DirtyHandlingDefault,
  isDirty: boolean
): DirtyDecision {
  if (!isDirty) {
    return "proceed";
  }
  return def; // "prompt" | "stash" | "skip" | "abort"
}