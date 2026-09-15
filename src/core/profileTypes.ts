import { RepoCandidate, DeployEnvironment } from "./types";

// --- Branches / profiles ---
export interface RepoBranches {
  repoName: string;
  local: string[];
  remote: string[]; // origin/ prefix stripped
}

// 'not-found' applies to a manual target whose branch exists in neither location.
export type BranchLocation = "local" | "remote" | "both" | "not-found";

export interface CandidateRepo {
  name: string;
  rootPath: string;
  branch: string; // this repo's target branch (per-target model)
  location: BranchLocation;
}

export interface ProfileInfo {
  branch: string;
  repos: string[]; // repo names containing the branch (>= 2)
  count: number;
}

// --- Generalized profile model ---
export type ProfileKind = "auto" | "manual";

export interface ProfileTarget {
  repo: string;   // repository name
  branch: string; // branch to check out (Switch) / dispatch against (Deploy)
}

export interface Profile {
  name: string;
  kind: ProfileKind;
  targets: ProfileTarget[];
}

export const ENVIRONMENT_PROFILE_NAMES = [
  "dev",
  "preprod",
  "prod",
  "main",
  "master",
  "staging",
] as const;

export type ProfileGroup = "live" | "environment";

export interface ProfileSections {
  starred: Profile[];
  live: Profile[];
  manual: Profile[];
  environment: Profile[];
  hidden: Profile[];
}

export interface ProfileSelection {
  kind: "profile";
  name: string;
  profileKind: ProfileKind;
  candidates: CandidateRepo[]; // each carries its own target branch
}

// --- Repo picker entries ---
export interface IndividualRepoEntry {
  kind: "repo";
  candidate: RepoCandidate;
  label: string;
}

export interface ProfileDeployEntry {
  kind: "profile";
  profile: Profile;
  count: number;
  manual: boolean;
  section: ProfileGroup | "hidden";
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
  | { kind: "fetch-track"; branch: string }
  | { kind: "not-found"; branch: string };

// --- Switch results ---
export type CheckoutOutcome =
  | { kind: "switched" }
  | { kind: "skipped" }
  | { kind: "failed"; error: string };

export interface SwitchResult {
  repoName: string;
  branch: string;
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
  branch: string;
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