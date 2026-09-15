import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeConfig } from "../../src/core/config";

describe("normalizeConfig globalExclusions", () => {
  // Feature: profile-deploy, Property 22: Configuration normalization is total for global exclusions
  it("Property 22: globalExclusions -> string[] retaining string members in order", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.array(fc.oneof(fc.string(), fc.integer())), fc.string(), fc.constant(undefined)),
        (raw) => {
          const cfg = normalizeConfig({ globalExclusions: raw });
          expect(Array.isArray(cfg.globalExclusions)).toBe(true);
          expect(cfg.globalExclusions.every((x) => typeof x === "string")).toBe(true);
          if (Array.isArray(raw)) {
            expect(cfg.globalExclusions).toEqual(raw.filter((x) => typeof x === "string"));
          } else {
            expect(cfg.globalExclusions).toEqual([]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});