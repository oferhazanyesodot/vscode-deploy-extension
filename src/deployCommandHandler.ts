import {
  RepoCandidate,
  WorkflowSummary,
  DeployEnvironment,
  WorkflowInputDef,
  RunSummary,
  RunView,
  RunPhase,
  Cancelled,
  NoDeployableRepo,
  NoWorkflowFound,
  isCancelled,
} from "./core/types";
import {
  ProfileSelection,
  CandidateRepo,
  PerRepositoryResult,
  DispatchOutcome,
} from "./core/profileTypes";
import { gateFor } from "./core/gating";
import { isDirty } from "./core/gitStatus";
import { parseInputs, additionalInputs } from "./core/workflowInputs";
import { orderRepos } from "./core/deployOrder";
import { buildDeploymentSummary } from "./core/summaries";
import { RepoPhase, TrackedRun } from "./services/multiRunTracker";

export type ResolveResult = RepoCandidate | ProfileSelection | Cancelled | NoDeployableRepo;

// Collaborator interfaces (implemented by the vscode-backed services).
export interface Deps {
  ghIsInstalled(): Promise<boolean>;
  ghIsAuthenticated(repoRoot: string): Promise<boolean>;
  resolveRepo(activeFilePath?: string): Promise<ResolveResult>;
  resolveWorkflow(repo: RepoCandidate): Promise<WorkflowSummary | string | Cancelled | NoWorkflowFound>;
  pickEnvironment(): Promise<DeployEnvironment | Cancelled>;
  gitStatus(repoRoot: string): Promise<{ staged: boolean; unstaged: boolean; untracked: boolean }>;
  currentBranch(repoRoot: string): Promise<string>;
  confirmDirty(): Promise<boolean>;
  confirmPreprod(): Promise<boolean>;
  confirmPreprodProfile(branch: string, repos: string[]): Promise<boolean>;
  viewWorkflowYaml(repoRoot: string, workflow: string): Promise<string>;
  collectInputs(defs: WorkflowInputDef[]): Promise<Record<string, string> | Cancelled>;
  runWorkflow(
    repoRoot: string,
    workflow: string,
    ref: string,
    fields: Record<string, string>
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  identifyRun(
    repoRoot: string,
    workflowName: string,
    branch: string,
    dispatchedAt: Date
  ): Promise<RunSummary | undefined>;
  track(
    repoRoot: string,
    runId: string,
    onPhase: (phase: RunPhase) => void
  ): Promise<RunView | undefined>; // progress handled inside the adapter
  trackMany(
    runs: TrackedRun[],
    onUpdate: (phases: RepoPhase[]) => void
  ): Promise<RepoPhase[]>;
  deployOrder(): string[];
  activeFilePath(): string | undefined;
  // Notifications
  notifyError(message: string): void;
  notifySuccess(repo: string, env: string): void;
  notifyFailure(repo: string, env: string, runUrl: string): void;
  notifyCancelled(repo: string, env: string): void;
  notifyInfo(message: string): void;
  deploymentSummary(branch: string, env: DeployEnvironment, results: PerRepositoryResult[]): void;
}

function workflowDisplayName(w: WorkflowSummary | string): string {
  return typeof w === "string" ? w : w.name;
}
function workflowRef(w: WorkflowSummary | string): string {
  if (typeof w === "string") {
    return w;
  }
  return w.path ? w.path.split("/").pop() ?? w.id : w.id;
}

export class DeployCommandHandler {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const d = this.deps;

    // 1. Prerequisites (Req 11)
    if (!(await d.ghIsInstalled())) {
      d.notifyError("GitHub CLI (gh) is required but was not found on PATH. Install it from https://cli.github.com/.");
      return;
    }

    // 2. Resolve repo OR profile (Req 2, 7)
    const resolved = await d.resolveRepo(d.activeFilePath());
    if (isCancelled(resolved)) {
      return;
    }
    if ((resolved as NoDeployableRepo).kind === "no-deployable-repo") {
      d.notifyError("No deployable repository was found in the workspace.");
      return;
    }
    if ((resolved as ProfileSelection).kind === "profile") {
      await this.executeProfileDeploy(resolved as ProfileSelection);
      return;
    }

    const targetRepo = resolved as RepoCandidate;
    await this.executeSingle(targetRepo);
  }

  // Existing single-repo flow (unchanged behavior).
  private async executeSingle(targetRepo: RepoCandidate): Promise<void> {
    const d = this.deps;

    if (!(await d.ghIsAuthenticated(targetRepo.rootPath))) {
      d.notifyError("GitHub CLI is not authenticated. Run `gh auth login` and try again.");
      return;
    }

    const workflow = await d.resolveWorkflow(targetRepo);
    if (isCancelled(workflow)) {
      return;
    }
    if (typeof workflow !== "string" && (workflow as NoWorkflowFound).kind === "no-workflow-found") {
      d.notifyError(`No deploy workflow was found for ${targetRepo.name}.`);
      return;
    }
    const wf = workflow as WorkflowSummary | string;

    const env = await d.pickEnvironment();
    if (isCancelled(env)) {
      return;
    }
    const environment = env as DeployEnvironment;

    const status = await d.gitStatus(targetRepo.rootPath);
    if (isDirty(status)) {
      const proceed = await d.confirmDirty();
      if (!proceed) {
        return;
      }
    }

    const gate = gateFor(environment);
    if (gate.kind === "confirm") {
      const proceed = await d.confirmPreprod();
      if (!proceed) {
        return;
      }
    }

    const yaml = await d.viewWorkflowYaml(targetRepo.rootPath, workflowRef(wf));
    const defs = yaml ? parseInputs(yaml) : [];
    const extras = additionalInputs(defs);
    let collected: Record<string, string> = {};
    if (extras.length > 0) {
      const result = await d.collectInputs(defs);
      if (isCancelled(result)) {
        return;
      }
      collected = result as Record<string, string>;
    }

    const branch = await d.currentBranch(targetRepo.rootPath);
    const fields: Record<string, string> = { "deployment-environment": environment, ...collected };
    const dispatchedAt = new Date();
    const runResult = await d.runWorkflow(targetRepo.rootPath, workflowRef(wf), branch, fields);
    if (runResult.code !== 0) {
      d.notifyError(`Deployment dispatch failed:\n${runResult.stderr || runResult.stdout}`);
      return;
    }

    const wfName = workflowDisplayName(wf);
    const run = await d.identifyRun(targetRepo.rootPath, wfName, branch, dispatchedAt);
    if (!run) {
      d.notifyInfo(
        `Dispatched ${targetRepo.name} to ${environment}, but the run could not be identified for live tracking. Check GitHub Actions for progress.`
      );
      return;
    }

    const finalView = await d.track(targetRepo.rootPath, run.databaseId, () => {});

    const url = finalView?.url ?? run.url;
    if (!finalView) {
      d.notifyInfo(`Tracking ended for ${targetRepo.name} (${environment}). View run: ${url}`);
      return;
    }
    const conclusion = finalView.conclusion;
    if (conclusion === "success") {
      d.notifySuccess(targetRepo.name, environment);
    } else if (conclusion === "cancelled") {
      d.notifyCancelled(targetRepo.name, environment);
    } else {
      d.notifyFailure(targetRepo.name, environment, url);
    }
  }

  // Profile deploy: dispatch every candidate repo using the profile branch as ref.
  // No checkout, no working-tree mutation. Non-atomic; per-repo results recorded.
  private async executeProfileDeploy(selection: ProfileSelection): Promise<void> {
    const d = this.deps;
    const branch = selection.name;
    const candidates = selection.candidates;

    if (candidates.length === 0) {
      d.notifyError(`No repository contains the profile branch ${branch}.`);
      return;
    }

    // Auth check against the first candidate host (same host in practice).
    if (!(await d.ghIsAuthenticated(candidates[0].rootPath))) {
      d.notifyError("GitHub CLI is not authenticated. Run `gh auth login` and try again.");
      return;
    }

    // Single environment for all (Req 11).
    const env = await d.pickEnvironment();
    if (isCancelled(env)) {
      return;
    }
    const environment = env as DeployEnvironment;

    // Gating (Req 12).
    const gate = gateFor(environment);
    if (gate.kind === "confirm") {
      const proceed = await d.confirmPreprodProfile(branch, candidates.map((c) => c.name));
      if (!proceed) {
        return;
      }
    }

    // Order the candidates (Req 14.1).
    const ordered = orderRepos(candidates, d.deployOrder());

    const results: PerRepositoryResult[] = [];
    const tracked: TrackedRun[] = [];
    const dispatchedAt = new Date();

    for (const repo of ordered) {
      const result = await this.dispatchOne(repo, branch, environment);
      results.push(result.result);
      if (result.tracked) {
        tracked.push(result.tracked);
      }
    }

    // Track all identified runs together (Req 15), then record conclusions.
    if (tracked.length > 0) {
      const phases = await d.trackMany(tracked, () => {});
      for (const phase of phases) {
        const res = results.find((r) => r.repoName === phase.repoName);
        if (res && phase.phase.kind === "completed") {
          res.runConclusion = phase.phase.conclusion;
          res.runUrl = phase.runUrl ?? res.runUrl;
        }
      }
    }

    // Summary (Req 16).
    d.deploymentSummary(branch, environment, results);
    void buildDeploymentSummary(branch, environment, results);
  }

  private async dispatchOne(
    repo: CandidateRepo,
    branch: string,
    environment: DeployEnvironment
  ): Promise<{ result: PerRepositoryResult; tracked?: TrackedRun }> {
    const d = this.deps;

    // Resolve workflow (Req 13).
    const workflow = await d.resolveWorkflow({
      name: repo.name,
      rootPath: repo.rootPath,
      hasDeployWorkflow: true,
    });
    if (isCancelled(workflow) || (typeof workflow !== "string" && (workflow as NoWorkflowFound).kind === "no-workflow-found")) {
      const outcome: DispatchOutcome = { kind: "resolution-failed" };
      return { result: { repoName: repo.name, branch: repo.branch, environment, dispatch: outcome } };
    }
    const wf = workflow as WorkflowSummary | string;

    // Dispatch using the profile branch as ref (Branch_As_Ref, no checkout).
    const dispatchedAt = new Date();
    const runResult = await d.runWorkflow(repo.rootPath, workflowRef(wf), repo.branch, {
      "deployment-environment": environment,
    });
    if (runResult.code !== 0) {
      const outcome: DispatchOutcome = { kind: "dispatch-failed", error: runResult.stderr || runResult.stdout };
      return {
        result: { repoName: repo.name, branch: repo.branch, environment, workflow: workflowDisplayName(wf), dispatch: outcome },
      };
    }

    const run = await d.identifyRun(repo.rootPath, workflowDisplayName(wf), repo.branch, dispatchedAt);
    const outcome: DispatchOutcome = { kind: "dispatched", runId: run?.databaseId, runUrl: run?.url };
    const result: PerRepositoryResult = {
      repoName: repo.name,
      branch: repo.branch,
      environment,
      workflow: workflowDisplayName(wf),
      dispatch: outcome,
      runUrl: run?.url,
    };
    if (run) {
      return { result, tracked: { repoName: repo.name, runId: run.databaseId, repoRoot: repo.rootPath, runUrl: run.url } };
    }
    return { result };
  }
}