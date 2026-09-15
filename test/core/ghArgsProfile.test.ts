import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRunArgs } from "../../src/core/ghArgs";

describe("buildRunArgs with profile branch as ref", () => {
  // Feature: profile-deploy, Property 8: Profile dispatch arguments use the profile branch as ref and the selected environment
  it("Property 8: args contain workflow, --ref <profileBranch>, and deployment-environment", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.stringMatching(/^(fix|feature)\/[a-z0-9-]{1,15}$/),
        fc.constantFrom("dev", "preprod", "prod"),
        (workflow, profileBranch, env) => {
          const args = buildRunArgs(workflow, profileBranch, { "deployment-environment": env });
          expect(args[2]).toBe(workflow);
          const refIdx = args.indexOf("--ref");
          expect(refIdx).toBeGreaterThan(-1);
          expect(args[refIdx + 1]).toBe(profileBranch);
          let found = false;
          for (let i = 0; i < args.length - 1; i++) {
            if (args[i] === "--field" && args[i + 1] === `deployment-environment=${env}`) {
              found = true;
            }
          }
          expect(found).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});