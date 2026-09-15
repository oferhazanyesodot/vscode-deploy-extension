import * as vscode from "vscode";
import { DeployConfig } from "../core/types";
import { normalizeConfig } from "../core/config";

export class ConfigService {
  get(): DeployConfig {
    const cfg = vscode.workspace.getConfiguration("deploy");
    return normalizeConfig({
      workflowMapping: cfg.get("workflowMapping"),
      pollIntervalSeconds: cfg.get("pollIntervalSeconds"),
      pinnedWorkflows: cfg.get("pinnedWorkflows"),
      dirtyHandlingDefault: cfg.get("dirtyHandlingDefault"),
      deployOrder: cfg.get("deployOrder"),
      hiddenProfiles: cfg.get("hiddenProfiles"),
      manualProfiles: cfg.get("manualProfiles"),
      globalExclusions: cfg.get("globalExclusions"),
      profileAliases: cfg.get("profileAliases"),
      starredProfiles: cfg.get("starredProfiles"),
    });
  }

  mappedWorkflow(repoName: string): string | undefined {
    const v = this.get().workflowMapping[repoName];
    return v && v !== "" ? v : undefined;
  }

  pinnedWorkflows(repoName: string): string[] {
    return this.get().pinnedWorkflows[repoName] ?? [];
  }

  dirtyHandlingDefault(): DeployConfig["dirtyHandlingDefault"] {
    return this.get().dirtyHandlingDefault;
  }

  deployOrder(): string[] {
    return this.get().deployOrder;
  }

  hiddenProfiles(): string[] {
    return this.get().hiddenProfiles;
  }

  manualProfiles(): Record<string, Record<string, string>> {
    return this.get().manualProfiles;
  }

  globalExclusions(): string[] {
    return this.get().globalExclusions;
  }

  profileAliases(): Record<string, string> {
    return this.get().profileAliases;
  }

  starredProfiles(): string[] {
    return this.get().starredProfiles;
  }

  private target(): vscode.ConfigurationTarget {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  }

  async setHiddenProfiles(list: string[]): Promise<void> {
    await vscode.workspace.getConfiguration("deploy").update("hiddenProfiles", list, this.target());
  }

  async setStarredProfiles(list: string[]): Promise<void> {
    await vscode.workspace.getConfiguration("deploy").update("starredProfiles", list, this.target());
  }

  async setManualProfile(name: string, mapping: Record<string, string>): Promise<void> {
    const current = this.manualProfiles();
    const next = { ...current, [name]: mapping };
    await vscode.workspace.getConfiguration("deploy").update("manualProfiles", next, this.target());
  }

  async setGlobalExclusions(list: string[]): Promise<void> {
    // globalExclusions is machine-scoped, so it must be written to the Global target.
    await vscode.workspace
      .getConfiguration("deploy")
      .update("globalExclusions", list, vscode.ConfigurationTarget.Global);
  }

  // Set (or clear, when alias is undefined/empty) the visual alias for a profile.
  async setProfileAlias(name: string, alias: string | undefined): Promise<void> {
    const current = { ...this.profileAliases() };
    if (!alias || alias.trim() === "") {
      delete current[name];
    } else {
      current[name] = alias.trim();
    }
    await vscode.workspace.getConfiguration("deploy").update("profileAliases", current, this.target());
  }

  // Remove a manual profile definition entirely.
  async removeManualProfile(name: string): Promise<void> {
    const current = { ...this.manualProfiles() };
    if (!(name in current)) {
      return;
    }
    delete current[name];
    await vscode.workspace.getConfiguration("deploy").update("manualProfiles", current, this.target());
  }
}