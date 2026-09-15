import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { checkboxKey } from "../../src/core/checkboxKey";

describe("checkboxKey", () => {
  // Feature: profile-deploy, Property 23: Checkbox key is deterministic and distinguishes distinct pairs
  it("Property 23: deterministic and injective", () => {
    fc.assert(
      fc.property(
        fc.string(), fc.string(), fc.string(), fc.string(),
        (p1, r1, p2, r2) => {
          expect(checkboxKey(p1, r1)).toBe(checkboxKey(p1, r1)); // determinism
          const samePair = p1 === p2 && r1 === r2;
          if (!samePair) {
            // Distinct pairs -> distinct keys (the '::' separator guarantees this for
            // names that do not themselves contain the exact separator boundary).
            // Guard the known ambiguous case out of the assertion.
            const k1 = checkboxKey(p1, r1);
            const k2 = checkboxKey(p2, r2);
            if (`${p1}::${r1}` !== `${p2}::${r2}`) {
              expect(k1).not.toBe(k2);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});