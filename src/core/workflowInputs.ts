import { WorkflowInputDef, WorkflowInputType } from "./types";

const VALID_TYPES: WorkflowInputType[] = [
  "string",
  "boolean",
  "choice",
  "number",
  "environment",
];

function stripQuotes(v: string): string {
  const t = v.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") {
    n++;
  }
  return n;
}

// Parse the workflow_dispatch.inputs block out of a workflow YAML document.
// This is a focused parser for the GitHub Actions inputs structure; it is not a
// general YAML parser. It tolerates the "on:" mapping and quoted keys ("on").
export function parseInputs(workflowYaml: string): WorkflowInputDef[] {
  const lines = workflowYaml.split(/\r?\n/);

  // Locate the `inputs:` key nested under workflow_dispatch.
  let inInputs = false;
  let inputsIndent = -1;
  let dispatchSeen = false;

  const defs: WorkflowInputDef[] = [];
  let current: WorkflowInputDef | undefined;
  let currentIndent = -1;
  let inOptions = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const indent = indentOf(line);

    if (!dispatchSeen) {
      if (/^workflow_dispatch\s*:/.test(trimmed)) {
        dispatchSeen = true;
      }
      continue;
    }

    if (!inInputs) {
      if (/^inputs\s*:/.test(trimmed)) {
        inInputs = true;
        inputsIndent = indent;
      } else if (indent <= 0 && /^[A-Za-z_"'].*:/.test(trimmed) && !/^workflow_dispatch/.test(trimmed)) {
        // Left the workflow_dispatch section entirely.
        dispatchSeen = false;
      }
      continue;
    }

    // We are inside the inputs block.
    if (indent <= inputsIndent && current === undefined) {
      // inputs block ended.
      break;
    }

    // A new input name: one level deeper than `inputs:`.
    const isInputName = indent === inputsIndent + 2 && /:\s*$/.test(trimmed);
    if (isInputName) {
      if (current) {
        defs.push(current);
      }
      const name = stripQuotes(trimmed.replace(/:\s*$/, ""));
      current = { name, type: "string", required: false };
      currentIndent = indent;
      inOptions = false;
      continue;
    }

    if (current === undefined) {
      continue;
    }

    // Attribute lines of the current input (deeper than the input name).
    if (indent <= currentIndent) {
      // Dedent back to input-name level or shallower without a new name => end.
      defs.push(current);
      current = undefined;
      inOptions = false;
      // If this line itself is at inputs level or shallower, stop.
      if (indent <= inputsIndent) {
        break;
      }
      continue;
    }

    if (inOptions) {
      const m = trimmed.match(/^-\s*(.*)$/);
      if (m) {
        current.options = current.options ?? [];
        current.options.push(stripQuotes(m[1]));
        continue;
      }
      inOptions = false;
    }

    const kv = trimmed.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2];
      if (key === "type") {
        const t = stripQuotes(val) as WorkflowInputType;
        current.type = VALID_TYPES.includes(t) ? t : "string";
      } else if (key === "required") {
        current.required = stripQuotes(val) === "true";
      } else if (key === "default") {
        const raw = stripQuotes(val);
        if (raw === "true" || raw === "false") {
          current.default = raw === "true";
        } else {
          current.default = raw;
        }
      } else if (key === "description") {
        current.description = stripQuotes(val);
      } else if (key === "options") {
        inOptions = true;
        current.options = current.options ?? [];
      }
    }
  }

  if (current) {
    defs.push(current);
  }

  // Coerce boolean defaults for boolean types, string otherwise, for consistency.
  for (const d of defs) {
    if (d.type === "boolean" && typeof d.default === "string") {
      d.default = d.default === "true";
    }
  }

  return defs;
}

// The inputs to prompt for = declared inputs minus deployment-environment.
export function additionalInputs(defs: WorkflowInputDef[]): WorkflowInputDef[] {
  return defs.filter((d) => d.name !== "deployment-environment");
}
