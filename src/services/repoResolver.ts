import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RepoCandidate, Cancelled, CANCELLED, NoDeployableRepo } from "../core/types";
import { ProfileSelection, Profile } from "../core/profileTypes";
import { discoverProfiles } from "../core/profileDiscovery";
import { classifyProfile, RepoBranchInfo } from "../core/branchClassification";
import { GitService } from "./gitService";
import { ProfilePicker } from "./profilePicker";

export function hasDeployWorkflow(repoRoot: string): boolean {
  const wfDir = path.join(repoRoot, ".github", "workflows");
  try {
    if (!fs.existsSync(wfDir)) {
      return false;
    }
    const files = fs.readdirSync(wfDir);
    return files.some((f) => /\.(ya?ml)$/i.test(f) && /deploy|run/i.test(f));
  } catch {
    return false;
  }
}

function safeReadDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function candidateRoots(): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots = new Set<string>();
  for (const f of folders) {
    const root = f.uri.fsPath;
    roots.add(root);
    for (const child of safeReadDirs(root)) {
      roots.add(child);
    }
  }
  return [...roots];
}

export type RepoPickerResult = RepoCandidate | ProfileSelection | Cancelled | NoDeployableRepo;

// Build an auto Profile (kind 'auto') from a discovered shared branch.
function autoProfile(branch: string, repos: string[]): Profile {
  return { name: branch, kind: "auto", targets: repos.map((repo) => ({ repo, branch })) };
}

export class RepoResolver {
  constructor(
    private readonly git: GitService,
    private readonly profilePicker: ProfilePicker
  ) {}

  discoverRepos(): RepoCandidate[] {
    const roots = candidateRoots();
    return roots.map((rootPath) => ({
      name: path.basename(rootPath),
      rootPath,
      hasDeployWorkflow: hasDeployWorkflow(rootPath),
    }));
  }

  async resolve(_activeFilePath?: string): Promise<RepoPickerResult> {
    const all = this.discoverRepos();
    const deployable = all.filter((c) => c.hasDeployWorkflow);
    if (deployable.length === 0) {
      return { kind: "no-deployable-repo" };
    }

    // Gather branch data (best-effort).
    const repoBranches: Record<string, string[]> = {};
    const branchInfo = new Map<string, RepoBranchInfo>();
    for (const repo of deployable) {
      try {
        const b = await this.git.listBranches(repo.name, repo.rootPath);
        repoBranches[repo.name] = [...new Set([...b.local, ...b.remote])];
        branchInfo.set(repo.name, {
          rootPath: repo.rootPath,
          local: new Set(b.local),
          remote: new Set(b.remote),
        });
      } catch {
        repoBranches[repo.name] = [];
        branchInfo.set(repo.name, { rootPath: repo.rootPath, local: new Set(), remote: new Set() });
      }
    }

    const autoProfiles = discoverProfiles(repoBranches).map((p) => autoProfile(p.branch, p.repos));

    const choice = await this.profilePicker.pick(autoProfiles, {
      title: "Select a repository or profile to deploy",
      includeIndividualRepos: deployable,
    });

    if (choice.kind === "cancelled") {
      return CANCELLED;
    }
    if (choice.kind === "repo") {
      return choice.candidate;
    }

    // profile or freeText -> build a Profile and classify per target.
    let profile: Profile;
    if (choice.kind === "freeText") {
      const branch = choice.branch;
      const repos = deployable.filter((r) => (repoBranches[r.name] ?? []).includes(branch)).map((r) => r.name);
      profile = autoProfile(branch, repos.length > 0 ? repos : deployable.map((r) => r.name));
    } else {
      profile = choice.profile;
    }

    const candidates = classifyProfile(profile, branchInfo);
    if (candidates.length === 0) {
      void vscode.window.showErrorMessage(`No repository is included in profile "${profile.name}".`);
      return CANCELLED;
    }
    return { kind: "profile", name: profile.name, profileKind: profile.kind, candidates };
  }
}