import * as vscode from "vscode";
import { DeployCommandHandler, Deps } from "./deployCommandHandler";
import { SpawnProcessRunner } from "./services/processRunner";
import { GhCliService } from "./services/ghCliService";
import { GitService } from "./services/gitService";
import { ConfigService } from "./services/configService";
import { NotificationService } from "./services/notificationService";
import { RepoResolver } from "./services/repoResolver";
import { WorkflowResolver } from "./services/workflowResolver";
import { InputCollector } from "./services/inputCollector";
import { RunTracker } from "./services/runTracker";
import { DeployEnvironment, Cancelled, CANCELLED, RunPhase, WorkflowInputDef } from "./core/types";

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
  notify: NotificationService;
  config: ConfigService;
}): Deps {
  const { gh, git, repoResolver, workflowResolver, inputCollector, runTracker, notify, config } = services;
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
            // Determinate bar: report only the delta since last poll.
            const increment = phase.kind === "completed" ? 100 - lastPercent : Math.max(0, prog.percent - lastPercent);
            lastPercent = phase.kind === "completed" ? 100 : prog.percent;
            progress.report({ message: msg, increment });
            onPhase(phase);
          };
          return runTracker.track(root, runId, interval, report, () => token.isCancellationRequested);
        }
      ));
    },
    activeFilePath: () => vscode.window.activeTextEditor?.document.uri.fsPath,
    notifyError: (m) => notify.error(m),
    notifySuccess: (r, e) => notify.success(r, e),
    notifyFailure: (r, e, u) => notify.failure(r, e, u),
    notifyCancelled: (r, e) => notify.cancelled(r, e),
    notifyInfo: (m) => void vscode.window.showInformationMessage(m),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const proc = new SpawnProcessRunner();
  const gh = new GhCliService(proc);
  const git = new GitService(proc);
  const config = new ConfigService();
  const notify = new NotificationService();
  const repoResolver = new RepoResolver();
  const workflowResolver = new WorkflowResolver(gh, config);
  const inputCollector = new InputCollector();
  const runTracker = new RunTracker(gh);

  const deps = buildDeps({
    gh, git, repoResolver, workflowResolver, inputCollector, runTracker, notify, config,
  });
  const handler = new DeployCommandHandler(deps);

  const command = vscode.commands.registerCommand("deploy.run", () => handler.execute());

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(rocket) Deploy";
  statusBar.tooltip = "Run a deployment";
  statusBar.command = "deploy.run";
  statusBar.show();

  context.subscriptions.push(command, statusBar);
}

export function deactivate(): void {
  // Subscriptions disposed by VS Code via context.subscriptions.
}