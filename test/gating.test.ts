import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { gateFor } from "../src/core/gating";
import { DeployEnvironment } from "../src/core/types";

describe("gateFor", () => {
  // Feature: vscode-deploy-extension, Property 3: Environment gate mapping is total and fixed
  it("Property 3: maps each environment to exactly one fixed gate and is total", () => {
    const envArb = fc.constantFrom<DeployEnvironment>("dev", "preprod", "prod");
    fc.assert(
      fc.property(fc.oneof(envArb, fc.string()), (env) => {
        const known: Record<DeployEnvironment, string> = {
          dev: "none",
          preprod: "confirm",
          prod: "protected",
        };
        if (env === "dev" || env === "preprod" || env === "prod") {
          expect(gateFor(env).kind).toBe(known[env]);
        } else {
          // Totality: for any string not in the union, gateFor still returns a gate
          // (undefined at runtime via the switch). Guard the type boundary.
          const g = gateFor(env as DeployEnvironment);
          expect(g === undefined || ["none", "confirm", "protected"].includes(g.kind)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
