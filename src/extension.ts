import * as vscode from "vscode";
import { DeployCommandHandler, Deps } from "./deployCommandHandler";
import { SwitchProfileHandler, SwitchProfileDeps } from "./switchProfileHandler";
import { SpawnProcessRunner } from "./services/processRunner";
import { GhCliService } from "./services/ghCliService";
import { GitService } from "./services/gitService";
import { ConfigService } from "./services/configService";
import { NotificationService } from "./services/notificationService";
import { RepoResolver } from "./services/repoResolver";
import { WorkflowResolver } from "./services/workflowResolver";
import { InputCollector } from "./services/inputCollector";
import { RunTracker } from "./services/runTracker";
import { MultiRunTracker, RepoPhase, TrackedRun } from "./services/multiRunTracker";
import { DeployEnvironment, Cancelled, CANCELLED, RunPhase, WorkflowInputDef } from "./core/types";
import { ProfileInfo, DirtyHandlingAction, PerRepositoryResult } from "./core/profileTypes";

const ENVIRONMENTS: DeployEnvironment[] = ["dev", "preprod", "prod"];

async function pickEnvironment(): Promise<DeployEnvironment | Cancelled> {
  const picked = await vscode.window.showQuickPick(
    ENVIRONMENTS.map((e) => ({ label: e })),
    { title: "Select deployment environment", placeHolder: "Environment" }
  );
  if (!picked) {
    return CANCELLED;
  }
  return picked.label as DeployEnvironment;
}

function buildDeps(services: {
  gh: GhCliService;
  git: GitService;
  repoResolver: RepoResolver;
  workflowResolver: WorkflowResolver;
  inputCollector: InputCollector;
  runTracker: RunTracker;
  multiTracker: MultiRunTracker;
  notify: NotificationService;
  config: ConfigService;
}): Deps {
  const { gh, git, repoResolver, workflowResolver, inputCollector, runTracker, multiTracker, notify, config } = services;
  return {
    ghIsInstalled: () => gh.isInstalled(),
    ghIsAuthenticated: (root) => gh.isAuthenticated(root),
    resolveRepo: (active) => repoResolver.resolve(active),
    resolveWorkflow: (repo) => workflowResolver.resolve(repo),
    pickEnvironment,
    gitStatus: (root) => git.status(root),
    currentBranch: (root) => git.currentBranch(root),
    confirmDirty: () =>
      notify.warnConfirm(
        "You have uncommitted changes. They will NOT be deployed. Continue with the deployment?"
      ),
    confirmPreprod: () =>
      notify.confirm("Deploy to PREPROD? This will trigger a preprod deployment."),
    confirmPreprodProfile: (branch, repos) =>
      notify.confirm(`Deploy profile '${branch}' to PREPROD across ${repos.length} repos (${repos.join(", ")})?`),
    viewWorkflowYaml: (root, wf) => gh.viewWorkflowYaml(root, wf),
    collectInputs: (defs: WorkflowInputDef[]) => inputCollector.collect(defs),
    runWorkflow: (root, wf, ref, fields) => gh.runWorkflow(root, wf, ref, fields),
    identifyRun: (root, wfName, branch, at) => runTracker.identifyRun(root, wfName, branch, at),
    track: (root, runId, onPhase) => {
      const interval = config.get().pollIntervalSeconds * 1000;
      return Promise.resolve(vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Deploying...",
          cancellable: true,
        },
        (progress, token) => {
          let lastPercent = 0;
          const report = (phase: RunPhase, prog: { total: number; completed: number; percent: number; currentJob?: string }) => {
            let msg: string;
            if (phase.kind === "waiting-approval") {
              msg = "Waiting for approval (GitHub Environments)...";
            } else if (phase.kind === "completed") {
              msg = `Completed: ${phase.conclusion}`;
            } else if (prog.total > 0) {
              const job = prog.currentJob ? ` - ${prog.currentJob}` : "";
              msg = `${prog.completed}/${prog.total} jobs (${prog.percent}%)${job}`;
            } else {
              msg = "Starting...";
            }
            const increment = phase.kind === "completed" ? 100 - lastPercent : Math.max(0, prog.percent - lastPercent);
            lastPercent = phase.kind === "completed" ? 100 : prog.percent;
            progress.report({ message: msg, increment });
            onPhase(phase);
          };
          return runTracker.track(root, runId, interval, report, () => token.isCancellationRequested);
        }
      ));
    },
    trackMany: (runs: TrackedRun[], onUpdate: (phases: RepoPhase[]) => void) => {
      const interval = config.get().pollIntervalSeconds * 1000;
      return Promise.resolve(vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Profile deploy...",
          cancellable: true,
        },
        (progress, token) => {
          const total = runs.length;
          let lastDone = 0;
          const report = (phases: RepoPhase[]) => {
            const done = phases.filter((p) => p.phase.kind === "completed").length;
            const lines = phases
              .map((p) => {
                if (p.phase.kind === "completed") {
                  return `${p.repoName}: ${p.phase.conclusion}`;
                }
                if (p.phase.kind === "waiting-approval") {
                  return `${p.repoName}: waiting approval`;
                }
                const pct = p.progress ? ` ${p.progress.percent}%` : "";
                return `${p.repoName}: running${pct}`;
              })
              .join(" | ");
            const increment = total > 0 ? ((done - lastDone) / total) * 100 : 0;
            lastDone = done;
            progress.report({ message: lines, increment });
            onUpdate(phases);
          };
          return multiTracker.track(runs, interval, report, () => token.isCancellationRequested);
        }
      ));
    },
    deployOrder: () => config.deployOrder(),
    activeFilePath: () => vscode.window.activeTextEditor?.document.uri.fsPath,
    notifyError: (m) => notify.error(m),
    notifySuccess: (r, e) => notify.success(r, e),
    notifyFailure: (r, e, u) => notify.failure(r, e, u),
    notifyCancelled: (r, e) => notify.cancelled(r, e),
    notifyInfo: (m) => void vscode.window.showInformationMessage(m),
    deploymentSummary: (branch, env, results: PerRepositoryResult[]) => notify.deploymentSummary(
      // build the summary object via the core builder inside the service call:
      { branch, environment: env, results, succeededCount: results.filter((r) => r.dispatch.kind === "dispatched" && (r.runConclusion === undefined || r.runConclusion === "success")).length, failedCount: results.filter((r) => !(r.dispatch.kind === "dispatched" && (r.runConclusion === undefined || r.runConclusion === "success"))).length }
    ),
  };
}

async function pickProfile(profiles: ProfileInfo[]): Promise<string | Cancelled> {
  const items = profiles.map((p) => ({
    label: `$(git-branch) ${p.branch}`,
    description: `${p.count} repos`,
    branch: p.branch,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Switch profile (select a shared branch, or type one)",
    placeHolder: "Profile branch name",
  });
  if (picked) {
    return picked.branch;
  }
  // Allow free-text entry when nothing is picked.
  const typed = await vscode.window.showInputBox({
    title: "Switch profile",
    prompt: "Enter a branch name to switch all matching repos to",
  });
  if (typed === undefined || typed.trim() === "") {
    return CANCELLED;
  }
  return typed.trim();
}

function buildSwitchDeps(services: {
  git: GitService;
  repoResolver: RepoResolver;
  notify: NotificationService;
  config: ConfigService;
}): SwitchProfileDeps {
  const { git, repoResolver, notify, config } = services;
  return {
    discoverRepos: () => repoResolver.discoverRepos(),
    listBranches: (name, root) => git.listBranches(name, root),
    pickProfile,
    status: (root) => git.status(root),
    promptDirtyAction: async (repoName) => {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "stash", description: "Stash changes, then switch" },
          { label: "skip", description: "Leave this repo as-is" },
          { label: "abort", description: "Cancel the whole switch" },
        ],
        { title: `${repoName} has uncommitted changes`, placeHolder: "How should this repo be handled?" }
      );
      if (!picked) {
        return CANCELLED;
      }
      return picked.label as DirtyHandlingAction;
    },
    stashChanges: (root) => git.stashChanges(root),
    fetchBranch: (root, branch) => git.fetchBranch(root, branch),
    checkoutBranch: (root, branch) => git.checkoutBranch(root, branch),
    checkoutTrackingBranch: (root, branch) => git.checkoutTrackingBranch(root, branch),
    dirtyHandlingDefault: () => config.dirtyHandlingDefault(),
    notifyError: (m) => notify.error(m),
    reportSummary: (branch, results) => notify.switchSummary({
      branch,
      results,
      switchedCount: results.filter((r) => r.outcome.kind === "switched").length,
      skippedCount: results.filter((r) => r.outcome.kind === "skipped").length,
      failedCount: results.filter((r) => r.outcome.kind === "failed").length,
    }),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const proc = new SpawnProcessRunner();
  const gh = new GhCliService(proc);
  const git = new GitService(proc);
  const config = new ConfigService();
  const notify = new NotificationService();
  const repoResolver = new RepoResolver(git);
  const workflowResolver = new WorkflowResolver(gh, config);
  const inputCollector = new InputCollector();
  const runTracker = new RunTracker(gh);
  const multiTracker = new MultiRunTracker(gh);

  const deps = buildDeps({
    gh, git, repoResolver, workflowResolver, inputCollector, runTracker, multiTracker, notify, config,
  });
  const handler = new DeployCommandHandler(deps);

  const switchDeps = buildSwitchDeps({ git, repoResolver, notify, config });
  const switchHandler = new SwitchProfileHandler(switchDeps);

  const deployCommand = vscode.commands.registerCommand("deploy.run", () => handler.execute());
  const switchCommand = vscode.commands.registerCommand("profile.switch", () => switchHandler.execute());

  const deployStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  deployStatus.text = "$(rocket) Deploy";
  deployStatus.tooltip = "Run a deployment";
  deployStatus.command = "deploy.run";
  deployStatus.show();

  const switchStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  switchStatus.text = "$(git-branch) Profile";
  switchStatus.tooltip = "Switch all repos to a profile branch";
  switchStatus.command = "profile.switch";
  switchStatus.show();

  context.subscriptions.push(deployCommand, switchCommand, deployStatus, switchStatus);
}

export function deactivate(): void {
  // Subscriptions disposed by VS Code via context.subscriptions.
}