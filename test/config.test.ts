import { describe, it, expect } from "vitest";
import { clampInterval, normalizeConfig, MIN_POLL_INTERVAL_SECONDS, DEFAULT_POLL_INTERVAL_SECONDS } from "../src/core/config";

describe("config clamping", () => {
  it("clamps values below the minimum", () => {
    expect(clampInterval(1)).toBe(MIN_POLL_INTERVAL_SECONDS);
    expect(clampInterval(0)).toBe(MIN_POLL_INTERVAL_SECONDS);
    expect(clampInterval(-5)).toBe(MIN_POLL_INTERVAL_SECONDS);
  });

  it("passes valid values through", () => {
    expect(clampInterval(5)).toBe(5);
    expect(clampInterval(30)).toBe(30);
  });

  it("falls back to default for non-numbers", () => {
    expect(clampInterval("x")).toBe(DEFAULT_POLL_INTERVAL_SECONDS);
    expect(clampInterval(undefined)).toBe(DEFAULT_POLL_INTERVAL_SECONDS);
    expect(clampInterval(NaN)).toBe(DEFAULT_POLL_INTERVAL_SECONDS);
  });

  it("normalizeConfig filters non-string mapping values and clamps interval", () => {
    const cfg = normalizeConfig({
      workflowMapping: { "my-backend": "deploy-backend.yaml", bad: 42 },
      pollIntervalSeconds: 1,
    });
    expect(cfg.workflowMapping).toEqual({ "my-backend": "deploy-backend.yaml" });
    expect(cfg.pollIntervalSeconds).toBe(MIN_POLL_INTERVAL_SECONDS);
  });

  it("normalizeConfig keeps only string arrays for pinnedWorkflows", () => {
    const cfg = normalizeConfig({
      pinnedWorkflows: {
        "my-backend": ["deploy-backend.yaml", 5, "deploy-permissions.yaml"],
        "bad": "not-an-array",
      },
    });
    expect(cfg.pinnedWorkflows["my-backend"]).toEqual([
      "deploy-backend.yaml",
      "deploy-permissions.yaml",
    ]);
    expect(cfg.pinnedWorkflows["bad"]).toBeUndefined();
  });

  it("normalizeConfig defaults pinnedWorkflows to empty object", () => {
    const cfg = normalizeConfig({});
    expect(cfg.pinnedWorkflows).toEqual({});
  });
});