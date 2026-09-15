// Minimal vscode stub for unit tests run in Node (no VS Code host).

function makeEmitter<T>() {
  const handlers: ((e: T) => void)[] = [];
  const event = (h: (e: T) => void) => {
    handlers.push(h);
    return { dispose() {} };
  };
  (event as unknown as { fire: (e: T) => void }).fire = (e: T) => {
    for (const h of handlers) h(e);
  };
  return event as ((h: (e: T) => void) => { dispose(): void }) & { fire: (e: T) => void };
}

export function createQuickPickStub<T = unknown>() {
  return {
    title: "",
    placeholder: "",
    value: "",
    items: [] as T[],
    activeItems: [] as T[],
    selectedItems: [] as T[],
    buttons: [] as unknown[],
    onDidTriggerItemButton: makeEmitter<{ item: T; button: unknown }>(),
    onDidTriggerButton: makeEmitter<unknown>(),
    onDidAccept: makeEmitter<void>(),
    onDidHide: makeEmitter<void>(),
    show() {},
    hide() {},
    dispose() {},
  };
}

export const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", command: "" }),
  createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {}, clear() {} }),
  createQuickPick: () => createQuickPickStub(),
  withProgress: async (_opts: unknown, task: (p: unknown, t: unknown) => Promise<unknown>) =>
    task({ report() {} }, { isCancellationRequested: false, onCancellationRequested() {} }),
  createTreeView: (_id: string, _opts: unknown) => ({
    onDidChangeCheckboxState: (() => ({ dispose() {} })) as unknown,
    dispose() {},
  }),
  registerTreeDataProvider: (_id: string, _p: unknown) => ({ dispose() {} }),
};
export const workspace = {
  getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
  workspaceFolders: [] as unknown[],
};
export const commands = { registerCommand: () => ({ dispose() {} }) };
export const env = { openExternal: async () => true, clipboard: { writeText: async () => {}, readText: async () => "" } };
export const Uri = { parse: (s: string) => ({ toString: () => s }) };
export class ThemeIcon {
  constructor(public readonly id: string) {}
}
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ProgressLocation { Notification = 15 }
export enum QuickPickItemKind { Separator = -1, Default = 0 }
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum TreeItemCheckboxState { Unchecked = 0, Checked = 1 }
export class TreeItem {
  label: string;
  collapsibleState: number;
  description?: string;
  contextValue?: string;
  checkboxState?: number;
  constructor(label: string, collapsibleState = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
export class EventEmitter<T> {
  private handlers: ((e: T) => void)[] = [];
  event = (h: (e: T) => void) => {
    this.handlers.push(h);
    return { dispose: () => {} };
  };
  fire(e: T) {
    for (const h of this.handlers) h(e);
  }
  dispose() {}
}
export default {};