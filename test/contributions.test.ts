import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import * as pkg from "../package.json";
import { activate } from "../src/extension";

describe("package.json contributions", () => {
  it("registers the deploy.run command (Req 1.1)", () => {
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);
    expect(commands).toContain("deploy.run");
  });

  it("declares deploy.workflowMapping and deploy.pollIntervalSeconds config (Req 12.1)", () => {
    const props = pkg.contributes.configuration.properties as Record<string, unknown>;
    expect(props["deploy.workflowMapping"]).toBeDefined();
    expect(props["deploy.pollIntervalSeconds"]).toBeDefined();
    const poll = props["deploy.pollIntervalSeconds"] as { minimum: number; default: number };
    expect(poll.minimum).toBe(2);
    expect(poll.default).toBe(5);
  });
});

describe("activation wiring (Req 1.1, 1.2)", () => {
  it("registers commands (including tree + cancel) without status bar items", () => {
    const registered: string[] = [];

    (vscode.commands as unknown as { registerCommand: (id: string) => { dispose(): void } }).registerCommand =
      (id: string) => {
        registered.push(id);
        return { dispose() {} };
      };

    const subs: unknown[] = [];
    activate({
      subscriptions: subs,
      globalState: { get: () => undefined, update: () => Promise.resolve() },
    } as unknown as import("vscode").ExtensionContext);

    // Palette commands remain registered even though status bar items were removed.
    expect(registered).toContain("deploy.run");
    expect(registered).toContain("profile.switch");
    // Sidebar deploy/cancel wiring is present.
    expect(registered).toContain("deploy.profiles.deploy");
    expect(registered).toContain("deploy.profiles.cancel");
    expect(subs.length).toBeGreaterThanOrEqual(4);
  });
});

describe("cancel command contribution", () => {
  it("declares deploy.profiles.cancel and shows it in the view title when deploying", () => {
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);
    expect(commands).toContain("deploy.profiles.cancel");
    const titleMenus = pkg.contributes.menus["view/title"] as { command: string; when: string }[];
    const cancelMenu = titleMenus.find((m) => m.command === "deploy.profiles.cancel");
    expect(cancelMenu).toBeDefined();
    expect(cancelMenu?.when).toContain("deploy.deploying");
  });
});