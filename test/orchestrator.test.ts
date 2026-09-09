import { describe, it, expect, vi } from "vitest";
import { DeployCommandHandler, Deps } from "../src/deployCommandHandler";
import { RepoCandidate, DeployEnvironment, RunView, RunSummary } from "../src/core/types";

const repo: RepoCandidate = {
  name: "my-client",
  rootPath: "C:/repos/my-client",
  hasDeployWorkflow: true,
};

const run: RunSummary = {
  databaseId: "99",
  name: "Deploy Service",
  headBranch: "fix/x",
  status: "completed",
  createdAt: new Date().toISOString(),
  url: "https://github.com/run/99",
};

function baseDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    ghIsInstalled: vi.fn(async () => true),
    ghIsAuthenticated: vi.fn(async () => true),
    resolveRepo: vi.fn(async () => repo),
    resolveWorkflow: vi.fn(async () => "deploy.yaml"),
    pickEnvironment: vi.fn(async () => "dev" as DeployEnvironment),
    gitStatus: vi.fn(async () => ({ staged: false, unstaged: false, untracked: false })),
    currentBranch: vi.fn(async () => "fix/x"),
    confirmDirty: vi.fn(async () => true),
    confirmPreprod: vi.fn(async () => true),
    viewWorkflowYaml: vi.fn(async () => ""),
    collectInputs: vi.fn(async () => ({})),
    runWorkflow: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    identifyRun: vi.fn(async () => run),
    track: vi.fn(async (): Promise<RunView> => ({ databaseId: "99", status: "completed", conclusion: "success", url: run.url })),
    activeFilePath: vi.fn(() => undefined),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyFailure: vi.fn(),
    notifyCancelled: vi.fn(),
    notifyInfo: vi.fn(),
    ...overrides,
  };
}

describe("DeployCommandHandler.execute", () => {
  it("happy path dev: dispatches and notifies success", async () => {
    const d = baseDeps();
    await new DeployCommandHandler(d).execute();
    expect(d.runWorkflow).toHaveBeenCalledOnce();
    expect(d.notifySuccess).toHaveBeenCalledWith("my-client", "dev");
  });

  it("determines repo before dispatch (ordering)", async () => {
    const order: string[] = [];
    const d = baseDeps({
      resolveRepo: vi.fn(async () => { order.push("repo"); return repo; }),
      runWorkflow: vi.fn(async () => { order.push("dispatch"); return { code: 0, stdout: "", stderr: "" }; }),
    });
    await new DeployCommandHandler(d).execute();
    expect(order[0]).toBe("repo");
    expect(order).toContain("dispatch");
  });

  it("gh not installed ends flow with error, no dispatch", async () => {
    const d = baseDeps({ ghIsInstalled: vi.fn(async () => false) });
    await new DeployCommandHandler(d).execute();
    expect(d.notifyError).toHaveBeenCalled();
    expect(d.runWorkflow).not.toHaveBeenCalled();
  });

  it("gh unauthenticated ends flow mentioning gh auth login, no dispatch", async () => {
    const d = baseDeps({ ghIsAuthenticated: vi.fn(async () => false) });
    await new DeployCommandHandler(d).execute();
    expect(d.notifyError).toHaveBeenCalledWith(expect.stringContaining("gh auth login"));
    expect(d.runWorkflow).not.toHaveBeenCalled();
  });

  it("environment cancel ends flow with no dispatch", async () => {
    const d = baseDeps({ pickEnvironment: vi.fn(async () => ({ kind: "cancelled" as const })) });
    await new DeployCommandHandler(d).execute();
    expect(d.runWorkflow).not.toHaveBeenCalled();
  });

  it("dirty-tree decline ends flow with no dispatch", async () => {
    const d = baseDeps({
      gitStatus: vi.fn(async () => ({ staged: true, unstaged: false, untracked: false })),
      confirmDirty: vi.fn(async () => false),
    });
    await new DeployCommandHandler(d).execute();
    expect(d.confirmDirty).toHaveBeenCalled();
    expect(d.runWorkflow).not.toHaveBeenCalled();
  });

  it("preprod decline ends flow with no dispatch", async () => {
    const d = baseDeps({
      pickEnvironment: vi.fn(async () => "preprod" as DeployEnvironment),
      confirmPreprod: vi.fn(async () => false),
    });
    await new DeployCommandHandler(d).execute();
    expect(d.confirmPreprod).toHaveBeenCalled();
    expect(d.runWorkflow).not.toHaveBeenCalled();
  });

  it("prod path performs NO local approval and dispatches, relying on GitHub Environments", async () => {
    const d = baseDeps({ pickEnvironment: vi.fn(async () => "prod" as DeployEnvironment) });
    await new DeployCommandHandler(d).execute();
    expect(d.confirmPreprod).not.toHaveBeenCalled();
    expect(d.runWorkflow).toHaveBeenCalledOnce();
  });

  it("dispatch non-zero surfaces stderr and stops", async () => {
    const d = baseDeps({
      runWorkflow: vi.fn(async () => ({ code: 1, stdout: "", stderr: "permission denied" })),
    });
    await new DeployCommandHandler(d).execute();
    expect(d.notifyError).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    expect(d.identifyRun).not.toHaveBeenCalled();
  });

  it("failure conclusion notifies failure with run url", async () => {
    const d = baseDeps({
      track: vi.fn(async (): Promise<RunView> => ({ databaseId: "99", status: "completed", conclusion: "failure", url: "https://github.com/run/99" })),
    });
    await new DeployCommandHandler(d).execute();
    expect(d.notifyFailure).toHaveBeenCalledWith("my-client", "dev", "https://github.com/run/99");
  });

  it("cancelled conclusion notifies cancelled", async () => {
    const d = baseDeps({
      track: vi.fn(async (): Promise<RunView> => ({ databaseId: "99", status: "completed", conclusion: "cancelled", url: run.url })),
    });
    await new DeployCommandHandler(d).execute();
    expect(d.notifyCancelled).toHaveBeenCalledWith("my-client", "dev");
  });

  it("collects additional inputs when workflow declares them", async () => {
    const yaml = [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      deployment-environment:",
      "        type: choice",
      "        options:",
      "          - dev",
      "      deploy_monolith:",
      "        type: boolean",
      "        default: true",
    ].join("\n");
    const collectInputs = vi.fn(async () => ({ deploy_monolith: "true" }));
    const runWorkflow = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const d = baseDeps({ viewWorkflowYaml: vi.fn(async () => yaml), collectInputs, runWorkflow });
    await new DeployCommandHandler(d).execute();
    expect(collectInputs).toHaveBeenCalled();
    const fields = (runWorkflow.mock.calls[0] as unknown as unknown[])[3] as Record<string, string>;
    expect(fields).toMatchObject({ "deployment-environment": "dev", deploy_monolith: "true" });
  });
});