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
import { ProfilePicker } from "./services/profilePicker";
import { ManualProfileBuilder } from "./services/manualProfileBuilder";
import { CheckboxStateStore } from "./services/checkboxStateStore";
import { DeployProfilesTreeProvider, DeployTreeNode, ProfileNode } from "./services/deployProfilesTreeProvider";
import { eligibleTargets } from "./core/eligibleTargets";
import { classifyProfile } from "./core/branchClassification";
import { ProfileSelection } from "./core/profileTypes";
import { MultiRunTracker, RepoPhase, TrackedRun } from "./services/multiRunTracker";
import { DeployEnvironment, Cancelled, CANCELLED, RunPhase, WorkflowInputDef } from "./core/types";
import { Profile, DirtyHandlingAction, PerRepositoryResult } from "./core/profileTypes";

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
    resolveWorkflowNonInteractive: (repo) => workflowResolver.resolveNonInteractive(repo),
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

function autoProfileFrom(branch: string): Profile {
  // Free-text / auto selection: the RepoResolver/handler will re-derive targets;
  // here we only need a named auto profile placeholder for the switch flow.
  return { name: branch, kind: "auto", targets: [] };
}

async function pickProfileViaPicker(
  picker: ProfilePicker,
  autoProfiles: Profile[]
): Promise<Profile | Cancelled> {
  const choice = await picker.pick(autoProfiles, {
    title: "Switch profile (select a shared branch or manual profile, or type one)",
    placeholder: "Profile",
  });
  if (choice.kind === "cancelled") {
    return CANCELLED;
  }
  if (choice.kind === "profile") {
    return choice.profile;
  }
  if (choice.kind === "freeText") {
    return autoProfileFrom(choice.branch);
  }
  // A repo entry is not applicable in the switch picker (no individual repos passed).
  return CANCELLED;
}
function buildSwitchDeps(services: {
  git: GitService;
  repoResolver: RepoResolver;
  notify: NotificationService;
  config: ConfigService;
  picker: ProfilePicker;
}): SwitchProfileDeps {
  const { git, repoResolver, notify, config, picker } = services;
  return {
    discoverRepos: () => repoResolver.discoverRepos(),
    listBranches: (name, root) => git.listBranches(name, root),
    pickProfile: (autoProfiles) => pickProfileViaPicker(picker, autoProfiles),
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
  const manualBuilder = new ManualProfileBuilder(git, config);
  const tempResolver = new RepoResolver(git, undefined as unknown as ProfilePicker);
  const profilePicker = new ProfilePicker(config, manualBuilder, () => tempResolver.discoverRepos().filter((r) => r.hasDeployWorkflow));
  const repoResolver = new RepoResolver(git, profilePicker, () => config.globalExclusions());
  const workflowResolver = new WorkflowResolver(gh, config);
  const inputCollector = new InputCollector();
  const runTracker = new RunTracker(gh);
  const multiTracker = new MultiRunTracker(gh);

  const deps = buildDeps({
    gh, git, repoResolver, workflowResolver, inputCollector, runTracker, multiTracker, notify, config,
  });
  const handler = new DeployCommandHandler(deps);

  const switchDeps = buildSwitchDeps({ git, repoResolver, notify, config, picker: profilePicker });
  const switchHandler = new SwitchProfileHandler(switchDeps);

  // Capability C: Deploy Profiles tree view
  const checkboxes = new CheckboxStateStore(context.globalState);
  const treeProvider = new DeployProfilesTreeProvider({
    discoverRepos: () => repoResolver.discoverRepos(),
    listBranches: (name, root) => git.listBranches(name, root),
    config,
    checkboxes,
  });
  void treeProvider.refresh();
  const treeView = vscode.window.createTreeView("deployProfiles", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  } as unknown as vscode.TreeViewOptions<DeployTreeNode>);
  const checkboxSub = (treeView as unknown as {
    onDidChangeCheckboxState?: (h: (e: { items: ReadonlyArray<[DeployTreeNode, vscode.TreeItemCheckboxState]> }) => void) => vscode.Disposable;
  }).onDidChangeCheckboxState?.((e) => void treeProvider.handleCheckboxChange(e.items));

  const buildSelection = (node: ProfileNode): ProfileSelection | undefined => {
    const targets = eligibleTargets(node.profile, (repo) => checkboxes.isChecked(node.profile.name, repo), config.globalExclusions());
    if (targets.length === 0) {
      return undefined;
    }
    const restricted = { ...node.profile, targets };
    const branchInfo = new Map();
    for (const t of targets) {
      const info = treeProvider.branchInfoFor(t.repo);
      if (info) branchInfo.set(t.repo, info);
    }
    const candidates = classifyProfile(restricted, branchInfo);
    return { kind: "profile", name: node.profile.name, profileKind: node.profile.kind, candidates };
  };

  const cmdTreeDeploy = vscode.commands.registerCommand("deploy.profiles.deploy", async (node: ProfileNode) => {
    const selection = buildSelection(node);
    if (!selection) { void vscode.window.showInformationMessage(`Profile "${node.profile.name}" has no eligible repositories to deploy.`); return; }
    await handler.executeProfileDeploy(selection);
  });
  const cmdTreeSwitch = vscode.commands.registerCommand("deploy.profiles.switch", async (node: ProfileNode) => {
    const targets = eligibleTargets(node.profile, (repo) => checkboxes.isChecked(node.profile.name, repo), config.globalExclusions());
    if (targets.length === 0) { void vscode.window.showInformationMessage(`Profile "${node.profile.name}" has no eligible repositories to switch.`); return; }
    await switchHandler.runForProfile({ ...node.profile, targets });
  });
  const cmdTreeHide = vscode.commands.registerCommand("deploy.profiles.hide", async (node: ProfileNode) => {
    const { toggleHidden } = await import("./core/profileGrouping");
    await config.setHiddenProfiles(toggleHidden(config.hiddenProfiles(), node.profile.name));
    await treeProvider.refresh();
  });
  const cmdTreeUnhide = vscode.commands.registerCommand("deploy.profiles.unhide", async (node: ProfileNode) => {
    const { toggleHidden } = await import("./core/profileGrouping");
    await config.setHiddenProfiles(toggleHidden(config.hiddenProfiles(), node.profile.name));
    await treeProvider.refresh();
  });
  const cmdTreeAdd = vscode.commands.registerCommand("deploy.profiles.addManual", async () => {
    await manualBuilder.run(repoResolver.discoverRepos().filter((rr) => rr.hasDeployWorkflow));
    await treeProvider.refresh();
  });
  const cmdTreeRefresh = vscode.commands.registerCommand("deploy.profiles.refresh", () => treeProvider.refresh());

  const deployCommand = vscode.commands.registerCommand("deploy.run", () => handler.execute());
  const switchCommand = vscode.commands.registerCommand("profile.switch", async () => {
    // Focus the stable Deploy Profiles tree (the robust surface) rather than the
    // fragile QuickPick that could be dismissed by focus loss.
    await vscode.commands.executeCommand("deployProfiles.focus");
    void vscode.window.showInformationMessage("Use the Deploy Profiles panel: expand a profile and click Switch.");
  });

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

  context.subscriptions.push(deployCommand, switchCommand, deployStatus, switchStatus, treeView, cmdTreeDeploy, cmdTreeSwitch, cmdTreeHide, cmdTreeUnhide, cmdTreeAdd, cmdTreeRefresh);
  if (checkboxSub) { context.subscriptions.push(checkboxSub); }
}

export function deactivate(): void {
  // Subscriptions disposed by VS Code via context.subscriptions.
}