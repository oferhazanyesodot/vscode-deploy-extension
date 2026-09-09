import { ProcessRunner } from "./processRunner";
import { GitStatus } from "../core/types";
import { parseStatus } from "../core/gitStatus";

export class GitService {
  constructor(private readonly proc: ProcessRunner) {}

  async status(repoRoot: string): Promise<GitStatus> {
    const r = await this.proc.run("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      timeoutMs: 10_000,
    });
    return parseStatus(r.stdout);
  }

  async currentBranch(repoRoot: string): Promise<string> {
    const r = await this.proc.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      timeoutMs: 10_000,
    });
    return r.stdout.trim();
  }
}