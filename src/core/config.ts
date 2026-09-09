import { DeployConfig } from "./types";

export const MIN_POLL_INTERVAL_SECONDS = 2;
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;

// Pure: clamp a poll interval to the allowed minimum, with a fallback default.
export function clampInterval(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
  return value < MIN_POLL_INTERVAL_SECONDS ? MIN_POLL_INTERVAL_SECONDS : value;
}

// Pure: normalize a raw settings object into a DeployConfig.
export function normalizeConfig(raw: {
  workflowMapping?: unknown;
  pollIntervalSeconds?: unknown;
  pinnedWorkflows?: unknown;
}): DeployConfig {
  const mapping: Record<string, string> = {};
  if (raw.workflowMapping && typeof raw.workflowMapping === "object") {
    for (const [k, v] of Object.entries(raw.workflowMapping as Record<string, unknown>)) {
      if (typeof v === "string") {
        mapping[k] = v;
      }
    }
  }
  const pinned: Record<string, string[]> = {};
  if (raw.pinnedWorkflows && typeof raw.pinnedWorkflows === "object") {
    for (const [k, v] of Object.entries(raw.pinnedWorkflows as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        pinned[k] = v.filter((x): x is string => typeof x === "string");
      }
    }
  }
  return {
    workflowMapping: mapping,
    pollIntervalSeconds: clampInterval(raw.pollIntervalSeconds),
    pinnedWorkflows: pinned,
  };
}