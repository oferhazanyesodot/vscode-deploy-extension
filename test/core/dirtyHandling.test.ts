import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decideAction } from "../../src/core/dirtyHandling";
import { DirtyHandlingDefault } from "../../src/core/profileTypes";

describe("decideAction", () => {
  // Feature: profile-deploy, Property 3: Dirty-handling decision maps default and dirtiness to an action or prompt
  it("Property 3: clean -> proceed; dirty -> prompt iff default is prompt else configured action", () => {
    const defArb = fc.constantFrom<DirtyHandlingDefault>("stash", "skip", "abort", "prompt");
    fc.assert(
      fc.property(defArb, fc.boolean(), (def, isDirty) => {
        const decision = decideAction(def, isDirty);
        if (!isDirty) {
          expect(decision).toBe("proceed");
        } else {
          expect(decision).toBe(def);
        }
      }),
      { numRuns: 100 }
    );
  });
});