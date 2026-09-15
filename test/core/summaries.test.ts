import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildSwitchSummary, buildDeploymentSummary } from "../../src/core/summaries";
import { SwitchResult, PerRepositoryResult, BranchLocation } from "../../src/core/profileTypes";
import { DeployEnvironment } from "../../src/core/types";

describe("buildSwitchSummary", () => {
  // Feature: profile-deploy, Property 10: Switch summary counts partition the results
  it("Property 10: switched/skipped/failed counts sum to total", () => {
    const outcomeArb = fc.oneof(
      fc.constant({ kind: "switched" as const }),
      fc.constant({ kind: "skipped" as const }),
      fc.record({ kind: fc.constant("failed" as const), error: fc.string() })
    );
    const resultArb: fc.Arbitrary<SwitchResult> = fc.record({
      repoName: fc.stringMatching(/^r[0-9]{1,2}$/),
      location: fc.constantFrom<BranchLocation>("local", "remote", "both"),
      stashed: fc.boolean(),
      outcome: outcomeArb,
    });
    fc.assert(
      fc.property(fc.array(resultArb, { maxLength: 10 }), (results) => {
        const s = buildSwitchSummary("b", results);
        expect(s.switchedCount + s.skippedCount + s.failedCount).toBe(results.length);
        expect(s.switchedCount).toBe(results.filter((r) => r.outcome.kind === "switched").length);
        expect(s.skippedCount).toBe(results.filter((r) => r.outcome.kind === "skipped").length);
        expect(s.failedCount).toBe(results.filter((r) => r.outcome.kind === "failed").length);
      }),
      { numRuns: 100 }
    );
  });
});

describe("buildDeploymentSummary", () => {
  // Feature: profile-deploy, Property 11: Deployment summary counts partition the results
  it("Property 11: succeeded/failed counts sum to total; success iff dispatched and conclusion ok", () => {
    const dispatchArb = fc.oneof(
      fc.constant({ kind: "resolution-failed" as const }),
      fc.record({ kind: fc.constant("dispatch-failed" as const), error: fc.string() }),
      fc.record({ kind: fc.constant("dispatched" as const), runId: fc.option(fc.string(), { nil: undefined }) })
    );
    const resultArb: fc.Arbitrary<PerRepositoryResult> = fc.record({
      repoName: fc.stringMatching(/^r[0-9]{1,2}$/),
      environment: fc.constantFrom<DeployEnvironment>("dev", "preprod", "prod"),
      dispatch: dispatchArb,
      runConclusion: fc.option(fc.constantFrom("success", "failure", "cancelled"), { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(resultArb, { maxLength: 10 }), (results) => {
        const s = buildDeploymentSummary("b", "dev", results);
        expect(s.succeededCount + s.failedCount).toBe(results.length);
        const expectedSucc = results.filter(
          (r) => r.dispatch.kind === "dispatched" && (r.runConclusion === undefined || r.runConclusion === "success")
        ).length;
        expect(s.succeededCount).toBe(expectedSucc);
      }),
      { numRuns: 100 }
    );
  });
});