import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildEntries } from "../../src/core/repoPickerEntries";
import { RepoCandidate } from "../../src/core/types";
import { Profile } from "../../src/core/profileTypes";

describe("buildEntries", () => {
  // Feature: profile-deploy, Property 6: Repo picker entries always include every repo and one entry per profile
  it("Property 6: one individual entry per repo + one profile entry per profile; labels correct", () => {
    const repoArb: fc.Arbitrary<RepoCandidate> = fc.record({
      name: fc.stringMatching(/^r[0-9]{1,2}$/),
      rootPath: fc.constant("C:/x"),
      hasDeployWorkflow: fc.constant(true),
    });
    const profArb: fc.Arbitrary<Profile> = fc
      .record({ name: fc.stringMatching(/^b[0-9]{1,2}$/), count: fc.integer({ min: 2, max: 5 }) })
      .map(({ name, count }) => ({
        name,
        kind: "auto" as const,
        targets: Array.from({ length: count }, (_, i) => ({ repo: `r${i}`, branch: name })),
      }));

    fc.assert(
      fc.property(
        fc.uniqueArray(repoArb, { maxLength: 6, selector: (r) => r.name }),
        fc.uniqueArray(profArb, { maxLength: 4, selector: (p) => p.name }),
        (repos, profiles) => {
          const entries = buildEntries(repos, profiles);
          const indiv = entries.filter((e) => e.kind === "repo");
          const prof = entries.filter((e) => e.kind === "profile");
          expect(indiv.length).toBe(repos.length);
          expect(prof.length).toBe(profiles.length);
          for (const p of prof) {
            if (p.kind === "profile") {
              expect(p.label).toBe(`Deploy profile: ${p.profile.name} (${p.count} repos)`);
            }
          }
          if (profiles.length === 0) {
            expect(entries.every((e) => e.kind === "repo")).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});