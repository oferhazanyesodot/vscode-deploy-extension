import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRunArgs } from "../src/core/ghArgs";
import { classifyPhase } from "../src/core/runPhase";
import { identifyRun } from "../src/core/runIdentification";
import { RunView, RunSummary } from "../src/core/types";

describe("buildRunArgs", () => {
  // Feature: vscode-deploy-extension, Property 8: Dispatch arguments include ref, environment, and every collected input
  it("Property 8: includes workflow, --ref, and one --field per input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.dictionary(
          fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/),
          fc.string({ maxLength: 20 }),
          { maxKeys: 6 }
        ),
        (workflow, ref, fields) => {
          const args = buildRunArgs(workflow, ref, fields);
          expect(args[0]).toBe("workflow");
          expect(args[1]).toBe("run");
          expect(args[2]).toBe(workflow);
          const refIdx = args.indexOf("--ref");
          expect(refIdx).toBeGreaterThan(-1);
          expect(args[refIdx + 1]).toBe(ref);
          // Each field appears as a discrete --field name=value pair (argument-array safety).
          for (const [k, v] of Object.entries(fields)) {
            const pair = `${k}=${v}`;
            let found = false;
            for (let i = 0; i < args.length - 1; i++) {
              if (args[i] === "--field" && args[i + 1] === pair) {
                found = true;
                break;
              }
            }
            expect(found).toBe(true);
          }
          const fieldCount = args.filter((a) => a === "--field").length;
          expect(fieldCount).toBe(Object.keys(fields).length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("classifyPhase", () => {
  // Feature: vscode-deploy-extension, Property 10: Run phase classification is total over gh status/conclusion
  it("Property 10: classifies waiting/completed/pending totally", () => {
    const statusArb = fc.oneof(
      fc.constantFrom("queued", "in_progress", "waiting", "completed", "requested", "pending"),
      fc.string()
    );
    const conclusionArb = fc.oneof(
      fc.constantFrom("success", "failure", "cancelled", "timed_out", "skipped", "neutral"),
      fc.constant(null),
      fc.string()
    );
    fc.assert(
      fc.property(statusArb, conclusionArb, (status, conclusion) => {
        const view: RunView = { databaseId: "1", status, conclusion, url: "u" };
        const phase = classifyPhase(view);
        if (status === "completed") {
          expect(phase.kind).toBe("completed");
          if (phase.kind === "completed") {
            if (conclusion === "success") expect(phase.conclusion).toBe("success");
            else if (conclusion === "cancelled") expect(phase.conclusion).toBe("cancelled");
            else expect(["failure", "other"]).toContain(phase.conclusion);
          }
        } else if (status === "waiting") {
          expect(phase.kind).toBe("waiting-approval");
        } else {
          expect(phase.kind).toBe("pending");
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("identifyRun", () => {
  // Feature: vscode-deploy-extension, Property 11: Run identification selects the newest matching run after dispatch
  it("Property 11: picks newest matching run at/after dispatchedAt within skew", () => {
    const runArb = (workflow: string, branch: string): fc.Arbitrary<RunSummary> =>
      fc.record({
        databaseId: fc.hexaString({ minLength: 1, maxLength: 6 }),
        name: fc.oneof(fc.constant(workflow), fc.string({ minLength: 1, maxLength: 6 })),
        headBranch: fc.oneof(fc.constant(branch), fc.string({ minLength: 1, maxLength: 6 })),
        status: fc.constant("completed"),
        createdAt: fc
          .integer({ min: Date.parse("2026-01-01T00:00:00Z"), max: Date.parse("2026-12-31T00:00:00Z") })
          .map((ms) => new Date(ms).toISOString()),
        url: fc.constant("u"),
      });

    fc.assert(
      fc.property(
        fc.integer({ min: Date.parse("2026-06-01T00:00:00Z"), max: Date.parse("2026-06-30T00:00:00Z") }),
        fc.array(runArb("Deploy", "main"), { maxLength: 12 }),
        (dispatchedMs, runs) => {
          const dispatchedAt = new Date(dispatchedMs);
          const skewMs = 60_000;
          const result = identifyRun(runs, "Deploy", "main", dispatchedAt, skewMs);

          const eligible = runs.filter(
            (r) =>
              r.name === "Deploy" &&
              r.headBranch === "main" &&
              Date.parse(r.createdAt) >= dispatchedMs - skewMs
          );
          if (eligible.length === 0) {
            expect(result).toBeUndefined();
          } else {
            const newest = eligible.reduce((a, b) =>
              Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b
            );
            expect(result).toBeDefined();
            expect(Date.parse(result!.createdAt)).toBe(Date.parse(newest.createdAt));
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
