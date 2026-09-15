import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { discoverProfiles } from "../../src/core/profileDiscovery";

describe("discoverProfiles", () => {
  // Feature: profile-deploy, Property 1: Profile discovery selects branches shared by two or more repositories
  it("Property 1: returns branches present in >=2 repos with exact repo list and count", () => {
    const branchArb = fc.constantFrom("dev", "preprod", "main", "fix/a", "fix/b", "feature/x", "feature/y");
    const repoBranchesArb = fc.dictionary(
      fc.stringMatching(/^repo[0-9]{1,2}$/),
      fc.uniqueArray(branchArb, { maxLength: 5 }),
      { maxKeys: 6 }
    );
    fc.assert(
      fc.property(repoBranchesArb, (repoBranches) => {
        const profiles = discoverProfiles(repoBranches);
        // Build expected: branch -> repos
        const expected = new Map<string, string[]>();
        for (const [repo, branches] of Object.entries(repoBranches)) {
          for (const b of new Set(branches)) {
            const l = expected.get(b) ?? [];
            l.push(repo);
            expected.set(b, l);
          }
        }
        const expectedProfiles = [...expected.entries()].filter(([, repos]) => repos.length >= 2);
        expect(profiles.length).toBe(expectedProfiles.length);
        for (const p of profiles) {
          expect(p.count).toBeGreaterThanOrEqual(2);
          expect(p.count).toBe(p.repos.length);
          const exp = expected.get(p.branch)!;
          expect(new Set(p.repos)).toEqual(new Set(exp));
        }
      }),
      { numRuns: 100 }
    );
  });
});