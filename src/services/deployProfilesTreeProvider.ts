import * as vscode from "vscode";
import { RepoCandidate } from "../core/types";
import { Profile, ProfileTarget, ProfileSections, ProfileGroup } from "../core/profileTypes";
import { discoverProfiles } from "../core/profileDiscovery";
import { assembleProfiles, manualProfilesFromConfig } from "../core/manualProfiles";
import { buildProfileSections } from "../core/profileGrouping";
import { classifyProfile, RepoBranchInfo } from "../core/branchClassification";
import { isGloballyExcluded } from "../core/globExclusion";
import { GitService } from "./gitService";
import { ConfigService } from "./configService";
import { CheckboxStateStore } from "./checkboxStateStore";

type GroupKind = "live" | "environment" | "hidden";

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
}
export interface RepoCheckboxNode {
  kind: "repo";
  profileName: string;
  target: ProfileTarget;
  location: string;
  globallyExcluded: boolean;
}
export type DeployTreeNode = GroupNode | ProfileNode | RepoCheckboxNode;

const GROUP_LABELS: Record<GroupKind, string> = {
  live: "Live profiles",
  environment: "Environment profiles",
  hidden: "Hidden profiles",
};

export class DeployProfilesTreeProvider implements vscode.TreeDataProvider<DeployTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DeployTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sections: ProfileSections = { live: [], environment: [], hidden: [] };
  private branchInfo = new Map<string, RepoBranchInfo>();
  private globalExclusions: string[] = [];

  constructor(
    private readonly deps: {
      discoverRepos(): RepoCandidate[];
      listBranches(name: string, root: string): Promise<{ repoName: string; local: string[]; remote: string[] }>;
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
    this.sections = buildProfileSections(all, this.deps.config.hiddenProfiles());
    this.globalExclusions = this.deps.config.globalExclusions();
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
      return (["live", "environment", "hidden"] as GroupKind[]).map((group) => ({
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
      return item;
    }
    if (node.kind === "profile") {
      const manual = node.profile.kind === "manual";
      const item = new vscode.TreeItem(node.profile.name, vscode.TreeItemCollapsibleState.Collapsed);
      const tags: string[] = [];
      if (manual) tags.push("(manual)");
      if (node.allExcluded) tags.push("(all excluded)");
      item.description = tags.join(" ");
      item.contextValue =
        node.group === "hidden" ? "profile-hidden" : node.group === "environment" ? "profile-env" : "profile-live";
      return item;
    }
    // repo checkbox node
    const item = new vscode.TreeItem(node.target.repo, vscode.TreeItemCollapsibleState.None);
    if (node.globallyExcluded) {
      item.description = `${node.target.branch} [${node.location}] (excluded)`;
      item.contextValue = "repo-excluded";
      // no checkboxState -> not toggleable
    } else {
      item.description = `${node.target.branch} [${node.location}]`;
      item.contextValue = "repo";
      const checked = this.deps.checkboxes.isChecked(node.profileName, node.target.repo);
      item.checkboxState = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    }
    return item;
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