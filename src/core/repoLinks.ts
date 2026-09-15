// Pure helpers for building GitHub web links from a repository's base URL.
// The base URL is whatever `gh repo view --json url` returns, e.g.
// "https://github.com/org/repo". These functions never perform I/O.

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// Link to a specific branch's tree view on GitHub.
export function branchUrl(repoUrl: string, branch: string): string {
  const base = trimTrailingSlash(repoUrl);
  return `${base}/tree/${encodeURIComponent(branch)}`;
}

// Link to the "open a pull request" compare page from head -> base on GitHub.
// GitHub's compare URL format is /compare/{base}...{head}?expand=1
export function comparePrUrl(repoUrl: string, base: string, head: string): string {
  const root = trimTrailingSlash(repoUrl);
  return `${root}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
}

export interface ProfileBranchLink {
  repo: string;
  branch: string;
  url: string;
}

// Build a newline-joined list of branch URLs for copying.
export function branchLinksText(links: ProfileBranchLink[]): string {
  return links.map((l) => l.url).join("\n");
}

// Build a Markdown checklist of the profile's repos + branch links.
export function branchLinksMarkdown(profileName: string, links: ProfileBranchLink[]): string {
  const header = `### Profile: ${profileName}`;
  const rows = links.map((l) => `- [ ] [${l.repo} @ ${l.branch}](${l.url})`);
  return [header, ...rows].join("\n");
}
