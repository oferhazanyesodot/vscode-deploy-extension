import * as vscode from "vscode";
import { successMessage, failureMessage, cancelledMessage } from "../core/messages";
import { SwitchSummary, DeploymentSummary } from "../core/profileTypes";

export class NotificationService {
  success(repo: string, env: string): void {
    void vscode.window.showInformationMessage(successMessage(repo, env));
  }

  failure(repo: string, env: string, runUrl: string): void {
    void vscode.window
      .showErrorMessage(failureMessage(repo, env, runUrl), "Open Run")
      .then((choice) => {
        if (choice === "Open Run" && runUrl) {
          void vscode.env.openExternal(vscode.Uri.parse(runUrl));
        }
      });
  }

  cancelled(repo: string, env: string): void {
    void vscode.window.showWarningMessage(cancelledMessage(repo, env));
  }

  error(message: string): void {
    void vscode.window.showErrorMessage(message);
  }

  async warnConfirm(message: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Continue");
    return choice === "Continue";
  }

  async confirm(message: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Deploy");
    return choice === "Deploy";
  }

  private channel: vscode.OutputChannel | undefined;

  private out(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("Deploy");
    }
    return this.channel;
  }

  switchSummary(summary: SwitchSummary): void {
    const ch = this.out();
    ch.appendLine(`Switch profile: ${summary.branch}`);
    for (const res of summary.results) {
      let line = `  ${res.repoName} [${res.location}]: ${res.outcome.kind}`;
      if (res.outcome.kind === "failed") {
        line += ` - ${res.outcome.error.trim()}`;
      }
      if (res.stashed) {
        line += " (stashed)";
      }
      ch.appendLine(line);
    }
    const msg = `Switch ${summary.branch}: ${summary.switchedCount} switched, ${summary.skippedCount} skipped, ${summary.failedCount} failed.`;
    void vscode.window.showInformationMessage(msg, "Show details").then((c) => {
      if (c === "Show details") {
        ch.show();
      }
    });
  }

  deploymentSummary(summary: DeploymentSummary): void {
    const ch = this.out();
    ch.appendLine(`Profile deploy: ${summary.branch} -> ${summary.environment}`);
    for (const res of summary.results) {
      let line = `  ${res.repoName}: ${res.dispatch.kind}`;
      if (res.dispatch.kind === "dispatch-failed") {
        line += ` - ${res.dispatch.error.trim()}`;
      }
      if (res.runConclusion) {
        line += ` (run: ${res.runConclusion})`;
      }
      if (res.runUrl) {
        line += ` ${res.runUrl}`;
      }
      ch.appendLine(line);
    }
    const msg = `Profile ${summary.branch} -> ${summary.environment}: ${summary.succeededCount} succeeded, ${summary.failedCount} failed.`;
    const fn = summary.failedCount > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void fn(msg, "Show details").then((c) => {
      if (c === "Show details") {
        ch.show();
      }
    });
  }
}