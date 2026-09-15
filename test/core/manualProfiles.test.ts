import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { manualProfileToTargets, assembleProfiles } from "../../src/core/manualProfiles";
import { Profile } from "../../src/core/profileTypes";

describe("manualProfileToTargets", () => {
  // Feature: profile-deploy, Property 17: Manual profile mapping produces one target per repository-branch pair
  it("Property 17: one target per repo->branch pair, kind manual", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9-]{1,12}$/),
        fc.dictionary(fc.stringMatching(/^r[0-9]{1,2}$/), fc.stringMatching(/^[a-z0-9/-]{1,12}$/), { maxKeys: 6 }),
        (name, mapping) => {
          const p = manualProfileToTargets(name, mapping);
          expect(p.name).toBe(name);
          expect(p.kind).toBe("manual");
          expect(p.targets.length).toBe(Object.keys(mapping).length);
          for (const t of p.targets) {
            expect(mapping[t.repo]).toBe(t.branch);
          }
          const repos = new Set(p.targets.map((t) => t.repo));
          expect(repos.size).toBe(Object.keys(mapping).length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("assembleProfiles", () => {
  const autoArb: fc.Arbitrary<Profile> = fc.stringMatching(/^[a-z0-9-]{1,10}$/).map((name) => ({
    name, kind: "auto" as const, targets: [{ repo: "r1", branch: name }, { repo: "r2", branch: name }],
  }));
  const manualArb: fc.Arbitrary<Profile> = fc.stringMatching(/^[a-z0-9-]{1,10}$/).map((name) => ({
    name, kind: "manual" as const, targets: [{ repo: "r1", branch: "x" }],
  }));

  // Feature: profile-deploy, Property 13: Profile assembly unions auto and manual profiles as distinct entries
  it("Property 13: union length = sum; auto+manual same name stay distinct", () => {
    fc.assert(
      fc.property(fc.array(autoArb, { maxLength: 5 }), fc.array(manualArb, { maxLength: 5 }), (autos, manuals) => {
        const out = assembleProfiles(autos, manuals);
        expect(out.length).toBe(autos.length + manuals.length);
        const autoCount = out.filter((p) => p.kind === "auto").length;
        const manualCount = out.filter((p) => p.kind === "manual").length;
        expect(autoCount).toBe(autos.length);
        expect(manualCount).toBe(manuals.length);
      }),
      { numRuns: 100 }
    );
  });
});