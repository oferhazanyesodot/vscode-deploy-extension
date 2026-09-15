import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RepoCandidate, Cancelled, CANCELLED, NoDeployableRepo } from "../core/types";
import { ProfileSelection } from "../core/profileTypes";
import { discoverProfiles } from "../core/profileDiscovery";
import { classify, RepoBranchSets } from "../core/branchClassification";
import { buildEntries } from "../core/repoPickerEntries";
import { GitService } from "./gitService";

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

export class RepoResolver {
  constructor(private readonly git?: GitService) {}

  discoverRepos(): RepoCandidate[] {
    const roots = candidateRoots();
    return roots.map((rootPath) => ({
      name: path.basename(rootPath),
      rootPath,
      hasDeployWorkflow: hasDeployWorkflow(rootPath),
    }));
  }

  async resolve(activeFilePath?: string): Promise<RepoPickerResult> {
    const all = this.discoverRepos();
    const deployable = all.filter((c) => c.hasDeployWorkflow);
    if (deployable.length === 0) {
      return { kind: "no-deployable-repo" };
    }

    // Gather branch data (best-effort) so profiles can be detected.
    const repoBranches: Record<string, string[]> = {};
    const branchSets: RepoBranchSets[] = [];
    if (this.git) {
      for (const repo of deployable) {
        try {
          const b = await this.git.listBranches(repo.name, repo.rootPath);
          const union = [...new Set([...b.local, ...b.remote])];
          repoBranches[repo.name] = union;
          branchSets.push({
            name: repo.name,
            rootPath: repo.rootPath,
            local: new Set(b.local),
            remote: new Set(b.remote),
          });
        } catch {
          repoBranches[repo.name] = [];
        }
      }
    }

    const profiles = discoverProfiles(repoBranches);
    const entries = buildEntries(deployable, profiles);

    // Preselect the active file's repo among individual entries.
    const preselectName = activeFilePath
      ? deployable.find((c) => activeFilePath.replace(/\\/g, "/").toLowerCase().startsWith(c.rootPath.replace(/\\/g, "/").toLowerCase() + "/"))?.name
      : undefined;

    const items = entries.map((e) => ({
      label: e.kind === "profile" ? `$(git-branch) ${e.label}` : e.label,
      description:
        e.kind === "profile"
          ? e.repos.join(", ")
          : e.candidate.name === preselectName
          ? "(active)"
          : e.candidate.rootPath,
      entry: e,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: "Select a repository or profile to deploy",
      placeHolder: "Repository or profile",
    });
    if (!picked) {
      return CANCELLED;
    }

    if (picked.entry.kind === "repo") {
      return picked.entry.candidate;
    }

    // Profile selected: classify candidate repos for the branch.
    const branch = picked.entry.branch;
    const { candidates } = classify(branch, branchSets);
    return { kind: "profile", branch, candidates };
  }
}