import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyProfile, RepoBranchInfo } from "../../src/core/branchClassification";
import { Profile } from "../../src/core/profileTypes";

describe("classifyProfile", () => {
  // Feature: profile-deploy, Property 19: Per-target classification uses each target's own branch
  it("Property 19: each candidate carries its target branch; location from that branch; auto drops not-found", () => {
    const targetArb = fc.record({
      repo: fc.stringMatching(/^r[0-9]{1,2}$/),
      branch: fc.stringMatching(/^[a-z0-9/-]{1,10}$/),
      inLocal: fc.boolean(),
      inRemote: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.constantFrom<"auto" | "manual">("auto", "manual"),
        fc.uniqueArray(targetArb, { minLength: 1, maxLength: 6, selector: (t) => t.repo }),
        (kind, targets) => {
          // For auto, all target branches must equal the profile name; simulate that by
          // using a single shared branch for auto.
          const sharedBranch = "shared-x";
          const effectiveTargets = kind === "auto"
            ? targets.map((t) => ({ ...t, branch: sharedBranch }))
            : targets;
          const profile: Profile = {
            name: kind === "auto" ? sharedBranch : "manual-p",
            kind,
            targets: effectiveTargets.map((t) => ({ repo: t.repo, branch: t.branch })),
          };
          const repoBranches = new Map<string, RepoBranchInfo>();
          for (const t of effectiveTargets) {
            repoBranches.set(t.repo, {
              rootPath: `C:/r/${t.repo}`,
              local: new Set(t.inLocal ? [t.branch] : []),
              remote: new Set(t.inRemote ? [t.branch] : []),
            });
          }
          const candidates = classifyProfile(profile, repoBranches);
          for (const c of candidates) {
            const src = effectiveTargets.find((t) => t.repo === c.name)!;
            expect(c.branch).toBe(src.branch);
            const expected = src.inLocal && src.inRemote ? "both" : src.inLocal ? "local" : src.inRemote ? "remote" : "not-found";
            expect(c.location).toBe(expected);
          }
          if (kind === "auto") {
            // auto drops not-found targets
            for (const c of candidates) expect(c.location).not.toBe("not-found");
            const expectedCount = effectiveTargets.filter((t) => t.inLocal || t.inRemote).length;
            expect(candidates.length).toBe(expectedCount);
          } else {
            // manual retains all listed repos
            expect(candidates.length).toBe(effectiveTargets.length);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});