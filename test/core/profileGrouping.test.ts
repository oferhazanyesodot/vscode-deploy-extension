import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyProfileGroup, buildProfileSections, toggleHidden } from "../../src/core/profileGrouping";
import { Profile, ENVIRONMENT_PROFILE_NAMES } from "../../src/core/profileTypes";

const kindArb = fc.constantFrom<"auto" | "manual">("auto", "manual");

function profileArb(): fc.Arbitrary<Profile> {
  const nameArb = fc.oneof(
    fc.constantFrom(...ENVIRONMENT_PROFILE_NAMES),
    fc.stringMatching(/^(fix|feat)\/[a-z0-9-]{1,10}$/)
  );
  return fc.record({ name: nameArb, kind: kindArb, targets: fc.constant([{ repo: "r", branch: "b" }]) });
}

describe("classifyProfileGroup", () => {
  // Feature: profile-deploy, Property 14: Profile group classification follows environment-name membership
  it("Property 14: environment iff name in set, independent of kind", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...ENVIRONMENT_PROFILE_NAMES), fc.string()), (name) => {
        const g = classifyProfileGroup(name);
        if ((ENVIRONMENT_PROFILE_NAMES as readonly string[]).includes(name)) {
          expect(g).toBe("environment");
        } else {
          expect(g).toBe("live");
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("buildProfileSections", () => {
  // Feature: profile-deploy, Property 15: Profile sections group, cover, and order profiles correctly
  it("Property 15: disjoint, covering, ordered, hidden by name", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(profileArb(), { maxLength: 10, selector: (p) => p.name + p.kind }),
        fc.array(fc.string(), { maxLength: 5 }),
        (profiles, hidden) => {
          const hiddenSet = new Set(hidden);
          const sections = buildProfileSections(profiles, hidden);
          const all = [...sections.live, ...sections.environment, ...sections.hidden];
          // covering + disjoint (by identity)
          expect(all.length).toBe(profiles.length);
          // hidden membership
          for (const p of sections.hidden) expect(hiddenSet.has(p.name)).toBe(true);
          for (const p of sections.live) {
            expect(hiddenSet.has(p.name)).toBe(false);
            expect((ENVIRONMENT_PROFILE_NAMES as readonly string[]).includes(p.name)).toBe(false);
          }
          for (const p of sections.environment) {
            expect(hiddenSet.has(p.name)).toBe(false);
            expect((ENVIRONMENT_PROFILE_NAMES as readonly string[]).includes(p.name)).toBe(true);
          }
          // order preservation within live
          const liveFromInput = profiles.filter((p) => !hiddenSet.has(p.name) && !(ENVIRONMENT_PROFILE_NAMES as readonly string[]).includes(p.name));
          expect(sections.live).toEqual(liveFromInput);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("toggleHidden", () => {
  // Feature: profile-deploy, Property 16: Hidden toggle flips exactly the named entry
  it("Property 16: add if absent, remove if present; double-toggle stable membership", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 8 }), fc.string(), (list, name) => {
        const once = toggleHidden(list, name);
        if (list.includes(name)) {
          expect(once.includes(name)).toBe(false);
        } else {
          expect(once.includes(name)).toBe(true);
          expect(once.filter((n) => n === name).length).toBe(1);
        }
        // other names unchanged in membership
        for (const other of new Set(list)) {
          if (other !== name) expect(once.includes(other)).toBe(list.includes(other));
        }
        // double toggle restores membership of name
        const twice = toggleHidden(once, name);
        expect(twice.includes(name)).toBe(list.includes(name));
      }),
      { numRuns: 100 }
    );
  });
});