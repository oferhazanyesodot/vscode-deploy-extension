import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { eligibleTargets } from "../../src/core/eligibleTargets";
import { Profile } from "../../src/core/profileTypes";

describe("eligibleTargets", () => {
  // Feature: profile-deploy, Property 21: Tree eligibility selects checked, non-excluded targets in order
  it("Property 21: checked (default true) AND not excluded, order preserved", () => {
    const targetArb = fc.record({
      repo: fc.stringMatching(/^r[0-9]{1,2}$/),
      branch: fc.constant("b"),
      checked: fc.option(fc.boolean(), { nil: undefined }),
      excluded: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.uniqueArray(targetArb, { maxLength: 8, selector: (t) => t.repo }), (targets) => {
        const profile: Profile = {
          name: "p",
          kind: "manual",
          targets: targets.map((t) => ({ repo: t.repo, branch: t.branch })),
        };
        const excludedRepos = targets.filter((t) => t.excluded).map((t) => t.repo);
        const checkboxMap = new Map(targets.map((t) => [t.repo, t.checked]));
        const lookup = (repo: string) => checkboxMap.get(repo);
        // Use exact-name patterns for exclusions.
        const result = eligibleTargets(profile, lookup, excludedRepos);

        const expected = targets
          .filter((t) => !t.excluded && (t.checked === undefined ? true : t.checked))
          .map((t) => t.repo);
        expect(result.map((t) => t.repo)).toEqual(expected);
        // no excluded repo present
        for (const t of result) expect(excludedRepos).not.toContain(t.repo);
      }),
      { numRuns: 100 }
    );
  });
});