import * as vscode from "vscode";
import { WorkflowInputDef, Cancelled, CANCELLED } from "../core/types";
import { additionalInputs } from "../core/workflowInputs";
import { buildPromptSpec } from "../core/promptSpec";

export class InputCollector {
  async collect(defs: WorkflowInputDef[]): Promise<Record<string, string> | Cancelled> {
    const values: Record<string, string> = {};
    for (const def of additionalInputs(defs)) {
      const spec = buildPromptSpec(def);
      if (spec.kind === "quickpick") {
        const items = spec.items.map((i) => ({
          label: i,
          description: i === spec.preselected ? "(default)" : undefined,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          title: `Input: ${spec.name}`,
          placeHolder: spec.description ?? spec.name,
        });
        if (!picked) {
          return CANCELLED;
        }
        values[spec.name] = picked.label;
      } else {
        const entered = await vscode.window.showInputBox({
          title: `Input: ${spec.name}`,
          prompt: spec.description ?? spec.name,
          value: spec.value,
        });
        if (entered === undefined) {
          return CANCELLED;
        }
        values[spec.name] = entered;
      }
    }
    return values;
  }
}