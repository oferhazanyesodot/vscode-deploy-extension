import { spawn } from "child_process";
import { ProcessResult } from "../core/types";

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
}

export interface ProcessRunner {
  run(command: string, args: string[], opts: RunOptions): Promise<ProcessResult>;
}

// Spawns child processes with shell:false and an argument array.
// Never interpolates values into a shell string (injection-safe, cross-platform).
export class SpawnProcessRunner implements ProcessRunner {
  run(command: string, args: string[], opts: RunOptions): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (result: ProcessResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      };

      if (opts.timeoutMs && opts.timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill();
          finish({ code: -1, stdout, stderr: stderr + `\nProcess timed out after ${opts.timeoutMs}ms` });
        }, opts.timeoutMs);
      }

      child.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        finish({ code: -1, stdout, stderr: stderr + String(err) });
      });
      child.on("close", (code) => {
        finish({ code: code ?? -1, stdout, stderr });
      });
    });
  }
}