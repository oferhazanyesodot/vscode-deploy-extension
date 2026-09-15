import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classify, checkoutPlan, RepoBranchSets } from "../../src/core/branchClassification";

describe("classify", () => {
  // Feature: profile-deploy, Property 2: Branch classification partitions repositories by location
  it("Property 2: assigns local/remote/both/excluded and partitions all repos", () => {
    const repoArb = fc.record({
      name: fc.stringMatching(/^r[0-9]{1,2}$/),
      inLocal: fc.boolean(),
      inRemote: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.uniqueArray(repoArb, { maxLength: 8, selector: (r) => r.name }), (repos) => {
        const branch = "target";
        const sets: RepoBranchSets[] = repos.map((r) => ({
          name: r.name,
          rootPath: `C:/repos/${r.name}`,
          local: new Set(r.inLocal ? [branch] : []),
          remote: new Set(r.inRemote ? [branch] : []),
        }));
        const { candidates, excluded } = classify(branch, sets);
        // disjoint and cover all
        expect(candidates.length + excluded.length).toBe(repos.length);
        const candNames = new Set(candidates.map((c) => c.name));
        for (const e of excluded) {
          expect(candNames.has(e)).toBe(false);
        }
        for (const r of repos) {
          const cand = candidates.find((c) => c.name === r.name);
          if (r.inLocal && r.inRemote) {
            expect(cand?.location).toBe("both");
          } else if (r.inLocal) {
            expect(cand?.location).toBe("local");
          } else if (r.inRemote) {
            expect(cand?.location).toBe("remote");
          } else {
            expect(cand).toBeUndefined();
            expect(excluded).toContain(r.name);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("checkoutPlan", () => {
  // Feature: profile-deploy, Property 4: Checkout plan follows branch location
  it("Property 4: local/both -> local plan; remote -> fetch-track plan", () => {
    fc.assert(
      fc.property(fc.constantFrom("local", "remote", "both"), fc.string({ minLength: 1, maxLength: 8 }), (loc, branch) => {
        const plan = checkoutPlan(loc as "local" | "remote" | "both", branch);
        if (loc === "remote") {
          expect(plan.kind).toBe("fetch-track");
        } else {
          expect(plan.kind).toBe("local");
        }
        expect(plan.branch).toBe(branch);
      }),
      { numRuns: 100 }
    );
  });
});