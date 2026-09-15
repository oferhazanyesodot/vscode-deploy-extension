import * as vscode from "vscode";
import { RepoCandidate } from "../core/types";
import { Profile, ProfileTarget, ProfileSections, ProfileGroup } from "../core/profileTypes";
import { discoverProfiles } from "../core/profileDiscovery";
import { assembleProfiles, manualProfilesFromConfig } from "../core/manualProfiles";
import { buildProfileSections } from "../core/profileGrouping";
import { classifyProfile, RepoBranchInfo } from "../core/branchClassification";
import { isGloballyExcluded } from "../core/globExclusion";
import { computeDrift } from "../core/branchDrift";
import { RepoPhase } from "./multiRunTracker";
import { GitService } from "./gitService";
import { ConfigService } from "./configService";
import { CheckboxStateStore } from "./checkboxStateStore";

// Lazy per-repo git status used for drift / dirty / ahead-behind badges.
export interface RepoGitStatus {
  current: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

type GroupKind = "starred" | "live" | "manual" | "environment" | "hidden";

export interface GroupNode {
  kind: "group";
  group: GroupKind;
  label: string;
}
export interface ProfileNode {
  kind: "profile";
  profile: Profile;
  group: GroupKind;
  allExcluded: boolean;
  starred: boolean;
}
export interface RepoCheckboxNode {
  kind: "repo";
  profileName: string;
  target: ProfileTarget;
  location: string;
  globallyExcluded: boolean;
}
export type DeployTreeNode = GroupNode | ProfileNode | RepoCheckboxNode;

const GROUP_ORDER: GroupKind[] = ["starred", "live", "manual", "environment", "hidden"];

const GROUP_LABELS: Record<GroupKind, string> = {
  starred: "Starred profiles",
  live: "Live profiles",
  manual: "Manual profiles",
  environment: "Environment profiles",
  hidden: "Hidden profiles",
};

export class DeployProfilesTreeProvider implements vscode.TreeDataProvider<DeployTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DeployTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sections: ProfileSections = { starred: [], live: [], manual: [], environment: [], hidden: [] };
  private branchInfo = new Map<string, RepoBranchInfo>();
  private globalExclusions: string[] = [];
  private aliases: Record<string, string> = {};
  private starred = new Set<string>();
  // Lazy per-repo git status (drift/dirty/ahead-behind). Populated by refreshStatuses().
  private gitStatus = new Map<string, RepoGitStatus>();
  private statusesLoaded = false;
  // Live per-repo deploy phase during an active profile deploy.
  private deployPhases = new Map<string, RepoPhase>();

  constructor(
    private readonly deps: {
      discoverRepos(): RepoCandidate[];
      listBranches(name: string, root: string): Promise<{ repoName: string; local: string[]; remote: string[] }>;
      repoStatus(name: string, root: string): Promise<RepoGitStatus>;
      config: ConfigService;
      checkboxes: CheckboxStateStore;
    }
  ) {}

  async refresh(): Promise<void> {
    const repos = this.deps.discoverRepos().filter((r) => r.hasDeployWorkflow);
    const repoBranches: Record<string, string[]> = {};
    this.branchInfo = new Map();
    for (const repo of repos) {
      try {
        const b = await this.deps.listBranches(repo.name, repo.rootPath);
        repoBranches[repo.name] = [...new Set([...b.local, ...b.remote])];
        this.branchInfo.set(repo.name, { rootPath: repo.rootPath, local: new Set(b.local), remote: new Set(b.remote) });
      } catch {
        repoBranches[repo.name] = [];
        this.branchInfo.set(repo.name, { rootPath: repo.rootPath, local: new Set(), remote: new Set() });
      }
    }
    const autoProfiles = discoverProfiles(repoBranches).map((p) => ({
      name: p.branch,
      kind: "auto" as const,
      targets: p.repos.map((repo) => ({ repo, branch: p.branch })),
    }));
    const manual = manualProfilesFromConfig(this.deps.config.manualProfiles());
    const all = assembleProfiles(autoProfiles, manual);
    const starredNames = this.deps.config.starredProfiles();
    this.starred = new Set(starredNames);
    this.sections = buildProfileSections(all, this.deps.config.hiddenProfiles(), starredNames);
    this.globalExclusions = this.deps.config.globalExclusions();
    this.aliases = this.deps.config.profileAliases();
    this._onDidChangeTreeData.fire(undefined);
  }

  // Lazily gather per-repo git status (current branch, dirty, ahead/behind).
  // Called on demand via the "Refresh statuses" action, not on every refresh.
  async refreshStatuses(): Promise<void> {
    const repos = this.deps.discoverRepos().filter((r) => r.hasDeployWorkflow);
    const next = new Map<string, RepoGitStatus>();
    for (const repo of repos) {
      try {
        next.set(repo.name, await this.deps.repoStatus(repo.name, repo.rootPath));
      } catch {
        // leave unknown
      }
    }
    this.gitStatus = next;
    this.statusesLoaded = true;
    this._onDidChangeTreeData.fire(undefined);
  }

  // Set live deploy phases (per repo) during an active profile deploy and refresh
  // the affected repo rows so they show a spinner / check / cross.
  setDeployPhases(phases: RepoPhase[]): void {
    this.deployPhases = new Map(phases.map((p) => [p.repoName, p]));
    this._onDidChangeTreeData.fire(undefined);
  }

  clearDeployPhases(): void {
    if (this.deployPhases.size === 0) {
      return;
    }
    this.deployPhases = new Map();
    this._onDidChangeTreeData.fire(undefined);
  }

  private profilesFor(group: GroupKind): Profile[] {
    return this.sections[group];
  }

  private allExcluded(profile: Profile): boolean {
    return profile.targets.length > 0 && profile.targets.every((t) => isGloballyExcluded(t.repo, this.globalExclusions));
  }

  getChildren(node?: DeployTreeNode): DeployTreeNode[] {
    if (!node) {
      // Only show sections that have at least one profile, so empty sections
      // (e.g. no starred yet) don't clutter the tree.
      return GROUP_ORDER.filter((group) => this.profilesFor(group).length > 0).map((group) => ({
        kind: "group",
        group,
        label: GROUP_LABELS[group],
      }));
    }
    if (node.kind === "group") {
      return this.profilesFor(node.group).map((profile) => ({
        kind: "profile",
        profile,
        group: node.group,
        allExcluded: this.allExcluded(profile),
        starred: this.starred.has(profile.name),
      }));
    }
    if (node.kind === "profile") {
      const candidates = classifyProfile(node.profile, this.branchInfo);
      return candidates.map((c) => ({
        kind: "repo",
        profileName: node.profile.name,
        target: { repo: c.name, branch: c.branch },
        location: c.location,
        globallyExcluded: isGloballyExcluded(c.name, this.globalExclusions),
      }));
    }
    return [];
  }

  getTreeItem(node: DeployTreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "group";
      // Distinct icon per section so the groups read apart at a glance.
      const groupIcon: Record<GroupKind, string> = {
        starred: "star-full",
        live: "rocket",
        manual: "list-selection",
        environment: "server-environment",
        hidden: "eye-closed",
      };
      const starColor = new vscode.ThemeColor("charts.yellow");
      item.iconPath =
        node.group === "starred"
          ? new vscode.ThemeIcon("star-full", starColor)
          : new vscode.ThemeIcon(groupIcon[node.group]);
      return item;
    }
    if (node.kind === "profile") {
      const manual = node.profile.kind === "manual";
      const alias = this.aliases[node.profile.name];
      const label = alias ?? node.profile.name;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);

      const tags: string[] = [];
      // When aliased, show the real profile/branch name so it is never hidden.
      if (alias) tags.push(node.profile.name);
      if (manual) tags.push("(manual)");
      if (node.allExcluded) tags.push("(all excluded)");
      item.description = tags.join("  ");

      // Icon + color per group, with a distinct look for manual and starred profiles.
      let iconId: string;
      let color: vscode.ThemeColor | undefined;
      if (node.starred) {
        // Starred profiles always show a filled yellow star, wherever they sit.
        iconId = "star-full";
        color = new vscode.ThemeColor("charts.yellow");
      } else if (node.group === "hidden") {
        iconId = manual ? "list-unordered" : "git-branch";
      } else if (node.group === "environment") {
        iconId = "globe";
        color = new vscode.ThemeColor("charts.blue");
      } else if (manual) {
        iconId = "list-selection";
        color = new vscode.ThemeColor("charts.purple");
      } else {
        // live
        iconId = "git-branch";
        color = new vscode.ThemeColor("charts.green");
      }
      item.iconPath = color ? new vscode.ThemeIcon(iconId, color) : new vscode.ThemeIcon(iconId);

      // contextValue carries: base group, manual flag, star state Ã¢â‚¬â€ so menu
      // when-clauses can show the right inline/context actions.
      // Examples: "profile-live-manual-unstarred", "profile-env-starred".
      const base =
        node.group === "hidden"
          ? "profile-hidden"
          : node.group === "environment"
          ? "profile-env"
          : node.group === "starred"
          ? "profile-starred-group"
          : node.group === "manual"
          ? "profile-manualgroup"
          : "profile-live";
      const kindTag = manual ? "-manual" : "";
      const starTag = node.starred ? "-starred" : "-unstarred";
      item.contextValue = base + kindTag + starTag;

      const aliasNote = alias ? ` (shown as "${alias}")` : "";
      item.tooltip = `${node.profile.name}${aliasNote} Ã¢â‚¬â€ ${node.profile.targets.length} repo(s)${manual ? ", manual profile" : ""}${node.starred ? ", starred" : ""}`;
      return item;
    }
    // repo checkbox node
    const item = new vscode.TreeItem(node.target.repo, vscode.TreeItemCollapsibleState.None);
    const phase = this.deployPhases.get(node.target.repo);
    const gs = this.gitStatus.get(node.target.repo);

    // Build a description with branch/location plus any status badges.
    const parts: string[] = [`${node.target.branch} [${node.location}]`];

    // Drift: currently checked-out branch differs from the profile target.
    if (gs) {
      const drift = computeDrift(gs.current, node.target.branch);
      if (drift.drifted) {
        parts.push(`âš  on ${gs.current}`);
      }
      if (gs.dirty) {
        parts.push("â— dirty");
      }
      if (gs.ahead > 0 || gs.behind > 0) {
        parts.push(`â†‘${gs.ahead} â†“${gs.behind}`);
      }
    }

    if (node.globallyExcluded) {
      parts.push("(excluded)");
      item.description = parts.join("  ");
      item.contextValue = "repo-excluded";
      item.iconPath = new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground"));
      // no checkboxState -> not toggleable
      item.tooltip = this.repoTooltip(node, gs, phase);
      return item;
    }

    item.contextValue = "repo";
    const checked = this.deps.checkboxes.isChecked(node.profileName, node.target.repo);
    item.checkboxState = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

    // Icon reflects an active deploy phase first, otherwise drift/dirty, else repo.
    if (phase) {
      if (phase.phase.kind === "completed") {
        const c = phase.phase.conclusion;
        parts.push(c);
        item.iconPath =
          c === "success"
            ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.green"))
            : c === "cancelled"
            ? new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("charts.yellow"))
            : new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
      } else if (phase.phase.kind === "waiting-approval") {
        parts.push("waiting approval");
        item.iconPath = new vscode.ThemeIcon("watch", new vscode.ThemeColor("charts.yellow"));
      } else {
        const pct = phase.progress ? ` ${phase.progress.percent}%` : "";
        parts.push(`running${pct}`);
        item.iconPath = new vscode.ThemeIcon("sync~spin");
      }
    } else if (gs && computeDrift(gs.current, node.target.branch).drifted) {
      item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
    } else if (gs && gs.dirty) {
      item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.orange"));
    } else {
      item.iconPath = new vscode.ThemeIcon("repo");
    }

    item.description = parts.join("  ");
    item.tooltip = this.repoTooltip(node, gs, phase);
    return item;
  }

  private repoTooltip(node: RepoCheckboxNode, gs?: RepoGitStatus, phase?: RepoPhase): string {
    const lines = [`${node.target.repo} â€” target branch: ${node.target.branch} [${node.location}]`];
    if (gs) {
      lines.push(`Checked out: ${gs.current || "unknown"}`);
      if (computeDrift(gs.current, node.target.branch).drifted) {
        lines.push(`âš  Drift: on ${gs.current}, profile wants ${node.target.branch}`);
      }
      lines.push(`Working tree: ${gs.dirty ? "dirty (uncommitted changes)" : "clean"}`);
      lines.push(`Ahead ${gs.ahead}, behind ${gs.behind} vs upstream`);
    } else if (!this.statusesLoaded) {
      lines.push("(run 'Refresh statuses' for branch/dirty/ahead-behind)");
    }
    if (phase) {
      lines.push(`Deploy: ${phase.phase.kind}`);
    }
    return lines.join("\n");
  }

  async handleCheckboxChange(
    items: ReadonlyArray<[DeployTreeNode, vscode.TreeItemCheckboxState]>
  ): Promise<void> {
    for (const [node, state] of items) {
      if (node.kind !== "repo" || node.globallyExcluded) {
        continue;
      }
      await this.deps.checkboxes.setChecked(
        node.profileName,
        node.target.repo,
        state === vscode.TreeItemCheckboxState.Checked
      );
    }
  }

  // Expose sections + branchInfo for command handlers building selections.
  currentSections(): ProfileSections {
    return this.sections;
  }
  branchInfoFor(repo: string): RepoBranchInfo | undefined {
    return this.branchInfo.get(repo);
  }
  currentGlobalExclusions(): string[] {
    return this.globalExclusions;
  }
}