import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { orderRepos } from "../../src/core/deployOrder";

describe("orderRepos", () => {
  // Feature: profile-deploy, Property 7: Deploy order lists configured repositories first, then discovery order
  it("Property 7: configured names first (in order), unknown ignored, rest in discovery order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^r[0-9]{1,2}$/), { maxLength: 8 }),
        fc.array(fc.stringMatching(/^r[0-9]{1,2}$/), { maxLength: 6 }),
        (names, order) => {
          const candidates = names.map((name) => ({ name }));
          const out = orderRepos(candidates, order);
          // permutation
          expect(out.map((c) => c.name).sort()).toEqual(names.slice().sort());
          if (order.length === 0) {
            expect(out.map((c) => c.name)).toEqual(names);
          }
          // configured names present among candidates appear first, in order
          const known = order.filter((n, i) => names.includes(n) && order.indexOf(n) === i);
          const frontExpected = known;
          expect(out.slice(0, frontExpected.length).map((c) => c.name)).toEqual(frontExpected);
          // remainder in discovery order
          const rest = names.filter((n) => !known.includes(n));
          expect(out.slice(frontExpected.length).map((c) => c.name)).toEqual(rest);
        }
      ),
      { numRuns: 100 }
    );
  });
});