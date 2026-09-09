import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RepoCandidate, Cancelled, CANCELLED, NoDeployableRepo } from "../core/types";
import { decideRepo } from "../core/repoResolution";

// True if the folder has at least one workflow that looks like a deploy workflow.
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

// Collect candidate repo roots: each workspace folder, plus its immediate
// subdirectories (to support a parent folder that contains multiple repos).
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

export class RepoResolver {
  discoverRepos(): RepoCandidate[] {
    const roots = candidateRoots();
    const candidates = roots.map((rootPath) => ({
      name: path.basename(rootPath),
      rootPath,
      hasDeployWorkflow: hasDeployWorkflow(rootPath),
    }));
    // Only keep deployable ones as real candidates; keep at least the raw list
    // so decideRepo can report "no-deployable-repo" when appropriate.
    return candidates;
  }

  async resolve(activeFilePath?: string): Promise<RepoCandidate | Cancelled | NoDeployableRepo> {
    const candidates = this.discoverRepos();
    const decision = decideRepo(candidates, activeFilePath);
    if (decision.kind === "no-deployable-repo") {
      return decision;
    }
    if (decision.kind === "resolved") {
      return decision.repo;
    }
    // needs-picker
    const items = decision.candidates.map((c) => ({
      label: c.name,
      description: c === decision.preselected ? "(active)" : c.rootPath,
      candidate: c,
    }));
    if (decision.preselected) {
      items.sort((a, b) =>
        a.candidate === decision.preselected ? -1 : b.candidate === decision.preselected ? 1 : 0
      );
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: "Select repository to deploy",
      placeHolder: "Repository",
    });
    if (!picked) {
      return CANCELLED;
    }
    return picked.candidate;
  }
}