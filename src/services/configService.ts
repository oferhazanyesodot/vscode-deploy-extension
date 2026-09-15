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
}