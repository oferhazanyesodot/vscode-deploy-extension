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
import { DeployProfilesTreeProvider, DeployTreeNode, ProfileNode, RepoCheckboxNode } from "./services/deployProfilesTreeProvider";
import { eligibleTargets } from "./core/eligibleTargets";
import { ProfileSelection } from "./core/profileTypes";
import { branchUrl, comparePrUrl, branchLinksText, branchLinksMarkdown, ProfileBranchLink } from "./core/repoLinks";
import { addExclusion, removeExclusion, stillExcludedByGlob } from "./core/exclusionToggle";
import { DeployHistoryStore } from "./services/deployHistoryStore";
import { DeployHistoryEntry, historyLabel, historyDescription, historyMarkdown } from "./core/deployHistory";
import { targetsToManualMapping, uniqueManualName, addRepoToMapping, removeRepoFromMapping } from "./core/duplicateProfile";
import { moveUp, moveDown } from "./core/reorder";
import { RepoGitStatus } from "./services/deployProfilesTreeProvider";
import { MultiRunTracker, RepoPhase, TrackedRun } from "./services/multiRunTracker";
import { DeployEnvironment, Cancelled, CANCELLED, RunPhase, WorkflowInputDef } from "./core/types";
import { Profile, DirtyHandlingAction, PerRepositoryResult } from "./core/profileTypes";

const ENVIRONMENTS: DeployEnvironment[] = ["dev", "preprod", "prod"];

// Tracks the currently running profile deploy so the sidebar Cancel button can
// abort it. Only one profile deploy runs at a time.
interface ActiveDeploy {
  cts: vscode.CancellationTokenSource;
}
let activeDeploy: ActiveDeploy | undefined;

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
  setSidebarMessage: (msg: string | undefined) => void;
}): Deps {
  const { gh, git, repoResolver, workflowResolver, inputCollector, runTracker, multiTracker, notify, config, setSidebarMessage } = services;
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
      const total = runs.length;
      const report = (phases: RepoPhase[]) => {
        const done = phases.filter((p) => p.phase.kind === "completed").length;
        const running = phases
          .filter((p) => p.phase.kind !== "completed")
          .map((p) => p.repoName);
        const detail = running.length > 0 ? ` - ${running.join(", ")}` : "";
        setSidebarMessage(`$(sync~spin) Deploying ${done}/${total}${detail}  |  Click "Cancel deploy" to stop`);
        onUpdate(phases);
      };
      const cancelled = () => activeDeploy?.cts.token.isCancellationRequested ?? false;
      return multiTracker.track(runs, interval, report, cancelled).finally(() => {
        setSidebarMessage(undefined);
      });
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

  // Capability C: Deploy Profiles tree view
  const checkboxes = new CheckboxStateStore(context.globalState);
  const history = new DeployHistoryStore(context.globalState);
  const treeProvider = new DeployProfilesTreeProvider({
    discoverRepos: () => repoResolver.discoverRepos(),
    listBranches: (name, root) => git.listBranches(name, root),
    repoStatus: async (name, root): Promise<RepoGitStatus> => {
      const [current, status, ab] = await Promise.all([
        git.currentBranch(root),
        git.status(root),
        git.aheadBehind(root),
      ]);
      const dirty = status.staged || status.unstaged || status.untracked;
      return { current, dirty, ahead: ab.ahead, behind: ab.behind };
    },
    config,
    checkboxes,
  });
  void treeProvider.refresh();
  const treeView = vscode.window.createTreeView("deployProfiles", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  } as unknown as vscode.TreeViewOptions<DeployTreeNode>);

  // Sidebar progress: update the tree view's header message during a profile deploy.
  const setSidebarMessage = (msg: string | undefined): void => {
    try {
      (treeView as unknown as { message?: string }).message = msg;
    } catch {
      // message not supported by the host; ignore.
    }
  };

  const deps = buildDeps({
    gh, git, repoResolver, workflowResolver, inputCollector, runTracker, multiTracker, notify, config, setSidebarMessage,
  });
  const handler = new DeployCommandHandler(deps);

  const switchDeps = buildSwitchDeps({ git, repoResolver, notify, config, picker: profilePicker });
  const switchHandler = new SwitchProfileHandler(switchDeps);

  const checkboxSub = (treeView as unknown as {
    onDidChangeCheckboxState?: (h: (e: { items: ReadonlyArray<[DeployTreeNode, vscode.TreeItemCheckboxState]> }) => void) => vscode.Disposable;
  }).onDidChangeCheckboxState?.((e) => void treeProvider.handleCheckboxChange(e.items));

  const buildSelection = (node: ProfileNode): ProfileSelection | undefined => {
    const targets = eligibleTargets(node.profile, (repo) => checkboxes.isChecked(node.profile.name, repo), config.globalExclusions());
    if (targets.length === 0) {
      return undefined;
    }
    // Map each eligible target directly to a candidate. Do NOT re-run classifyProfile
    // here: targets already represent real repos, dispatch uses branch-as-ref regardless
    // of location, and re-classifying could drop repos missing from the branch cache.
    const repos = repoResolver.discoverRepos();
    const candidates = targets.map((t) => {
      const repo = repos.find((rr) => rr.name === t.repo);
      const info = treeProvider.branchInfoFor(t.repo);
      return {
        name: t.repo,
        rootPath: repo?.rootPath ?? info?.rootPath ?? "",
        branch: t.branch,
        location: "both" as const,
      };
    });
    return { kind: "profile", name: node.profile.name, profileKind: node.profile.kind, candidates };
  };

  // Resolve the GitHub web link for a single repo/branch target. Returns undefined
  // when the repo root or its remote URL cannot be determined.
  const linkForTarget = async (repoName: string, branch: string): Promise<ProfileBranchLink | undefined> => {
    const repos = repoResolver.discoverRepos();
    const repo = repos.find((r) => r.name === repoName);
    const root = repo?.rootPath ?? treeProvider.branchInfoFor(repoName)?.rootPath;
    if (!root) {
      return undefined;
    }
    const url = await gh.repoUrl(root);
    if (!url) {
      return undefined;
    }
    return { repo: repoName, branch, url: branchUrl(url, branch) };
  };

  // Gather branch links for every eligible target in a profile.
  const linksForProfile = async (node: ProfileNode): Promise<ProfileBranchLink[]> => {
    const targets = eligibleTargets(node.profile, () => true, config.globalExclusions());
    const links: ProfileBranchLink[] = [];
    for (const t of targets) {
      const link = await linkForTarget(t.repo, t.branch);
      if (link) {
        links.push(link);
      }
    }
    return links;
  };

  const cmdCopyBranchLinks = vscode.commands.registerCommand("deploy.profiles.copyBranchLinks", async (node: ProfileNode) => {
    const links = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Resolving branch links for "${node.profile.name}"...` },
      () => linksForProfile(node)
    );
    if (links.length === 0) { void vscode.window.showWarningMessage(`No branch links could be resolved for "${node.profile.name}".`); return; }
    await vscode.env.clipboard.writeText(branchLinksText(links));
    void vscode.window.showInformationMessage(`Copied ${links.length} branch link(s) for "${node.profile.name}".`);
  });

  const cmdCopyMarkdown = vscode.commands.registerCommand("deploy.profiles.copyMarkdown", async (node: ProfileNode) => {
    const links = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Building checklist for "${node.profile.name}"...` },
      () => linksForProfile(node)
    );
    if (links.length === 0) { void vscode.window.showWarningMessage(`No branch links could be resolved for "${node.profile.name}".`); return; }
    await vscode.env.clipboard.writeText(branchLinksMarkdown(node.profile.name, links));
    void vscode.window.showInformationMessage(`Copied a Markdown checklist for "${node.profile.name}".`);
  });

  const cmdOpenBranches = vscode.commands.registerCommand("deploy.profiles.openBranches", async (node: ProfileNode) => {
    const links = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Opening branches for "${node.profile.name}"...` },
      () => linksForProfile(node)
    );
    if (links.length === 0) { void vscode.window.showWarningMessage(`No branch links could be resolved for "${node.profile.name}".`); return; }
    for (const l of links) {
      await vscode.env.openExternal(vscode.Uri.parse(l.url));
    }
  });

  const cmdMassPr = vscode.commands.registerCommand("deploy.profiles.massPr", async (node: ProfileNode) => {
    const base = await vscode.window.showInputBox({
      title: `Open PRs for "${node.profile.name}"`,
      prompt: "Base branch to open pull requests against (the branch you want to merge INTO)",
      value: "dev",
    });
    if (!base) { return; }
    const targets = eligibleTargets(node.profile, () => true, config.globalExclusions());
    const opened: string[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Opening PR pages (${base} \u2190 profile)...` },
      async () => {
        const repos = repoResolver.discoverRepos();
        for (const t of targets) {
          if (t.branch === base) { continue; } // no PR from a branch into itself
          const repo = repos.find((r) => r.name === t.repo);
          const root = repo?.rootPath ?? treeProvider.branchInfoFor(t.repo)?.rootPath;
          if (!root) { continue; }
          const url = await gh.repoUrl(root);
          if (!url) { continue; }
          await vscode.env.openExternal(vscode.Uri.parse(comparePrUrl(url, base, t.branch)));
          opened.push(t.repo);
        }
      }
    );
    if (opened.length === 0) {
      void vscode.window.showWarningMessage(`No PR pages were opened for "${node.profile.name}".`);
    } else {
      void vscode.window.showInformationMessage(`Opened ${opened.length} PR page(s) into "${base}".`);
    }
  });

  // Repo-level: copy this branch's link.
  const cmdRepoCopyLink = vscode.commands.registerCommand("deploy.repo.copyBranchLink", async (node: RepoCheckboxNode) => {
    const link = await linkForTarget(node.target.repo, node.target.branch);
    if (!link) { void vscode.window.showWarningMessage(`Could not resolve a link for ${node.target.repo}.`); return; }
    await vscode.env.clipboard.writeText(link.url);
    void vscode.window.showInformationMessage(`Copied link to ${node.target.repo} @ ${node.target.branch}.`);
  });

  // Repo-level: open this branch in the browser.
  const cmdRepoOpenBranch = vscode.commands.registerCommand("deploy.repo.openBranch", async (node: RepoCheckboxNode) => {
    const link = await linkForTarget(node.target.repo, node.target.branch);
    if (!link) { void vscode.window.showWarningMessage(`Could not resolve a link for ${node.target.repo}.`); return; }
    await vscode.env.openExternal(vscode.Uri.parse(link.url));
  });

  // Repo-level: open a PR page for this branch into a chosen base.
  const cmdRepoOpenPr = vscode.commands.registerCommand("deploy.repo.openPr", async (node: RepoCheckboxNode) => {
    const base = await vscode.window.showInputBox({
      title: `Open PR for ${node.target.repo}`,
      prompt: "Base branch to open the pull request against",
      value: "dev",
    });
    if (!base) { return; }
    const repos = repoResolver.discoverRepos();
    const repo = repos.find((r) => r.name === node.target.repo);
    const root = repo?.rootPath ?? treeProvider.branchInfoFor(node.target.repo)?.rootPath;
    if (!root) { void vscode.window.showWarningMessage(`Could not resolve ${node.target.repo}.`); return; }
    const url = await gh.repoUrl(root);
    if (!url) { void vscode.window.showWarningMessage(`Could not resolve the GitHub URL for ${node.target.repo}.`); return; }
    await vscode.env.openExternal(vscode.Uri.parse(comparePrUrl(url, base, node.target.branch)));
  });

  // Repo-level: add this repo to global exclusions.
  const cmdRepoExclude = vscode.commands.registerCommand("deploy.repo.exclude", async (node: RepoCheckboxNode) => {
    const next = addExclusion(config.globalExclusions(), node.target.repo);
    await config.setGlobalExclusions(next);
    await treeProvider.refresh();
    void vscode.window.showInformationMessage(`${node.target.repo} is now globally excluded (never deployed or switched from this machine).`);
  });

  // Repo-level: remove this repo from global exclusions.
  const cmdRepoInclude = vscode.commands.registerCommand("deploy.repo.include", async (node: RepoCheckboxNode) => {
    const current = config.globalExclusions();
    const next = removeExclusion(current, node.target.repo);
    await config.setGlobalExclusions(next);
    await treeProvider.refresh();
    if (stillExcludedByGlob(current, node.target.repo)) {
      void vscode.window.showWarningMessage(
        `${node.target.repo} is still excluded by a glob pattern in deploy.globalExclusions. Edit settings to remove that pattern.`
      );
    } else {
      void vscode.window.showInformationMessage(`${node.target.repo} is no longer globally excluded.`);
    }
  });

  // Shared runner: guards against concurrent deploys, streams live per-repo phases
  // to the tree, records history, and remembers the last deploy for "Re-run last".
  const runProfileDeploy = async (
    profileName: string,
    selection: ProfileSelection,
    presetEnvironment?: DeployEnvironment
  ): Promise<void> => {
    if (activeDeploy) {
      void vscode.window.showWarningMessage("A profile deploy is already in progress. Cancel it first.");
      return;
    }
    activeDeploy = { cts: new vscode.CancellationTokenSource() };
    void vscode.commands.executeCommand("setContext", "deploy.deploying", true);
    setSidebarMessage(`$(sync~spin) Preparing deploy for "${profileName}"...`);
    try {
      const outcome = await handler.executeProfileDeploy(selection, {
        presetEnvironment,
        onPhases: (phases) => treeProvider.setDeployPhases(phases),
      });
      if (outcome) {
        const succeeded = outcome.results.filter(
          (r) => r.dispatch.kind === "dispatched" && (r.runConclusion === undefined || r.runConclusion === "success")
        ).length;
        const entry: DeployHistoryEntry = {
          profileName,
          environment: outcome.environment,
          timestamp: new Date().toISOString(),
          succeeded,
          failed: outcome.results.length - succeeded,
          repos: outcome.results.map((r) => ({
            repo: r.repoName,
            branch: r.branch,
            conclusion: r.runConclusion,
            runUrl: r.runUrl,
          })),
        };
        await history.add(entry);
        await context.globalState.update("deploy.lastSelection", { profileName, selection, environment: outcome.environment });
      }
    } finally {
      activeDeploy.cts.dispose();
      activeDeploy = undefined;
      void vscode.commands.executeCommand("setContext", "deploy.deploying", false);
      setSidebarMessage(undefined);
      treeProvider.clearDeployPhases();
    }
  };

  const cmdTreeDeploy = vscode.commands.registerCommand("deploy.profiles.deploy", async (node: ProfileNode) => {
    const selection = buildSelection(node);
    if (!selection) { void vscode.window.showInformationMessage(`Profile "${node.profile.name}" has no eligible repositories to deploy.`); return; }
    await runProfileDeploy(node.profile.name, selection);
  });
  // Environment submenu: deploy straight to dev/preprod/prod without the picker.
  const makeEnvDeploy = (env: DeployEnvironment) =>
    vscode.commands.registerCommand(`deploy.profiles.deploy.${env}`, async (node: ProfileNode) => {
      const selection = buildSelection(node);
      if (!selection) { void vscode.window.showInformationMessage(`Profile "${node.profile.name}" has no eligible repositories to deploy.`); return; }
      await runProfileDeploy(node.profile.name, selection, env);
    });
  const cmdDeployDev = makeEnvDeploy("dev");
  const cmdDeployPreprod = makeEnvDeploy("preprod");
  const cmdDeployProd = makeEnvDeploy("prod");

  // Re-run the last deploy (same profile + environment), skipping the picker.
  const cmdReRunLast = vscode.commands.registerCommand("deploy.profiles.reRunLast", async () => {
    const last = context.globalState.get<{ profileName: string; selection: ProfileSelection; environment: DeployEnvironment }>("deploy.lastSelection");
    if (!last) { void vscode.window.showInformationMessage("No previous deploy to re-run yet."); return; }
    const confirm = await vscode.window.showInformationMessage(
      `Re-run last deploy: "${last.profileName}" to ${last.environment}?`,
      "Re-run"
    );
    if (confirm !== "Re-run") { return; }
    await runProfileDeploy(last.profileName, last.selection, last.environment);
  });
  const cmdTreeCancel = vscode.commands.registerCommand("deploy.profiles.cancel", () => {
    if (!activeDeploy) {
      void vscode.window.showInformationMessage("No deploy is currently running.");
      return;
    }
    activeDeploy.cts.cancel();
    setSidebarMessage("$(stop) Cancelling deploy...");
  });
  const cmdTreeSwitch = vscode.commands.registerCommand("deploy.profiles.switch", async (node: ProfileNode) => {
    const targets = eligibleTargets(node.profile, (repo) => checkboxes.isChecked(node.profile.name, repo), config.globalExclusions());
    if (targets.length === 0) { void vscode.window.showInformationMessage(`Profile "${node.profile.name}" has no eligible repositories to switch.`); return; }
    await switchHandler.runForProfile({ ...node.profile, targets });
  });
  const cmdRename = vscode.commands.registerCommand("deploy.profiles.rename", async (node: ProfileNode) => {
    const currentAlias = config.profileAliases()[node.profile.name];
    const value = await vscode.window.showInputBox({
      title: `Rename "${node.profile.name}" (display only)`,
      prompt: "This changes only how the profile is shown. The real profile/branch name is unchanged. Leave empty to clear.",
      value: currentAlias ?? "",
    });
    if (value === undefined) { return; } // cancelled
    await config.setProfileAlias(node.profile.name, value);
    await treeProvider.refresh();
    if (value.trim() === "") {
      void vscode.window.showInformationMessage(`Cleared display name for "${node.profile.name}".`);
    } else {
      void vscode.window.showInformationMessage(`"${node.profile.name}" now shows as "${value.trim()}".`);
    }
  });
  const cmdClearAlias = vscode.commands.registerCommand("deploy.profiles.clearAlias", async (node: ProfileNode) => {
    await config.setProfileAlias(node.profile.name, undefined);
    await treeProvider.refresh();
    void vscode.window.showInformationMessage(`Cleared display name for "${node.profile.name}".`);
  });
  const cmdRemoveManual = vscode.commands.registerCommand("deploy.profiles.removeManual", async (node: ProfileNode) => {
    if (node.profile.kind !== "manual") {
      void vscode.window.showWarningMessage("Only manual profiles can be removed. Auto profiles come from real branches.");
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Remove manual profile "${node.profile.name}"? This deletes its definition from settings.`,
      { modal: true },
      "Remove"
    );
    if (confirm !== "Remove") { return; }
    await config.removeManualProfile(node.profile.name);
    // Also clear any alias tied to it so settings don't accumulate orphans.
    await config.setProfileAlias(node.profile.name, undefined);
    await treeProvider.refresh();
    void vscode.window.showInformationMessage(`Removed manual profile "${node.profile.name}".`);
  });
  const cmdStar = vscode.commands.registerCommand("deploy.profiles.star", async (node: ProfileNode) => {
    const { toggleStarred } = await import("./core/profileGrouping");
    await config.setStarredProfiles(toggleStarred(config.starredProfiles(), node.profile.name));
    await treeProvider.refresh();
  });
  const cmdUnstar = vscode.commands.registerCommand("deploy.profiles.unstar", async (node: ProfileNode) => {
    const { toggleStarred } = await import("./core/profileGrouping");
    await config.setStarredProfiles(toggleStarred(config.starredProfiles(), node.profile.name));
    await treeProvider.refresh();
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
  const cmdRefreshStatuses = vscode.commands.registerCommand("deploy.profiles.refreshStatuses", async () => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Refreshing repo statuses (branch, dirty, ahead/behind)..." },
      () => treeProvider.refreshStatuses()
    );
  });

  // Deploy history: show a picker of recent deploys; selecting one opens its runs.
  const cmdShowHistory = vscode.commands.registerCommand("deploy.profiles.showHistory", async () => {
    const entries = history.all();
    if (entries.length === 0) { void vscode.window.showInformationMessage("No deploys recorded yet."); return; }
    const picked = await vscode.window.showQuickPick(
      entries.map((e, i) => ({ label: historyLabel(e), description: historyDescription(e), detail: `${e.repos.length} repo(s)`, index: i })),
      { title: "Deploy history", placeHolder: "Select a deploy to open its runs / copy its summary" }
    );
    if (!picked) { return; }
    const entry = entries[picked.index];
    const action = await vscode.window.showQuickPick(
      [
        { label: "$(link-external) Open all runs", value: "open" },
        { label: "$(markdown) Copy summary as Markdown", value: "md" },
      ],
      { title: historyLabel(entry) }
    );
    if (!action) { return; }
    if (action.value === "open") {
      for (const r of entry.repos) {
        if (r.runUrl) { await vscode.env.openExternal(vscode.Uri.parse(r.runUrl)); }
      }
    } else {
      await vscode.env.clipboard.writeText(historyMarkdown(entry));
      void vscode.window.showInformationMessage("Copied deploy summary to clipboard.");
    }
  });
  const cmdClearHistory = vscode.commands.registerCommand("deploy.profiles.clearHistory", async () => {
    const confirm = await vscode.window.showWarningMessage("Clear all deploy history?", { modal: true }, "Clear");
    if (confirm === "Clear") { await history.clear(); void vscode.window.showInformationMessage("Deploy history cleared."); }
  });

  // Duplicate a profile into a new editable manual profile (snapshot per-repo branches).
  const cmdDuplicateManual = vscode.commands.registerCommand("deploy.profiles.duplicateAsManual", async (node: ProfileNode) => {
    const mapping = targetsToManualMapping(node.profile.targets);
    if (Object.keys(mapping).length === 0) { void vscode.window.showWarningMessage("Nothing to duplicate: profile has no targets."); return; }
    const suggested = uniqueManualName(node.profile.name, Object.keys(config.manualProfiles()));
    const name = await vscode.window.showInputBox({ title: "Duplicate as manual profile", prompt: "Name for the new manual profile", value: suggested });
    if (!name || name.trim() === "") { return; }
    await config.setManualProfile(name.trim(), mapping);
    await treeProvider.refresh();
    void vscode.window.showInformationMessage(`Created manual profile "${name.trim()}" from "${node.profile.name}".`);
  });

  // Add a repo to a manual profile (pick repo, then branch).
  const cmdAddRepoToManual = vscode.commands.registerCommand("deploy.profiles.addRepo", async (node: ProfileNode) => {
    if (node.profile.kind !== "manual") { void vscode.window.showWarningMessage("Only manual profiles can be edited."); return; }
    const repos = repoResolver.discoverRepos().filter((r) => r.hasDeployWorkflow);
    const repoPick = await vscode.window.showQuickPick(repos.map((r) => ({ label: r.name, description: r.rootPath, repo: r })), { title: `Add a repo to "${node.profile.name}"`, placeHolder: "Repository" });
    if (!repoPick) { return; }
    const branches = await git.listBranches(repoPick.repo.name, repoPick.repo.rootPath);
    const names = [...new Set([...branches.local, ...branches.remote])];
    const branchPick = await vscode.window.showQuickPick(names, { title: `Branch for ${repoPick.repo.name}`, placeHolder: "Branch" });
    if (branchPick === undefined) { return; }
    const current = config.manualProfiles()[node.profile.name] ?? {};
    await config.setManualProfile(node.profile.name, addRepoToMapping(current, repoPick.repo.name, branchPick));
    await treeProvider.refresh();
    void vscode.window.showInformationMessage(`Added ${repoPick.repo.name} @ ${branchPick} to "${node.profile.name}".`);
  });

  // Remove a repo from a manual profile (pick which one).
  const cmdRemoveRepoFromManual = vscode.commands.registerCommand("deploy.profiles.removeRepo", async (node: ProfileNode) => {
    if (node.profile.kind !== "manual") { void vscode.window.showWarningMessage("Only manual profiles can be edited."); return; }
    const current = config.manualProfiles()[node.profile.name] ?? {};
    const repoNames = Object.keys(current);
    if (repoNames.length === 0) { void vscode.window.showInformationMessage("This manual profile has no repos."); return; }
    const pick = await vscode.window.showQuickPick(repoNames.map((r) => ({ label: r, description: current[r] })), { title: `Remove a repo from "${node.profile.name}"`, placeHolder: "Repository to remove" });
    if (!pick) { return; }
    await config.setManualProfile(node.profile.name, removeRepoFromMapping(current, pick.label));
    await treeProvider.refresh();
    void vscode.window.showInformationMessage(`Removed ${pick.label} from "${node.profile.name}".`);
  });

  // Edit a manual profile: re-run the builder (which overwrites on confirm).
  const cmdEditManual = vscode.commands.registerCommand("deploy.profiles.editManual", async (node: ProfileNode) => {
    if (node.profile.kind !== "manual") { void vscode.window.showWarningMessage("Only manual profiles can be edited."); return; }
    await manualBuilder.run(repoResolver.discoverRepos().filter((rr) => rr.hasDeployWorkflow));
    await treeProvider.refresh();
  });

  // Reorder starred profiles.
  const cmdStarMoveUp = vscode.commands.registerCommand("deploy.profiles.starMoveUp", async (node: ProfileNode) => {
    await config.setStarredProfiles(moveUp(config.starredProfiles(), node.profile.name));
    await treeProvider.refresh();
  });
  const cmdStarMoveDown = vscode.commands.registerCommand("deploy.profiles.starMoveDown", async (node: ProfileNode) => {
    await config.setStarredProfiles(moveDown(config.starredProfiles(), node.profile.name));
    await treeProvider.refresh();
  });

  // Repo-level: copy plain branch name.
  const cmdRepoCopyName = vscode.commands.registerCommand("deploy.repo.copyBranchName", async (node: RepoCheckboxNode) => {
    await vscode.env.clipboard.writeText(node.target.branch);
    void vscode.window.showInformationMessage(`Copied "${node.target.branch}".`);
  });
  // Repo-level: open the repo's Actions runs page.
  const cmdRepoOpenActions = vscode.commands.registerCommand("deploy.repo.openActions", async (node: RepoCheckboxNode) => {
    const repos = repoResolver.discoverRepos();
    const root = repos.find((r) => r.name === node.target.repo)?.rootPath ?? treeProvider.branchInfoFor(node.target.repo)?.rootPath;
    if (!root) { void vscode.window.showWarningMessage(`Could not resolve ${node.target.repo}.`); return; }
    const url = await gh.repoUrl(root);
    if (!url) { void vscode.window.showWarningMessage(`Could not resolve the GitHub URL for ${node.target.repo}.`); return; }
    await vscode.env.openExternal(vscode.Uri.parse(`${url.replace(/\/+$/, "")}/actions`));
  });
  // Repo-level: checkout the profile's target branch locally (with dirty prompt).
  const cmdRepoCheckout = vscode.commands.registerCommand("deploy.repo.checkoutLocal", async (node: RepoCheckboxNode) => {
    const repos = repoResolver.discoverRepos();
    const root = repos.find((r) => r.name === node.target.repo)?.rootPath ?? treeProvider.branchInfoFor(node.target.repo)?.rootPath;
    if (!root) { void vscode.window.showWarningMessage(`Could not resolve ${node.target.repo}.`); return; }
    const status = await git.status(root);
    if (status.staged || status.unstaged || status.untracked) {
      const action = await vscode.window.showWarningMessage(
        `${node.target.repo} has uncommitted changes. How to proceed with checkout of ${node.target.branch}?`,
        { modal: true }, "Stash & checkout", "Cancel"
      );
      if (action !== "Stash & checkout") { return; }
      await git.stashChanges(root);
    }
    // Try a plain checkout first; fall back to a tracking checkout for remote-only branches.
    let res = await git.checkoutBranch(root, node.target.branch);
    if (res.code !== 0) {
      await git.fetchBranch(root, node.target.branch);
      res = await git.checkoutTrackingBranch(root, node.target.branch);
    }
    if (res.code !== 0) {
      void vscode.window.showErrorMessage(`Checkout of ${node.target.branch} failed in ${node.target.repo}: ${res.stderr || res.stdout}`);
    } else {
      void vscode.window.showInformationMessage(`${node.target.repo} is now on ${node.target.branch}.`);
    }
    await treeProvider.refreshStatuses();
  });
  // Repo-level: fetch + fast-forward pull.
  const cmdRepoFetchPull = vscode.commands.registerCommand("deploy.repo.fetchPull", async (node: RepoCheckboxNode) => {
    const repos = repoResolver.discoverRepos();
    const root = repos.find((r) => r.name === node.target.repo)?.rootPath ?? treeProvider.branchInfoFor(node.target.repo)?.rootPath;
    if (!root) { void vscode.window.showWarningMessage(`Could not resolve ${node.target.repo}.`); return; }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Fetch + pull ${node.target.repo}...` },
      async () => { await git.fetchAll(root); await git.pull(root); }
    );
    await treeProvider.refreshStatuses();
  });

  // Prod approval reminder.
  const cmdProdReminder = vscode.commands.registerCommand("deploy.profiles.prodInfo", async (node: ProfileNode) => {
    const repos = repoResolver.discoverRepos();
    const first = node.profile.targets[0]?.repo;
    const root = first ? repos.find((r) => r.name === first)?.rootPath : undefined;
    const url = root ? await gh.repoUrl(root) : undefined;
    const open = await vscode.window.showInformationMessage(
      "Prod deploys use GitHub Environments and may require another person's approval. The approver acts on the run's page (it can be skipped if configured).",
      ...(url ? ["Open Environments settings"] : [])
    );
    if (open && url) { await vscode.env.openExternal(vscode.Uri.parse(`${url.replace(/\/+$/, "")}/settings/environments`)); }
  });

  // Settings quick-edit: jump to the relevant deploy.* setting.
  const cmdOpenSettings = vscode.commands.registerCommand("deploy.openSettings", async () => {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:ofer.vscode-deploy-extension");
  });

  const deployCommand = vscode.commands.registerCommand("deploy.run", () => handler.execute());
  const switchCommand = vscode.commands.registerCommand("profile.switch", async () => {
    // Focus the stable Deploy Profiles tree (the robust surface) rather than the
    // fragile QuickPick that could be dismissed by focus loss.
    await vscode.commands.executeCommand("deployProfiles.focus");
    void vscode.window.showInformationMessage("Use the Deploy Profiles panel: expand a profile and click Switch.");
  });

  context.subscriptions.push(
    deployCommand, switchCommand, treeView,
    cmdTreeDeploy, cmdTreeCancel, cmdTreeSwitch, cmdTreeHide, cmdTreeUnhide, cmdTreeAdd, cmdTreeRefresh,
    cmdRename, cmdClearAlias, cmdRemoveManual, cmdStar, cmdUnstar,
    cmdCopyBranchLinks, cmdCopyMarkdown, cmdOpenBranches, cmdMassPr,
    cmdRepoCopyLink, cmdRepoOpenBranch, cmdRepoOpenPr, cmdRepoExclude, cmdRepoInclude,
    cmdDeployDev, cmdDeployPreprod, cmdDeployProd, cmdReRunLast,
    cmdRefreshStatuses, cmdShowHistory, cmdClearHistory,
    cmdDuplicateManual, cmdAddRepoToManual, cmdRemoveRepoFromManual, cmdEditManual,
    cmdStarMoveUp, cmdStarMoveDown,
    cmdRepoCopyName, cmdRepoOpenActions, cmdRepoCheckout, cmdRepoFetchPull,
    cmdProdReminder, cmdOpenSettings
  );
  if (checkboxSub) { context.subscriptions.push(checkboxSub); }
}

export function deactivate(): void {
  // Subscriptions disposed by VS Code via context.subscriptions.
}
