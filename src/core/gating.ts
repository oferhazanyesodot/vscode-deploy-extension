import { DeployEnvironment, Gate } from "./types";

// Total mapping from environment to its gate.
// dev -> none, preprod -> confirm, prod -> protected (rely on GitHub Environments).
export function gateFor(env: DeployEnvironment): Gate {
  switch (env) {
    case "dev":
      return { kind: "none" };
    case "preprod":
      return { kind: "confirm" };
    case "prod":
      return { kind: "protected" };
  }
}
