import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  addExclusion,
  removeExclusion,
  isEffectivelyExcluded,
  stillExcludedByGlob,
} from "../../src/core/exclusionToggle";

const repoArb = fc.stringMatching(/^[a-z0-9-]{1,20}$/);
const patternsArb = fc.array(fc.stringMatching(/^[a-z0-9*-]{1,20}$/), { maxLength: 10 });

describe("exclusionToggle", () => {
  it("Feature: profile-deploy, Property 28: addExclusion makes the repo excluded and is idempotent", () => {
    fc.assert(
      fc.property(patternsArb, repoArb, (patterns, repo) => {
        const once = addExclusion(patterns, repo);
        expect(isEffectivelyExcluded(once, repo)).toBe(true);
        const twice = addExclusion(once, repo);
        expect(twice).toEqual(once); // no duplicate entry
      }),
      { numRuns: 300 }
    );
  });

  it("Feature: profile-deploy, Property 29: removeExclusion drops the exact-name entry", () => {
    fc.assert(
      fc.property(patternsArb, repoArb, (patterns, repo) => {
        const added = addExclusion(patterns, repo);
        const removed = removeExclusion(added, repo);
        expect(removed).not.toContain(repo);
      }),
      { numRuns: 300 }
    );
  });

  it("Feature: profile-deploy, Property 30: after removing the exact name, exclusion only persists via a surviving glob", () => {
    fc.assert(
      fc.property(patternsArb, repoArb, (patterns, repo) => {
        const added = addExclusion(patterns, repo);
        const removed = removeExclusion(added, repo);
        // If still excluded, stillExcludedByGlob must agree, and it must be due
        // to a pattern that is not the exact repo name.
        const still = isEffectivelyExcluded(removed, repo);
        expect(stillExcludedByGlob(added, repo)).toBe(still);
      }),
      { numRuns: 300 }
    );
  });
});
