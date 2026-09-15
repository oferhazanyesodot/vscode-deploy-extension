import { checkboxKey } from "../core/checkboxKey";

// Minimal Memento shape (matches vscode.Memento's get/update we use).
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

// Persists per-(profile, repo) checkbox choices. Default checked when unseen.
export class CheckboxStateStore {
  constructor(private readonly memento: MementoLike) {}

  isChecked(profile: string, repo: string): boolean {
    const v = this.memento.get<boolean>(checkboxKey(profile, repo));
    return v === undefined ? true : v;
  }

  async setChecked(profile: string, repo: string, checked: boolean): Promise<void> {
    await this.memento.update(checkboxKey(profile, repo), checked);
  }
}