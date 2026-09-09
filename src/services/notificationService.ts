import * as vscode from "vscode";
import { successMessage, failureMessage, cancelledMessage } from "../core/messages";

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
}