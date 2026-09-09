import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseInputs, additionalInputs } from "../src/core/workflowInputs";
import { buildPromptSpec } from "../src/core/promptSpec";
import { WorkflowInputDef, WorkflowInputType } from "../src/core/types";

// Arbitrary that generates a valid input definition.
const nameArb = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,10}$/)
  .filter((n) => n !== "deployment-environment");

function inputDefArb(): fc.Arbitrary<WorkflowInputDef> {
  return fc
    .constantFrom<WorkflowInputType>("string", "boolean", "choice", "number")
    .chain((type): fc.Arbitrary<WorkflowInputDef> => {
      const base = {
        name: nameArb,
        type: fc.constant(type),
        required: fc.boolean(),
        description: fc.option(fc.stringMatching(/^[A-Za-z0-9 ]{0,20}$/), { nil: undefined }),
      };
      if (type === "boolean") {
        return fc.record({
          ...base,
          default: fc.option(fc.boolean(), { nil: undefined }),
          options: fc.constant(undefined),
        });
      }
      if (type === "choice") {
        return fc
          .uniqueArray(fc.stringMatching(/^[a-z0-9]{1,6}$/), { minLength: 1, maxLength: 4 })
          .chain((options) =>
            fc.record({
              ...base,
              options: fc.constant(options),
              default: fc.option(fc.constantFrom(...options), { nil: undefined }),
            })
          );
      }
      return fc.record({
        ...base,
        default: fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/), { nil: undefined }),
        options: fc.constant(undefined),
      });
    });
}

// Render an input definition set into workflow YAML.
function renderYaml(defs: WorkflowInputDef[]): string {
  const lines: string[] = ["name: Test", "on:", "  workflow_dispatch:", "    inputs:"];
  for (const d of defs) {
    lines.push(`      ${d.name}:`);
    lines.push(`        type: ${d.type}`);
    lines.push(`        required: ${d.required}`);
    if (d.description !== undefined) {
      lines.push(`        description: '${d.description}'`);
    }
    if (d.default !== undefined) {
      const val = typeof d.default === "boolean" ? d.default : `'${d.default}'`;
      lines.push(`        default: ${val}`);
    }
    if (d.options) {
      lines.push(`        options:`);
      for (const o of d.options) {
        lines.push(`          - ${o}`);
      }
    }
  }
  lines.push("jobs:");
  lines.push("  deploy:");
  lines.push("    runs-on: ubuntu-latest");
  return lines.join("\n");
}

describe("additionalInputs", () => {
  // Feature: vscode-deploy-extension, Property 6: Prompted inputs are the declared inputs minus deployment-environment
  it("Property 6: returns declared inputs minus deployment-environment", () => {
    fc.assert(
      fc.property(
        fc.array(inputDefArb(), { maxLength: 6 }),
        fc.boolean(),
        (defs, includeEnv) => {
          const all: WorkflowInputDef[] = includeEnv
            ? [{ name: "deployment-environment", type: "choice", required: false, options: ["dev"] }, ...defs]
            : defs;
          const result = additionalInputs(all);
          expect(result.every((d) => d.name !== "deployment-environment")).toBe(true);
          const expected = all.filter((d) => d.name !== "deployment-environment");
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("parseInputs round-trip", () => {
  // Feature: vscode-deploy-extension, Property 9: Workflow input parsing round-trips declared inputs
  it("Property 9: recovers equivalent input definitions from rendered YAML", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(inputDefArb(), { minLength: 0, maxLength: 5, selector: (d) => d.name }),
        (defs) => {
          const yaml = renderYaml(defs);
          const parsed = parseInputs(yaml);
          expect(parsed.length).toBe(defs.length);
          const byName = new Map(parsed.map((p) => [p.name, p]));
          for (const d of defs) {
            const p = byName.get(d.name);
            expect(p).toBeDefined();
            if (!p) continue;
            expect(p.type).toBe(d.type);
            expect(p.required).toBe(d.required);
            expect(p.default).toEqual(d.default);
            if (d.options) {
              expect(p.options).toEqual(d.options);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("buildPromptSpec", () => {
  // Feature: vscode-deploy-extension, Property 7: Declared defaults are preselected in prompts
  it("Property 7: presents declared default as preselected/prefilled value", () => {
    fc.assert(
      fc.property(
        inputDefArb().filter((d) => d.default !== undefined),
        (def) => {
          const spec = buildPromptSpec(def);
          const expected = typeof def.default === "boolean" ? (def.default ? "true" : "false") : def.default;
          if (spec.kind === "quickpick") {
            expect(spec.preselected).toBe(expected);
          } else {
            expect(spec.value).toBe(expected);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
