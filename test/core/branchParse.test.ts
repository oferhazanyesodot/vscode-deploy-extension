import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseBranchList } from "../../src/core/branchParse";

describe("parseBranchList", () => {
  // Feature: profile-deploy, Property 5: Branch list parsing recovers branch names
  it("Property 5: local strips '* ' marker; remote strips origin/ and omits HEAD symref", () => {
    const nameArb = fc.stringMatching(/^[a-z][a-z0-9/_-]{0,12}$/);
    fc.assert(
      fc.property(fc.uniqueArray(nameArb, { maxLength: 6 }), fc.nat(), (names, currentIdx) => {
        // LOCAL
        const localLines = names.map((n, i) =>
          i === currentIdx % Math.max(names.length, 1) && names.length > 0 ? `* ${n}` : `  ${n}`
        );
        const local = parseBranchList(localLines.join("\n"), "local");
        expect(new Set(local)).toEqual(new Set(names));
        for (const b of local) {
          expect(b.startsWith("* ")).toBe(false);
          expect(b).toBe(b.trim());
        }

        // REMOTE: prefix origin/, add a HEAD symref that must be omitted.
        const remoteLines = names.map((n) => `  origin/${n}`);
        remoteLines.push("  origin/HEAD -> origin/main");
        const remote = parseBranchList(remoteLines.join("\n"), "remote");
        // "main" may or may not be in names; the symref line must NOT add "HEAD".
        expect(remote).not.toContain("HEAD");
        for (const n of names) {
          expect(remote).toContain(n);
        }
      }),
      { numRuns: 100 }
    );
  });
});