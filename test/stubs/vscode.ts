// Minimal vscode stub for unit tests run in Node (no VS Code host).
export const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", command: "" }),
  withProgress: async (_opts: unknown, task: (p: unknown, t: unknown) => Promise<unknown>) =>
    task({ report() {} }, { isCancellationRequested: false, onCancellationRequested() {} }),
};
export const workspace = {
  getConfiguration: () => ({ get: () => undefined }),
  workspaceFolders: [] as unknown[],
};
export const commands = { registerCommand: () => ({ dispose() {} }) };
export const env = { openExternal: async () => true };
export const Uri = { parse: (s: string) => ({ toString: () => s }) };
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ProgressLocation { Notification = 15 }
export enum QuickPickItemKind { Separator = -1, Default = 0 }
export default {};