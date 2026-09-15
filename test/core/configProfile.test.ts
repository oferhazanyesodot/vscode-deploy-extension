import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeConfig } from "../../src/core/config";

describe("normalizeConfig new settings", () => {
  // Feature: profile-deploy, Property 12: Configuration normalization is total for the new settings
  it("Property 12: dirtyHandlingDefault normalizes to a valid value; deployOrder to string[]", () => {
    const valid = ["stash", "skip", "abort", "prompt"];
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...valid), fc.string(), fc.integer(), fc.constant(undefined), fc.constant(null)),
        fc.oneof(
          fc.array(fc.string()),
          fc.array(fc.oneof(fc.string(), fc.integer())),
          fc.string(),
          fc.constant(undefined)
        ),
        (dirty, order) => {
          const cfg = normalizeConfig({ dirtyHandlingDefault: dirty, deployOrder: order });
          expect(valid).toContain(cfg.dirtyHandlingDefault);
          if (typeof dirty === "string" && valid.includes(dirty)) {
            expect(cfg.dirtyHandlingDefault).toBe(dirty);
          } else {
            expect(cfg.dirtyHandlingDefault).toBe("prompt");
          }
          expect(Array.isArray(cfg.deployOrder)).toBe(true);
          expect(cfg.deployOrder.every((x) => typeof x === "string")).toBe(true);
          if (Array.isArray(order)) {
            expect(cfg.deployOrder).toEqual(order.filter((x) => typeof x === "string"));
          } else {
            expect(cfg.deployOrder).toEqual([]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});