import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseStatus, isDirty } from "../src/core/gitStatus";
import { GitStatus } from "../src/core/types";

type LineSpec =
  | { kind: "untracked"; path: string }
  | { kind: "staged"; code: string; path: string }
  | { kind: "unstaged"; code: string; path: string };

describe("parseStatus", () => {
  // Feature: vscode-deploy-extension, Property 4: Git porcelain parsing reflects change categories
  it("Property 4: sets staged/unstaged/untracked from porcelain lines", () => {
    const stagedCodes = ["M", "A", "D", "R", "C"];
    const unstagedCodes = ["M", "D"];
    const lineArb: fc.Arbitrary<LineSpec> = fc.oneof(
      fc.record({
        kind: fc.constant<"untracked">("untracked"),
        path: fc.hexaString({ minLength: 1, maxLength: 5 }),
      }),
      fc.record({
        kind: fc.constant<"staged">("staged"),
        code: fc.constantFrom(...stagedCodes),
        path: fc.hexaString({ minLength: 1, maxLength: 5 }),
      }),
      fc.record({
        kind: fc.constant<"unstaged">("unstaged"),
        code: fc.constantFrom(...unstagedCodes),
        path: fc.hexaString({ minLength: 1, maxLength: 5 }),
      })
    );

    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 8 }), (specs) => {
        let expStaged = false;
        let expUnstaged = false;
        let expUntracked = false;
        const lines: string[] = [];
        for (const s of specs) {
          if (s.kind === "untracked") {
            lines.push(`?? ${s.path}`);
            expUntracked = true;
          } else if (s.kind === "staged") {
            // Index column set, worktree column space.
            lines.push(`${s.code} ${s.path}`);
            expStaged = true;
          } else {
            // Index column space, worktree column set.
            lines.push(` ${s.code} ${s.path}`);
            expUnstaged = true;
          }
        }
        const result = parseStatus(lines.join("\n"));
        expect(result.staged).toBe(expStaged);
        expect(result.unstaged).toBe(expUnstaged);
        expect(result.untracked).toBe(expUntracked);
      }),
      { numRuns: 100 }
    );
  });
});

describe("isDirty", () => {
  // Feature: vscode-deploy-extension, Property 5: Confirmation is requested exactly when the tree is dirty
  it("Property 5: dirty iff any of staged/unstaged/untracked is true", () => {
    fc.assert(
      fc.property(
        fc.record({ staged: fc.boolean(), unstaged: fc.boolean(), untracked: fc.boolean() }),
        (s: GitStatus) => {
          expect(isDirty(s)).toBe(s.staged || s.unstaged || s.untracked);
        }
      ),
      { numRuns: 100 }
    );
  });
});
