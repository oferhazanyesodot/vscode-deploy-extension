import { describe, it, expect } from "vitest";
import { successMessage, failureMessage, cancelledMessage } from "../src/core/messages";

describe("notification messages", () => {
  it("success includes repo and env", () => {
    const m = successMessage("my-client", "dev");
    expect(m).toContain("my-client");
    expect(m).toContain("dev");
  });

  it("failure includes repo, env, and run url", () => {
    const m = failureMessage("my-client", "prod", "https://github.com/run/1");
    expect(m).toContain("my-client");
    expect(m).toContain("prod");
    expect(m).toContain("https://github.com/run/1");
  });

  it("cancelled includes repo and env", () => {
    const m = cancelledMessage("my-backend", "preprod");
    expect(m).toContain("my-backend");
    expect(m).toContain("preprod");
  });
});