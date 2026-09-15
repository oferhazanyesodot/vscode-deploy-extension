import * as vscode from "vscode";
import { RepoCandidate, Cancelled, CANCELLED } from "../core/types";
import { Profile } from "../core/profileTypes";
import { buildProfileSections, toggleHidden } from "../core/profileGrouping";
import { assembleProfiles, manualProfilesFromConfig } from "../core/manualProfiles";
import { ConfigService } from "./configService";
import { ManualProfileBuilder } from "./manualProfileBuilder";

export type PickerChoice =
  | { kind: "profile"; profile: Profile }
  | { kind: "repo"; candidate: RepoCandidate }
  | { kind: "freeText"; branch: string }
  | Cancelled;

export interface ProfilePickerOptions {
  title: string;
  includeIndividualRepos?: RepoCandidate[];
  placeholder?: string;
}

interface Item extends vscode.QuickPickItem {
  choice?: PickerChoice;
  profileName?: string; // present on profile rows (for the eye toggle)
  hidden?: boolean;     // is this row currently a hidden profile
}

const EYE = "$(eye)";
const EYE_CLOSED = "$(eye-closed)";

export class ProfilePicker {
  constructor(
    private readonly config: ConfigService,
    private readonly builder: ManualProfileBuilder,
    private readonly deployableRepos: () => RepoCandidate[]
  ) {}

  async pick(autoProfiles: Profile[], options: ProfilePickerOptions): Promise<PickerChoice> {
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = options.title;
    qp.placeholder = options.placeholder ?? "Select a profile or repository";
    const addButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("add"), tooltip: "Add manual profile" };
    qp.buttons = [addButton];

    let hidden = this.config.hiddenProfiles();

    const rebuild = () => {
      const manual = manualProfilesFromConfig(this.config.manualProfiles());
      const all = assembleProfiles(autoProfiles, manual);
      const sections = buildProfileSections(all, hidden);
      const items: Item[] = [];

      if (options.includeIndividualRepos && options.includeIndividualRepos.length > 0) {
        items.push({ label: "Repositories", kind: vscode.QuickPickItemKind.Separator });
        for (const r of options.includeIndividualRepos) {
          items.push({ label: r.name, description: r.rootPath, choice: { kind: "repo", candidate: r } });
        }
      }

      const eyeBtn = (closed: boolean): vscode.QuickInputButton => ({
        iconPath: new vscode.ThemeIcon(closed ? "eye-closed" : "eye"),
        tooltip: closed ? "Unhide profile" : "Hide profile",
      });

      const pushProfiles = (label: string, profiles: Profile[], asHidden: boolean) => {
        if (profiles.length === 0) return;
        items.push({ label, kind: vscode.QuickPickItemKind.Separator });
        for (const p of profiles) {
          const tag = p.kind === "manual" ? " (manual)" : "";
          items.push({
            label: `${p.name}${tag}`,
            description: `${p.targets.length} repos`,
            buttons: [eyeBtn(asHidden)],
            choice: { kind: "profile", profile: p },
            profileName: p.name,
            hidden: asHidden,
          });
        }
      };

      pushProfiles("Starred profiles", sections.starred, false);
      pushProfiles("Live profiles", sections.live, false);
      pushProfiles("Manual profiles", sections.manual, false);
      pushProfiles("Environment profiles", sections.environment, false);
      pushProfiles("Hidden profiles", sections.hidden, true);

      qp.items = items;
    };

    rebuild();

    return new Promise<PickerChoice>((resolve) => {
      let resolved = false;
      const finish = (choice: PickerChoice) => {
        if (resolved) return;
        resolved = true;
        qp.hide();
        qp.dispose();
        resolve(choice);
      };

      qp.onDidTriggerItemButton(async (e) => {
        const name = e.item.profileName;
        if (!name) return;
        hidden = toggleHidden(hidden, name);
        try {
          await this.config.setHiddenProfiles(hidden);
        } catch {
          // revert in-memory on failure
          hidden = toggleHidden(hidden, name);
          void vscode.window.showErrorMessage(`Failed to update hidden profiles for "${name}".`);
          return;
        }
        rebuild();
      });

      qp.onDidTriggerButton(async (btn) => {
        if (btn === addButton) {
          const result = await this.builder.run(this.deployableRepos());
          // builder persists on success; rebuild either way (no-op on cancel)
          rebuild();
          void result;
        }
      });

      qp.onDidAccept(() => {
        const active = qp.selectedItems[0] ?? qp.activeItems[0];
        if (active && active.choice) {
          // Hidden rows are not directly selectable for deploy/switch.
          if (active.hidden) {
            return;
          }
          finish(active.choice);
          return;
        }
        // Free-text: typed value that is not an item.
        const typed = qp.value.trim();
        if (typed !== "") {
          finish({ kind: "freeText", branch: typed });
        }
      });

      qp.onDidHide(() => finish(CANCELLED));
      qp.show();
    });
  }
}