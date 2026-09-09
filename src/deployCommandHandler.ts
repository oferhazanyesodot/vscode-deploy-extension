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
import { gateFor } from "./core/gating";
import { isDirty } from "./core/gitStatus";
import { parseInputs, additionalInputs } from "./core/workflowInputs";

// Collaborator interfaces (implemented by the vscode-backed services).
export interface Deps {
  ghIsInstalled(): Promise<boolean>;
  ghIsAuthenticated(repoRoot: string): Promise<boolean>;
  resolveRepo(activeFilePath?: string): Promise<RepoCandidate | Cancelled | NoDeployableRepo>;
  resolveWorkflow(repo: RepoCandidate): Promise<WorkflowSummary | string | Cancelled | NoWorkflowFound>;
  pickEnvironment(): Promise<DeployEnvironment | Cancelled>;
  gitStatus(repoRoot: string): Promise<{ staged: boolean; unstaged: boolean; untracked: boolean }>;
  currentBranch(repoRoot: string): Promise<string>;
  confirmDirty(): Promise<boolean>;
  confirmPreprod(): Promise<boolean>;
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
  activeFilePath(): string | undefined;
  // Notifications
  notifyError(message: string): void;
  notifySuccess(repo: string, env: string): void;
  notifyFailure(repo: string, env: string, runUrl: string): void;
  notifyCancelled(repo: string, env: string): void;
  notifyInfo(message: string): void;
}

function workflowDisplayName(w: WorkflowSummary | string): string {
  return typeof w === "string" ? w : w.name;
}
function workflowRef(w: WorkflowSummary | string): string {
  // For dispatch we pass the workflow file name/id; a WorkflowSummary uses its path basename or id.
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

    // 2. Resolve repo (Req 2)
    const repo = await d.resolveRepo(d.activeFilePath());
    if (isCancelled(repo)) {
      return;
    }
    if ((repo as NoDeployableRepo).kind === "no-deployable-repo") {
      d.notifyError("No deployable repository was found in the workspace.");
      return;
    }
    const targetRepo = repo as RepoCandidate;

    // Auth is checked against the target repo host (Req 11.3)
    if (!(await d.ghIsAuthenticated(targetRepo.rootPath))) {
      d.notifyError("GitHub CLI is not authenticated. Run `gh auth login` and try again.");
      return;
    }

    // 3. Resolve workflow (Req 3)
    const workflow = await d.resolveWorkflow(targetRepo);
    if (isCancelled(workflow)) {
      return;
    }
    if (typeof workflow !== "string" && (workflow as NoWorkflowFound).kind === "no-workflow-found") {
      d.notifyError(`No deploy workflow was found for ${targetRepo.name}.`);
      return;
    }
    const wf = workflow as WorkflowSummary | string;

    // 4. Select environment (Req 4)
    const env = await d.pickEnvironment();
    if (isCancelled(env)) {
      return;
    }
    const environment = env as DeployEnvironment;

    // 5. Dirty tree check (Req 5)
    const status = await d.gitStatus(targetRepo.rootPath);
    if (isDirty(status)) {
      const proceed = await d.confirmDirty();
      if (!proceed) {
        return;
      }
    }

    // 6. Environment gate (Req 6)
    const gate = gateFor(environment);
    if (gate.kind === "confirm") {
      const proceed = await d.confirmPreprod();
      if (!proceed) {
        return;
      }
    }
    // gate.kind === "protected" (prod): dispatch and rely on GitHub Environments. No local approval.

    // 7. Collect additional inputs (Req 7)
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

    // 8. Dispatch (Req 8)
    const branch = await d.currentBranch(targetRepo.rootPath);
    const fields: Record<string, string> = { "deployment-environment": environment, ...collected };
    const dispatchedAt = new Date();
    const runResult = await d.runWorkflow(targetRepo.rootPath, workflowRef(wf), branch, fields);
    if (runResult.code !== 0) {
      d.notifyError(`Deployment dispatch failed:\n${runResult.stderr || runResult.stdout}`);
      return;
    }

    // 9. Identify + track (Req 9)
    const wfName = workflowDisplayName(wf);
    const run = await d.identifyRun(targetRepo.rootPath, wfName, branch, dispatchedAt);
    if (!run) {
      d.notifyInfo(
        `Dispatched ${targetRepo.name} to ${environment}, but the run could not be identified for live tracking. Check GitHub Actions for progress.`
      );
      return;
    }

    const finalView = await d.track(targetRepo.rootPath, run.databaseId, () => {});

    // 10. Notify (Req 10)
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
}