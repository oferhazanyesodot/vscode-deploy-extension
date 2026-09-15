import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  branchUrl,
  comparePrUrl,
  branchLinksText,
  branchLinksMarkdown,
  ProfileBranchLink,
} from "../../src/core/repoLinks";

describe("repoLinks", () => {
  it("Feature: profile-deploy, Property 24: branchUrl builds a /tree/ link and is stable regardless of trailing slashes", () => {
    fc.assert(
      fc.property(
        fc.webUrl().map((u) => u.replace(/\/+$/, "")),
        fc.stringMatching(/^[A-Za-z0-9/_.-]{1,40}$/),
        fc.boolean(),
        (base, branch, withSlash) => {
          const input = withSlash ? `${base}/` : base;
          const url = branchUrl(input, branch);
          // Always contains exactly one /tree/ segment and encodes the branch.
          expect(url).toBe(`${base}/tree/${encodeURIComponent(branch)}`);
          expect(url).not.toContain("//tree/");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("Feature: profile-deploy, Property 25: comparePrUrl builds a base...head compare link with expand", () => {
    fc.assert(
      fc.property(
        fc.webUrl().map((u) => u.replace(/\/+$/, "")),
        fc.stringMatching(/^[A-Za-z0-9/_.-]{1,30}$/),
        fc.stringMatching(/^[A-Za-z0-9/_.-]{1,30}$/),
        (base, target, head) => {
          const url = comparePrUrl(base, target, head);
          expect(url).toBe(
            `${base}/compare/${encodeURIComponent(target)}...${encodeURIComponent(head)}?expand=1`
          );
          expect(url).toContain("...");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("Feature: profile-deploy, Property 26: branchLinksText joins every url on its own line, preserving order and count", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            repo: fc.stringMatching(/^[a-z0-9-]{1,20}$/),
            branch: fc.stringMatching(/^[a-z0-9/-]{1,20}$/),
            url: fc.webUrl(),
          }),
          { maxLength: 12 }
        ),
        (links: ProfileBranchLink[]) => {
          const text = branchLinksText(links);
          if (links.length === 0) {
            expect(text).toBe("");
            return;
          }
          const lines = text.split("\n");
          expect(lines.length).toBe(links.length);
          for (let i = 0; i < links.length; i++) {
            expect(lines[i]).toBe(links[i].url);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("Feature: profile-deploy, Property 27: branchLinksMarkdown has a header plus one checklist row per link", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9/-]{1,20}$/),
        fc.array(
          fc.record({
            repo: fc.stringMatching(/^[a-z0-9-]{1,20}$/),
            branch: fc.stringMatching(/^[a-z0-9/-]{1,20}$/),
            url: fc.webUrl(),
          }),
          { maxLength: 12 }
        ),
        (name, links: ProfileBranchLink[]) => {
          const md = branchLinksMarkdown(name, links);
          const lines = md.split("\n");
          expect(lines[0]).toBe(`### Profile: ${name}`);
          expect(lines.length).toBe(links.length + 1);
          for (let i = 0; i < links.length; i++) {
            expect(lines[i + 1]).toContain(links[i].url);
            expect(lines[i + 1].startsWith("- [ ] ")).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
