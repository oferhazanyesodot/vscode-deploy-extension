import * as vscode from "vscode";
import { RepoCandidate, Cancelled, CANCELLED, isCancelled } from "../core/types";
import { Profile, ProfileTarget } from "../core/profileTypes";
import { manualProfileToTargets } from "../core/manualProfiles";
import { GitService } from "./gitService";
import { ConfigService } from "./configService";

export class ManualProfileBuilder {
  constructor(
    private readonly git: GitService,
    private readonly config: ConfigService
  ) {}

  async run(deployableRepos: RepoCandidate[]): Promise<Profile | Cancelled> {
    // 1. Name.
    const name = await vscode.window.showInputBox({
      title: "New manual profile",
      prompt: "Profile name",
      validateInput: (v) => (v.trim() === "" ? "Name is required" : undefined),
    });
    if (name === undefined || name.trim() === "") {
      return CANCELLED;
    }
    const profileName = name.trim();

    // 2. Collect targets.
    const mapping: Record<string, string> = {};
    for (;;) {
      const repoPick = await vscode.window.showQuickPick(
        deployableRepos.map((r) => ({ label: r.name, description: r.rootPath, repo: r })),
        { title: `Manual profile "${profileName}": add a repository`, placeHolder: "Repository" }
      );
      if (!repoPick) {
        // Cancelling the repo pick: if we already have targets, treat as finish attempt;
        // otherwise abort.
        if (Object.keys(mapping).length === 0) {
          return CANCELLED;
        }
        break;
      }
      const repoRoot = repoPick.repo.rootPath;
      const branches = await this.git.listBranches(repoPick.repo.name, repoRoot);
      const branchNames = [...new Set([...branches.local, ...branches.remote])];
      const branchPick = await vscode.window.showQuickPick(
        branchNames.length > 0 ? branchNames : [],
        { title: `Branch for ${repoPick.repo.name}`, placeHolder: "Branch (or Esc to cancel)" }
      );
      if (branchPick === undefined) {
        return CANCELLED;
      }
      mapping[repoPick.repo.name] = branchPick;

      const more = await vscode.window.showQuickPick(
        [
          { label: "Add another repository", value: "add" },
          { label: "Finish", value: "finish" },
        ],
        { title: `Manual profile "${profileName}"`, placeHolder: `${Object.keys(mapping).length} target(s) so far` }
      );
      if (!more) {
        return CANCELLED;
      }
      if (more.value === "finish") {
        break;
      }
    }

    if (Object.keys(mapping).length === 0) {
      return CANCELLED;
    }

    // 3. Overwrite prompt on collision.
    const existing = this.config.manualProfiles();
    if (Object.prototype.hasOwnProperty.call(existing, profileName)) {
      const choice = await vscode.window.showWarningMessage(
        `A manual profile named "${profileName}" already exists. Overwrite it?`,
        { modal: true },
        "Overwrite"
      );
      if (choice !== "Overwrite") {
        return CANCELLED;
      }
    }

    // 4. Persist.
    await this.config.setManualProfile(profileName, mapping);
    return manualProfileToTargets(profileName, mapping);
  }
}