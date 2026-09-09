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
  it("registers deploy.run command and a status bar item targeting it", () => {
    const registered: string[] = [];
    const statusBar = { text: "", command: "", tooltip: "", show: vi.fn(), dispose: vi.fn() };

    (vscode.commands as unknown as { registerCommand: (id: string) => { dispose(): void } }).registerCommand =
      (id: string) => {
        registered.push(id);
        return { dispose() {} };
      };
    (vscode.window as unknown as { createStatusBarItem: () => typeof statusBar }).createStatusBarItem =
      () => statusBar;

    const subs: unknown[] = [];
    activate({ subscriptions: subs } as unknown as import("vscode").ExtensionContext);

    expect(registered).toContain("deploy.run");
    expect(statusBar.command).toBe("deploy.run");
    expect(statusBar.show).toHaveBeenCalled();
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });
});