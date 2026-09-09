import { WorkflowInputDef } from "./types";

export interface QuickPickPromptSpec {
  kind: "quickpick";
  name: string;
  items: string[];
  preselected?: string;
  description?: string;
}

export interface InputBoxPromptSpec {
  kind: "inputbox";
  name: string;
  value?: string;
  description?: string;
}

export type PromptSpec = QuickPickPromptSpec | InputBoxPromptSpec;

function defaultToString(d: string | boolean | undefined): string | undefined {
  if (d === undefined) {
    return undefined;
  }
  return typeof d === "boolean" ? (d ? "true" : "false") : d;
}

// Build a prompt specification for a single workflow input.
// boolean -> quickpick [true,false] with default preselected
// choice  -> quickpick options with default preselected
// string/number/environment -> input box prefilled with default
export function buildPromptSpec(def: WorkflowInputDef): PromptSpec {
  const def0 = defaultToString(def.default);
  if (def.type === "boolean") {
    return {
      kind: "quickpick",
      name: def.name,
      items: ["true", "false"],
      preselected: def0 ?? undefined,
      description: def.description,
    };
  }
  if (def.type === "choice") {
    return {
      kind: "quickpick",
      name: def.name,
      items: def.options ?? [],
      preselected: def0 ?? undefined,
      description: def.description,
    };
  }
  return {
    kind: "inputbox",
    name: def.name,
    value: def0 ?? undefined,
    description: def.description,
  };
}
