import { ProcessRunner } from "./processRunner";
import { WorkflowSummary, RunSummary, RunView, ProcessResult } from "../core/types";
import { buildRunArgs } from "../core/ghArgs";

const DEFAULT_TIMEOUT = 30_000;

export class GhCliService {
  constructor(private readonly proc: ProcessRunner) {}

  private run(repoRoot: string, args: string[], timeoutMs = DEFAULT_TIMEOUT): Promise<ProcessResult> {
    return this.proc.run("gh", args, { cwd: repoRoot, timeoutMs });
  }

  async isInstalled(): Promise<boolean> {
    const r = await this.proc.run("gh", ["--version"], { cwd: process.cwd(), timeoutMs: 10_000 });
    return r.code === 0;
  }

  async isAuthenticated(repoRoot: string): Promise<boolean> {
    const r = await this.run(repoRoot, ["auth", "status"], 10_000);
    return r.code === 0;
  }

  async listWorkflows(repoRoot: string): Promise<WorkflowSummary[]> {
    const r = await this.run(repoRoot, ["workflow", "list", "--json", "name,id,path,state"]);
    if (r.code !== 0) {
      return [];
    }
    try {
      const parsed = JSON.parse(r.stdout) as Array<{ name: string; id: number | string; path: string }>;
      return parsed.map((w) => ({ id: String(w.id), name: w.name, path: w.path }));
    } catch {
      return [];
    }
  }

  async viewWorkflowYaml(repoRoot: string, workflow: string): Promise<string> {
    const r = await this.run(repoRoot, ["workflow", "view", workflow, "--yaml"]);
    return r.code === 0 ? r.stdout : "";
  }

  async runWorkflow(
    repoRoot: string,
    workflow: string,
    ref: string,
    fields: Record<string, string>
  ): Promise<ProcessResult> {
    const args = buildRunArgs(workflow, ref, fields);
    return this.run(repoRoot, args);
  }

  async listRuns(repoRoot: string, workflow: string, branch: string): Promise<RunSummary[]> {
    const r = await this.run(repoRoot, [
      "run",
      "list",
      "--workflow",
      workflow,
      "--branch",
      branch,
      "--json",
      "databaseId,name,headBranch,status,createdAt,url",
      "--limit",
      "20",
    ]);
    if (r.code !== 0) {
      return [];
    }
    try {
      const parsed = JSON.parse(r.stdout) as Array<{
        databaseId: number | string;
        name: string;
        headBranch: string;
        status: string;
        createdAt: string;
        url: string;
      }>;
      return parsed.map((x) => ({
        databaseId: String(x.databaseId),
        name: x.name,
        headBranch: x.headBranch,
        status: x.status,
        createdAt: x.createdAt,
        url: x.url,
      }));
    } catch {
      return [];
    }
  }

  async viewRun(repoRoot: string, runId: string): Promise<RunView | undefined> {
    const r = await this.run(repoRoot, [
      "run",
      "view",
      runId,
      "--json",
      "status,conclusion,url,databaseId,jobs",
    ]);
    if (r.code !== 0) {
      return undefined;
    }
    try {
      const x = JSON.parse(r.stdout) as {
        databaseId: number | string;
        status: string;
        conclusion: string | null;
        url: string;
        jobs?: Array<{ name: string; status: string; conclusion: string | null }>;
      };
      return {
        databaseId: String(x.databaseId),
        status: x.status,
        conclusion: x.conclusion ?? null,
        url: x.url,
        jobs: (x.jobs ?? []).map((j) => ({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion ?? null,
        })),
      };
    } catch {
      return undefined;
    }
  }
}