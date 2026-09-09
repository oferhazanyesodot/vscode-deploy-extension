import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decideRepo, isAncestor } from "../src/core/repoResolution";
import { RepoCandidate } from "../src/core/types";

describe("decideRepo", () => {
  const nameArb = fc.hexaString({ minLength: 1, maxLength: 6 });

  const candidateArb = (root: string): fc.Arbitrary<RepoCandidate> =>
    fc.record({
      name: nameArb,
      rootPath: fc.constant(root),
      hasDeployWorkflow: fc.boolean(),
    });

  // Feature: vscode-deploy-extension, Property 1: Repository resolution by candidate count and active file
  it("Property 1: resolves by deployable count and preselects the active file's repo", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.hexaString({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 6 }),
        fc.boolean(),
        (segments, useActive) => {
          const candidates: RepoCandidate[] = segments.map((s, i) => ({
            name: `repo${i}`,
            rootPath: `C:/repos/${s}`,
            hasDeployWorkflow: true,
          }));
          const deployable = candidates.filter((c) => c.hasDeployWorkflow);
          const activeFilePath =
            useActive && candidates.length > 0
              ? `${candidates[0].rootPath}/src/file.ts`
              : undefined;

          const decision = decideRepo(candidates, activeFilePath);

          if (deployable.length === 0) {
            expect(decision.kind).toBe("no-deployable-repo");
          } else if (deployable.length === 1) {
            expect(decision.kind).toBe("resolved");
            if (decision.kind === "resolved") {
              expect(decision.repo).toEqual(deployable[0]);
            }
          } else {
            expect(decision.kind).toBe("needs-picker");
            if (decision.kind === "needs-picker" && activeFilePath) {
              // The preselected candidate (if any) must be an ancestor of the active file.
              if (decision.preselected) {
                expect(isAncestor(decision.preselected.rootPath, activeFilePath)).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 1 (unique roots): with >1 deployable, active file under a root preselects it", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.hexaString({ minLength: 2, maxLength: 8 }), { minLength: 2, maxLength: 6 }),
        fc.nat(),
        (segments, pick) => {
          const candidates: RepoCandidate[] = segments.map((s, i) => ({
            name: `repo${i}`,
            rootPath: `C:/repos/${s}`,
            hasDeployWorkflow: true,
          }));
          const idx = pick % candidates.length;
          const activeFilePath = `${candidates[idx].rootPath}/src/a.ts`;
          const decision = decideRepo(candidates, activeFilePath);
          expect(decision.kind).toBe("needs-picker");
          if (decision.kind === "needs-picker") {
            expect(decision.preselected?.rootPath).toBe(candidates[idx].rootPath);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
