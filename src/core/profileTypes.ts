import { RepoCandidate, DeployEnvironment } from "./types";

// --- Branches / profiles ---
export interface RepoBranches {
  repoName: string;
  local: string[];
  remote: string[]; // origin/ prefix stripped
}

export type BranchLocation = "local" | "remote" | "both";

export interface CandidateRepo {
  name: string;
  rootPath: string;
  location: BranchLocation;
}

export interface ProfileInfo {
  branch: string;
  repos: string[]; // repo names containing the branch (>= 2)
  count: number;
}

export interface ProfileSelection {
  kind: "profile";
  branch: string;
  candidates: CandidateRepo[];
}

// --- Repo picker entries ---
export interface IndividualRepoEntry {
  kind: "repo";
  candidate: RepoCandidate;
  label: string;
}

export interface ProfileDeployEntry {
  kind: "profile";
  branch: string;
  repos: string[];
  count: number;
  label: string;
}

export type RepoPickerEntry = IndividualRepoEntry | ProfileDeployEntry;

// --- Dirty handling ---
export type DirtyHandlingAction = "stash" | "skip" | "abort";
export type DirtyHandlingDefault = DirtyHandlingAction | "prompt";
export type DirtyDecision = "proceed" | "prompt" | DirtyHandlingAction;

// --- Checkout ---
export type CheckoutPlan =
  | { kind: "local"; branch: string }
  | { kind: "fetch-track"; branch: string };

// --- Switch results ---
export type CheckoutOutcome =
  | { kind: "switched" }
  | { kind: "skipped" }
  | { kind: "failed"; error: string };

export interface SwitchResult {
  repoName: string;
  location: BranchLocation;
  stashed: boolean;
  outcome: CheckoutOutcome;
}

export interface SwitchSummary {
  branch: string;
  results: SwitchResult[];
  switchedCount: number;
  skippedCount: number;
  failedCount: number;
}

// --- Deploy results ---
export type DispatchOutcome =
  | { kind: "resolution-failed" }
  | { kind: "dispatch-failed"; error: string }
  | { kind: "dispatched"; runId?: string; runUrl?: string };

export interface PerRepositoryResult {
  repoName: string;
  environment: DeployEnvironment;
  workflow?: string;
  dispatch: DispatchOutcome;
  runConclusion?: string;
  runUrl?: string;
}

export interface DeploymentSummary {
  branch: string;
  environment: DeployEnvironment;
  results: PerRepositoryResult[];
  succeededCount: number;
  failedCount: number;
}