import { ProcessRunner } from "./processRunner";
import { GitStatus, ProcessResult } from "../core/types";
import { parseStatus } from "../core/gitStatus";
import { parseBranchList } from "../core/branchParse";
import { RepoBranches } from "../core/profileTypes";

export class GitService {
  constructor(private readonly proc: ProcessRunner) {}

  private run(repoRoot: string, args: string[]): Promise<ProcessResult> {
    return this.proc.run("git", args, { cwd: repoRoot, timeoutMs: 15_000 });
  }

  async status(repoRoot: string): Promise<GitStatus> {
    const r = await this.run(repoRoot, ["status", "--porcelain"]);
    return parseStatus(r.stdout);
  }

  async currentBranch(repoRoot: string): Promise<string> {
    const r = await this.run(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return r.stdout.trim();
  }

  // List local and remote branch names for the repo.
  async listBranches(repoName: string, repoRoot: string): Promise<RepoBranches> {
    const local = await this.run(repoRoot, ["branch", "--list"]);
    const remote = await this.run(repoRoot, ["branch", "-r"]);
    return {
      repoName,
      local: local.code === 0 ? parseBranchList(local.stdout, "local") : [],
      remote: remote.code === 0 ? parseBranchList(remote.stdout, "remote") : [],
    };
  }

  fetchBranch(repoRoot: string, branch: string): Promise<ProcessResult> {
    return this.run(repoRoot, ["fetch", "origin", branch]);
  }

  checkoutBranch(repoRoot: string, branch: string): Promise<ProcessResult> {
    return this.run(repoRoot, ["checkout", branch]);
  }

  checkoutTrackingBranch(repoRoot: string, branch: string): Promise<ProcessResult> {
    return this.run(repoRoot, ["checkout", "-b", branch, "--track", `origin/${branch}`]);
  }

  stashChanges(repoRoot: string): Promise<ProcessResult> {
    return this.run(repoRoot, ["stash", "push", "--include-untracked"]);
  }
}