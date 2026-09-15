import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeConfig } from "../../src/core/config";

describe("normalizeConfig hidden/manual profiles", () => {
  // Feature: profile-deploy, Property 18: Configuration normalization is total for hidden and manual profiles
  it("Property 18: hiddenProfiles -> string[]; manualProfiles -> Record<string,Record<string,string>>", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.array(fc.oneof(fc.string(), fc.integer())), fc.string(), fc.constant(undefined)),
        fc.oneof(
          fc.dictionary(fc.string(), fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer()))),
          fc.array(fc.string()),
          fc.string(),
          fc.constant(undefined)
        ),
        (hidden, manual) => {
          const cfg = normalizeConfig({ hiddenProfiles: hidden, manualProfiles: manual });
          expect(Array.isArray(cfg.hiddenProfiles)).toBe(true);
          expect(cfg.hiddenProfiles.every((x) => typeof x === "string")).toBe(true);
          if (Array.isArray(hidden)) {
            expect(cfg.hiddenProfiles).toEqual(hidden.filter((x) => typeof x === "string"));
          } else {
            expect(cfg.hiddenProfiles).toEqual([]);
          }
          expect(typeof cfg.manualProfiles).toBe("object");
          expect(Array.isArray(cfg.manualProfiles)).toBe(false);
          for (const [, mapping] of Object.entries(cfg.manualProfiles)) {
            expect(typeof mapping).toBe("object");
            for (const [, branch] of Object.entries(mapping)) {
              expect(typeof branch).toBe("string");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});