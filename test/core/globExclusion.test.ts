import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { matchesGlob, isGloballyExcluded } from "../../src/core/globExclusion";

describe("matchesGlob / isGloballyExcluded", () => {
  it("literal, star, and metacharacter behavior", () => {
    expect(matchesGlob("intelligate-manifests", "*-manifests")).toBe(true);
    expect(matchesGlob("intelligate-backend", "*-manifests")).toBe(false);
    expect(matchesGlob("anything", "*")).toBe(true);
    expect(matchesGlob("a.b", "a.b")).toBe(true);
    expect(matchesGlob("axb", "a.b")).toBe(false); // '.' is literal, not wildcard
    expect(matchesGlob("foo", "foo")).toBe(true);
    expect(isGloballyExcluded("x-manifests", [])).toBe(false);
  });

  // Feature: profile-deploy, Property 20: Global exclusion matches a repository iff some glob pattern matches its name
  it("Property 20: isGloballyExcluded equals OR of matchesGlob over the list", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9-]{1,15}$/),
        fc.array(fc.oneof(fc.constant("*"), fc.stringMatching(/^[a-z0-9*-]{1,10}$/)), { maxLength: 5 }),
        (name, patterns) => {
          const expected = patterns.some((p) => matchesGlob(name, p));
          expect(isGloballyExcluded(name, patterns)).toBe(expected);
          if (patterns.includes("*")) {
            expect(isGloballyExcluded(name, patterns)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});