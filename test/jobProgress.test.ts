import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeJobProgress, JobInfo } from "../src/core/jobProgress";

describe("computeJobProgress", () => {
  it("example: 4 of 7 completed -> 57%", () => {
    const jobs: JobInfo[] = [
      { name: "a", status: "completed", conclusion: "success" },
      { name: "b", status: "completed", conclusion: "success" },
      { name: "c", status: "completed", conclusion: "success" },
      { name: "d", status: "completed", conclusion: "skipped" },
      { name: "e", status: "in_progress", conclusion: null },
      { name: "f", status: "queued", conclusion: null },
      { name: "g", status: "queued", conclusion: null },
    ];
    const p = computeJobProgress(jobs);
    expect(p.total).toBe(7);
    expect(p.completed).toBe(4);
    expect(p.percent).toBe(57);
    expect(p.currentJob).toBe("e");
  });

  it("empty job list -> 0% and no current job", () => {
    const p = computeJobProgress([]);
    expect(p).toEqual({ total: 0, completed: 0, percent: 0, currentJob: undefined });
  });

  it("Property: percent is completed/total rounded, within 0..100, completed<=total", () => {
    const jobArb = fc.record({
      name: fc.hexaString({ minLength: 1, maxLength: 4 }),
      status: fc.constantFrom("queued", "in_progress", "completed", "waiting"),
      conclusion: fc.oneof(fc.constant(null), fc.constantFrom("success", "failure", "skipped")),
    });
    fc.assert(
      fc.property(fc.array(jobArb, { maxLength: 20 }), (jobs: JobInfo[]) => {
        const p = computeJobProgress(jobs);
        expect(p.total).toBe(jobs.length);
        expect(p.completed).toBeLessThanOrEqual(p.total);
        expect(p.percent).toBeGreaterThanOrEqual(0);
        expect(p.percent).toBeLessThanOrEqual(100);
        if (jobs.length === 0) {
          expect(p.percent).toBe(0);
        } else {
          expect(p.percent).toBe(Math.round((p.completed / p.total) * 100));
        }
      }),
      { numRuns: 100 }
    );
  });
});