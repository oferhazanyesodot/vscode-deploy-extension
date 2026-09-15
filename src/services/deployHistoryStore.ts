import * as vscode from "vscode";
import { DeployHistoryEntry, addHistoryEntry, DEFAULT_HISTORY_CAP } from "../core/deployHistory";

const KEY = "deploy.history";

// Persists deploy history in globalState (per-machine, survives reloads, not
// shared through settings/source control).
export class DeployHistoryStore {
  constructor(private readonly memento: vscode.Memento, private readonly cap = DEFAULT_HISTORY_CAP) {}

  all(): DeployHistoryEntry[] {
    return this.memento.get<DeployHistoryEntry[]>(KEY, []);
  }

  latest(): DeployHistoryEntry | undefined {
    return this.all()[0];
  }

  async add(entry: DeployHistoryEntry): Promise<void> {
    const next = addHistoryEntry(this.all(), entry, this.cap);
    await this.memento.update(KEY, next);
  }

  async clear(): Promise<void> {
    await this.memento.update(KEY, []);
  }
}
