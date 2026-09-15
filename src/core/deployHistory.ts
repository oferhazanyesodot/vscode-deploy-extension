// Pure model for the deploy history log. Entries are appended after each profile
// deploy and capped to a maximum count (newest first).

export interface DeployHistoryRepoResult {
  repo: string;
  branch: string;
  conclusion?: string; // "success" | "failure" | "cancelled" | undefined (unknown)
  runUrl?: string;
}

export interface DeployHistoryEntry {
  profileName: string;
  environment: string;
  timestamp: string; // ISO string
  succeeded: number;
  failed: number;
  repos: DeployHistoryRepoResult[];
}

export const DEFAULT_HISTORY_CAP = 20;

// Prepend a new entry (newest first) and cap the list length.
export function addHistoryEntry(
  history: DeployHistoryEntry[],
  entry: DeployHistoryEntry,
  cap: number = DEFAULT_HISTORY_CAP
): DeployHistoryEntry[] {
  const next = [entry, ...history];
  return cap > 0 ? next.slice(0, cap) : next;
}

// Human-readable one-line label for a history entry.
export function historyLabel(entry: DeployHistoryEntry): string {
  return `${entry.profileName} â†’ ${entry.environment}`;
}

// Secondary description: counts + local time.
export function historyDescription(entry: DeployHistoryEntry): string {
  const when = new Date(entry.timestamp);
  const time = Number.isNaN(when.getTime()) ? entry.timestamp : when.toLocaleString();
  return `${entry.succeeded} ok, ${entry.failed} failed Â· ${time}`;
}

// Markdown summary for copying to standup/Slack.
export function historyMarkdown(entry: DeployHistoryEntry): string {
  const header = `### Deploy: ${entry.profileName} â†’ ${entry.environment}`;
  const meta = `_${entry.succeeded} succeeded, ${entry.failed} failed â€” ${entry.timestamp}_`;
  const rows = entry.repos.map((r) => {
    const status = r.conclusion === "success" ? "âœ…" : r.conclusion === "failure" ? "âŒ" : r.conclusion === "cancelled" ? "âšª" : "â–¶ï¸";
    const link = r.runUrl ? ` ([run](${r.runUrl}))` : "";
    return `- ${status} ${r.repo} @ ${r.branch}${link}`;
  });
  return [header, meta, ...rows].join("\n");
}
