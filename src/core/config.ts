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
const DIRTY_DEFAULTS = ["stash", "skip", "abort", "prompt"] as const;

export function normalizeConfig(raw: {
  workflowMapping?: unknown;
  pollIntervalSeconds?: unknown;
  pinnedWorkflows?: unknown;
  dirtyHandlingDefault?: unknown;
  deployOrder?: unknown;
  hiddenProfiles?: unknown;
  manualProfiles?: unknown;
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
  const dirty = DIRTY_DEFAULTS.includes(raw.dirtyHandlingDefault as (typeof DIRTY_DEFAULTS)[number])
    ? (raw.dirtyHandlingDefault as DeployConfig["dirtyHandlingDefault"])
    : "prompt";

  const deployOrder = Array.isArray(raw.deployOrder)
    ? raw.deployOrder.filter((x): x is string => typeof x === "string")
    : [];

  const hiddenProfiles = Array.isArray(raw.hiddenProfiles)
    ? raw.hiddenProfiles.filter((x): x is string => typeof x === "string")
    : [];

  const manualProfiles: Record<string, Record<string, string>> = {};
  if (raw.manualProfiles && typeof raw.manualProfiles === "object" && !Array.isArray(raw.manualProfiles)) {
    for (const [name, mapping] of Object.entries(raw.manualProfiles as Record<string, unknown>)) {
      if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
        const clean: Record<string, string> = {};
        for (const [repo, branch] of Object.entries(mapping as Record<string, unknown>)) {
          if (typeof branch === "string") {
            clean[repo] = branch;
          }
        }
        manualProfiles[name] = clean;
      }
    }
  }

  return {
    workflowMapping: mapping,
    pollIntervalSeconds: clampInterval(raw.pollIntervalSeconds),
    pinnedWorkflows: pinned,
    dirtyHandlingDefault: dirty,
    deployOrder,
    hiddenProfiles,
    manualProfiles,
  };
}