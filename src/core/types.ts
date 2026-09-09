// Shared data models and flow-control signals for the deploy extension.

// --- Flow-control sentinels ---
export type Cancelled = { kind: "cancelled" };
export type NoDeployableRepo = { kind: "no-deployable-repo" };
export type NoWorkflowFound = { kind: "no-workflow-found"; repo: string };

export const CANCELLED: Cancelled = { kind: "cancelled" };
export const NO_DEPLOYABLE_REPO: NoDeployableRepo = { kind: "no-deployable-repo" };

export function isCancelled(v: unknown): v is Cancelled {
  return typeof v === "object" && v !== null && (v as { kind?: string }).kind === "cancelled";
}

// --- Environment and gating ---
export type DeployEnvironment = "dev" | "preprod" | "prod";

export type Gate =
  | { kind: "none" }
  | { kind: "confirm" }
  | { kind: "protected" };

// --- Repositories ---
export interface RepoCandidate {
  name: string;
  rootPath: string;
  hasDeployWorkflow: boolean;
}

// --- Workflows ---
export interface WorkflowSummary {
  id: string;
  name: string;
  path: string;
}

export type WorkflowInputType = "string" | "boolean" | "choice" | "number" | "environment";

export interface WorkflowInputDef {
  name: string;
  type: WorkflowInputType;
  required: boolean;
  default?: string | boolean;
  options?: string[];
  description?: string;
}

// --- Git ---
export interface GitStatus {
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

// --- Runs ---
export interface RunSummary {
  databaseId: string;
  name: string;
  headBranch: string;
  status: string;
  createdAt: string;
  url: string;
}

export interface RunViewJob {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface RunView {
  databaseId: string;
  status: string;
  conclusion: string | null;
  url: string;
  jobs?: RunViewJob[];
}

export type RunConclusion = "success" | "failure" | "cancelled" | "other";

export type RunPhase =
  | { kind: "pending" }
  | { kind: "waiting-approval" }
  | { kind: "completed"; conclusion: RunConclusion };

// --- Process ---
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

// --- Config ---
export interface DeployConfig {
  workflowMapping: Record<string, string>;
  pollIntervalSeconds: number;
  pinnedWorkflows: Record<string, string[]>;
}
