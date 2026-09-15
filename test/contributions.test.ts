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
  it("registers deploy.run and profile.switch commands with status bar items", () => {
    const registered: string[] = [];
    const bars: { command: string; show: ReturnType<typeof vi.fn> }[] = [];

    (vscode.commands as unknown as { registerCommand: (id: string) => { dispose(): void } }).registerCommand =
      (id: string) => {
        registered.push(id);
        return { dispose() {} };
      };
    (vscode.window as unknown as { createStatusBarItem: () => unknown }).createStatusBarItem = () => {
      const bar = { text: "", command: "", tooltip: "", show: vi.fn(), dispose: vi.fn() };
      bars.push(bar);
      return bar;
    };

    const subs: unknown[] = [];
    activate({ subscriptions: subs } as unknown as import("vscode").ExtensionContext);

    expect(registered).toContain("deploy.run");
    expect(registered).toContain("profile.switch");
    const barCommands = bars.map((b) => b.command);
    expect(barCommands).toContain("deploy.run");
    expect(barCommands).toContain("profile.switch");
    expect(bars.every((b) => b.show.mock.calls.length > 0)).toBe(true);
    expect(subs.length).toBeGreaterThanOrEqual(4);
  });
});