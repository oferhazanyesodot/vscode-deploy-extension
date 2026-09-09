import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { orderByPinned } from "../src/core/pinnedOrdering";
import { WorkflowSummary } from "../src/core/types";

function wf(id: string, file: string): WorkflowSummary {
  return { id, name: file, path: `.github/workflows/${file}` };
}

describe("orderByPinned", () => {
  it("orders pinned first (example): backend then permissions, rest after", () => {
    const list = [
      wf("1", "linter.yml"),
      wf("2", "deploy-backend.yaml"),
      wf("3", "deploy-permissions.yaml"),
      wf("4", "test-e2e.yaml"),
    ];
    const out = orderByPinned(list, ["deploy-backend.yaml", "deploy-permissions.yaml"]);
    expect(out.map((w) => w.path.split("/").pop())).toEqual([
      "deploy-backend.yaml",
      "deploy-permissions.yaml",
      "linter.yml",
      "test-e2e.yaml",
    ]);
  });

  it("matches by id as well as file name", () => {
    const list = [wf("99", "a.yml"), wf("100", "b.yml")];
    const out = orderByPinned(list, ["100"]);
    expect(out[0].id).toBe("100");
  });

  // Feature: vscode-deploy-extension, Property 12: Pinned ordering is a stable permutation with pinned entries first
  it("Property 12: stable permutation with pinned entries first", () => {
    const fileArb = fc.stringMatching(/^[a-z0-9]{1,6}\.ya?ml$/);
    const wfArb = fc
      .record({ id: fc.hexaString({ minLength: 1, maxLength: 5 }), file: fileArb })
      .map(({ id, file }) => wf(id, file));

    fc.assert(
      fc.property(
        fc.uniqueArray(wfArb, { maxLength: 8, selector: (w) => w.path }),
        fc.array(fc.oneof(fileArb, fc.hexaString({ minLength: 1, maxLength: 5 })), { maxLength: 6 }),
        (workflows, pinned) => {
          const out = orderByPinned(workflows, pinned);

          // 1. Permutation: same multiset of paths.
          const sortPaths = (xs: WorkflowSummary[]) => xs.map((w) => w.path).sort();
          expect(sortPaths(out)).toEqual(sortPaths(workflows));

          // 2. All pinned-matching workflows precede all non-matching ones.
          const fileName = (w: WorkflowSummary) => w.path.split("/").pop()!;
          const isMatch = (w: WorkflowSummary) =>
            pinned.some((p) => p === w.id || p === fileName(w) || p === w.path);
          let seenUnpinned = false;
          for (const w of out) {
            if (isMatch(w)) {
              expect(seenUnpinned).toBe(false);
            } else {
              seenUnpinned = true;
            }
          }

          // 3. Unpinned retain original relative order.
          const origUnpinned = workflows.filter((w) => !isMatch(w)).map((w) => w.path);
          const outUnpinned = out.filter((w) => !isMatch(w)).map((w) => w.path);
          expect(outUnpinned).toEqual(origUnpinned);
        }
      ),
      { numRuns: 100 }
    );
  });
});