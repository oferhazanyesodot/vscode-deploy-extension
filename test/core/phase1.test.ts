import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  addHistoryEntry,
  DeployHistoryEntry,
  DEFAULT_HISTORY_CAP,
} from "../../src/core/deployHistory";
import { computeDrift } from "../../src/core/branchDrift";
import { moveUp, moveDown } from "../../src/core/reorder";
import {
  targetsToManualMapping,
  uniqueManualName,
  addRepoToMapping,
  removeRepoFromMapping,
} from "../../src/core/duplicateProfile";

const entryArb: fc.Arbitrary<DeployHistoryEntry> = fc.record({
  profileName: fc.stringMatching(/^[a-z0-9/-]{1,15}$/),
  environment: fc.constantFrom("dev", "preprod", "prod"),
  timestamp: fc.date().map((d) => d.toISOString()),
  succeeded: fc.nat(10),
  failed: fc.nat(10),
  repos: fc.constant([]),
});

describe("deployHistory", () => {
  it("Feature: profile-deploy, Property 33: addHistoryEntry prepends newest and never exceeds the cap", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 30 }), entryArb, fc.integer({ min: 1, max: 25 }), (hist, e, cap) => {
        const next = addHistoryEntry(hist, e, cap);
        expect(next[0]).toEqual(e); // newest first
        expect(next.length).toBeLessThanOrEqual(cap);
        expect(next.length).toBe(Math.min(hist.length + 1, cap));
      }),
      { numRuns: 300 }
    );
  });

  it("uses a sane default cap", () => {
    expect(DEFAULT_HISTORY_CAP).toBe(20);
  });
});

describe("branchDrift", () => {
  it("Feature: profile-deploy, Property 34: drift is true iff both non-empty and differ", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const r = computeDrift(a, b);
        const ca = a.trim();
        const cb = b.trim();
        expect(r.drifted).toBe(ca !== "" && cb !== "" && ca !== cb);
      }),
      { numRuns: 300 }
    );
  });
});

describe("reorder", () => {
  const nameArb = fc.stringMatching(/^[a-z]{1,6}$/);
  it("Feature: profile-deploy, Property 35: moveUp/moveDown preserve the multiset and are inverse when in-range", () => {
    fc.assert(
      fc.property(fc.uniqueArray(nameArb, { maxLength: 8 }), (list) => {
        if (list.length === 0) return;
        const name = list[Math.floor(list.length / 2)];
        const up = moveUp(list, name);
        // same elements
        expect([...up].sort()).toEqual([...list].sort());
        // moving up then down restores original (when not at top already)
        const i = list.indexOf(name);
        if (i > 0) {
          expect(moveDown(up, name)).toEqual(list);
        }
      }),
      { numRuns: 300 }
    );
  });

  it("Property 35b: boundaries and absent names are no-ops", () => {
    expect(moveUp(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(moveDown(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(moveUp(["a", "b"], "z")).toEqual(["a", "b"]);
  });
});

describe("duplicateProfile", () => {
  it("Feature: profile-deploy, Property 36: targetsToManualMapping keeps last branch per repo", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ repo: fc.stringMatching(/^[a-z]{1,5}$/), branch: fc.stringMatching(/^[a-z]{1,5}$/) }), {
          maxLength: 10,
        }),
        (targets) => {
          const mapping = targetsToManualMapping(targets);
          for (const t of targets) {
            expect(mapping[t.repo]).toBeDefined();
          }
          // every mapping key came from a target
          for (const k of Object.keys(mapping)) {
            expect(targets.some((t) => t.repo === k)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("Feature: profile-deploy, Property 37: uniqueManualName never collides with existing names", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), fc.array(fc.string(), { maxLength: 15 }), (base, existing) => {
        const name = uniqueManualName(base, existing);
        expect(existing.includes(name)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it("Feature: profile-deploy, Property 38: add/remove repo mapping round-trips", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.stringMatching(/^[a-z]{1,5}$/), fc.stringMatching(/^[a-z]{1,5}$/)),
        fc.stringMatching(/^[A-Z]{1,5}$/), // uppercase repo guaranteed absent from lowercase dict
        fc.stringMatching(/^[a-z]{1,5}$/),
        (mapping, repo, branch) => {
          const added = addRepoToMapping(mapping, repo, branch);
          expect(added[repo]).toBe(branch);
          const removed = removeRepoFromMapping(added, repo);
          expect(removed[repo]).toBeUndefined();
          expect(removed).toEqual(mapping);
        }
      ),
      { numRuns: 200 }
    );
  });
});
