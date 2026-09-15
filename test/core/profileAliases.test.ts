import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeConfig } from "../../src/core/config";

describe("profileAliases config normalization", () => {
  it("Feature: profile-deploy, Property 31: only string, non-empty aliases survive normalization", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.stringMatching(/^[a-z0-9/-]{1,20}$/),
          fc.oneof(
            fc.stringMatching(/^[A-Za-z0-9 /-]{1,20}$/),
            fc.constant(""),
            fc.constant("   "),
            fc.integer(),
            fc.constant(null)
          )
        ),
        (raw) => {
          const cfg = normalizeConfig({ profileAliases: raw });
          for (const [name, alias] of Object.entries(cfg.profileAliases)) {
            // every surviving alias is a non-empty trimmed string
            expect(typeof alias).toBe("string");
            expect(alias.trim().length).toBeGreaterThan(0);
            // and the original raw value for that name was a non-empty string
            expect(typeof raw[name]).toBe("string");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("Feature: profile-deploy, Property 32: non-object aliases normalize to empty", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string(), fc.array(fc.string()), fc.constant(null), fc.constant(undefined)),
        (raw) => {
          const cfg = normalizeConfig({ profileAliases: raw });
          expect(cfg.profileAliases).toEqual({});
        }
      ),
      { numRuns: 100 }
    );
  });
});
