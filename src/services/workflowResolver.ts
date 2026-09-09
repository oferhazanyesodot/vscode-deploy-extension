import * as vscode from "vscode";
import { RepoCandidate, WorkflowSummary, Cancelled, CANCELLED, NoWorkflowFound } from "../core/types";
import { decideWorkflow } from "../core/workflowResolution";
import { orderByPinned, isPinned } from "../core/pinnedOrdering";
import { GhCliService } from "./ghCliService";
import { ConfigService } from "./configService";

export class WorkflowResolver {
  constructor(private readonly gh: GhCliService, private readonly config: ConfigService) {}

  async resolve(repo: RepoCandidate): Promise<WorkflowSummary | string | Cancelled | NoWorkflowFound> {
    const mapped = this.config.mappedWorkflow(repo.name);
    const discovered = mapped ? [] : await this.gh.listWorkflows(repo.rootPath);
    const decision = decideWorkflow(repo.name, mapped, discovered);

    if (decision.kind === "mapped") {
      return decision.workflow;
    }
    if (decision.kind === "no-workflow-found") {
      return decision;
    }
    if (decision.kind === "resolved") {
      return decision.workflow;
    }

    // needs-picker: order pinned workflows first (Req 3.6, 3.7)
    const pinned = this.config.pinnedWorkflows(repo.name);
    const ordered = orderByPinned(decision.workflows, pinned);

    type Item = vscode.QuickPickItem & { workflow?: WorkflowSummary };
    const items: Item[] = [];
    let separatorAdded = false;
    for (const w of ordered) {
      const pinnedItem = isPinned(w, pinned);
      if (!pinnedItem && !separatorAdded && pinned.length > 0 && items.length > 0) {
        items.push({ label: "Other workflows", kind: vscode.QuickPickItemKind.Separator });
        separatorAdded = true;
      }
      items.push({
        label: pinnedItem ? `$(pin) ${w.name}` : w.name,
        description: w.path,
        workflow: w,
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: "Select deploy workflow",
      placeHolder: "Workflow",
    });
    if (!picked || !picked.workflow) {
      return CANCELLED;
    }
    return picked.workflow;
  }
}