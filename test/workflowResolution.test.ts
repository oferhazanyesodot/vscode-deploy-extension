import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decideWorkflow } from "../src/core/workflowResolution";
import { WorkflowSummary } from "../src/core/types";

describe("decideWorkflow", () => {
  const wfArb: fc.Arbitrary<WorkflowSummary> = fc.record({
    id: fc.hexaString({ minLength: 1, maxLength: 6 }),
    name: fc.string({ minLength: 1, maxLength: 10 }),
    path: fc.string({ minLength: 1, maxLength: 20 }),
  });

  // Feature: vscode-deploy-extension, Property 2: Workflow resolution by mapping then discovery count
  it("Property 2: uses mapping first, else resolves by discovery count", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
        fc.array(wfArb, { maxLength: 5 }),
        (repoName, mapped, discovered) => {
          const decision = decideWorkflow(repoName, mapped, discovered);
          if (mapped !== undefined && mapped !== "") {
            expect(decision.kind).toBe("mapped");
            if (decision.kind === "mapped") {
              expect(decision.workflow).toBe(mapped);
            }
          } else if (discovered.length === 0) {
            expect(decision.kind).toBe("no-workflow-found");
          } else if (discovered.length === 1) {
            expect(decision.kind).toBe("resolved");
          } else {
            expect(decision.kind).toBe("needs-picker");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
