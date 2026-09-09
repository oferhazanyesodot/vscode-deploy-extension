import { describe, it, expect } from "vitest";
import { GhCliService } from "../src/services/ghCliService";
import { GitService } from "../src/services/gitService";
import { ProcessRunner, RunOptions } from "../src/services/processRunner";
import { ProcessResult } from "../src/core/types";

class MockRunner implements ProcessRunner {
  public calls: { command: string; args: string[]; opts: RunOptions }[] = [];
  constructor(private readonly responder: (command: string, args: string[]) => ProcessResult) {}
  run(command: string, args: string[], opts: RunOptions): Promise<ProcessResult> {
    this.calls.push({ command, args, opts });
    return Promise.resolve(this.responder(command, args));
  }
}

function ok(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: "" };
}
function fail(stderr: string, code = 1): ProcessResult {
  return { code, stdout: "", stderr };
}

describe("GhCliService prerequisites", () => {
  it("isInstalled true when gh --version exits 0", async () => {
    const gh = new GhCliService(new MockRunner(() => ok("gh version 2.89.0")));
    expect(await gh.isInstalled()).toBe(true);
  });

  it("isInstalled false when gh --version fails", async () => {
    const gh = new GhCliService(new MockRunner(() => fail("not found", -1)));
    expect(await gh.isInstalled()).toBe(false);
  });

  it("isAuthenticated true when gh auth status exits 0", async () => {
    const gh = new GhCliService(new MockRunner(() => ok("Logged in")));
    expect(await gh.isAuthenticated("C:/repo")).toBe(true);
  });

  it("isAuthenticated false when gh auth status non-zero", async () => {
    const gh = new GhCliService(new MockRunner(() => fail("not logged in")));
    expect(await gh.isAuthenticated("C:/repo")).toBe(false);
  });
});

describe("GhCliService parsing", () => {
  it("listWorkflows parses JSON and stringifies ids", async () => {
    const json = JSON.stringify([{ name: "Deploy", id: 123, path: ".github/workflows/deploy.yaml" }]);
    const gh = new GhCliService(new MockRunner(() => ok(json)));
    const wfs = await gh.listWorkflows("C:/repo");
    expect(wfs).toEqual([{ id: "123", name: "Deploy", path: ".github/workflows/deploy.yaml" }]);
  });

  it("listWorkflows returns [] on non-zero exit", async () => {
    const gh = new GhCliService(new MockRunner(() => fail("boom")));
    expect(await gh.listWorkflows("C:/repo")).toEqual([]);
  });

  it("viewRun returns undefined on non-zero exit (data, not exception)", async () => {
    const gh = new GhCliService(new MockRunner(() => fail("boom")));
    expect(await gh.viewRun("C:/repo", "1")).toBeUndefined();
  });

  it("runWorkflow passes through the built argument array to gh", async () => {
    const runner = new MockRunner(() => ok(""));
    const gh = new GhCliService(runner);
    await gh.runWorkflow("C:/repo", "deploy.yaml", "main", { "deployment-environment": "dev" });
    const call = runner.calls[0];
    expect(call.command).toBe("gh");
    expect(call.args).toEqual([
      "workflow", "run", "deploy.yaml", "--ref", "main",
      "--field", "deployment-environment=dev",
    ]);
    expect(call.opts.cwd).toBe("C:/repo");
  });
});

describe("GitService", () => {
  it("status parses porcelain via cwd=repoRoot", async () => {
    const runner = new MockRunner(() => ok("M  a.ts\n?? b.ts\n"));
    const git = new GitService(runner);
    const s = await git.status("C:/repo");
    expect(s.staged).toBe(true);
    expect(s.untracked).toBe(true);
    expect(runner.calls[0].opts.cwd).toBe("C:/repo");
  });

  it("currentBranch trims output", async () => {
    const git = new GitService(new MockRunner(() => ok("fix/classified-group-video-room\n")));
    expect(await git.currentBranch("C:/repo")).toBe("fix/classified-group-video-room");
  });
});