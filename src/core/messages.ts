// Pure notification message builders (no vscode import) for testability.
export function successMessage(repo: string, env: string): string {
  return `Deployment succeeded: ${repo} to ${env}.`;
}
export function failureMessage(repo: string, env: string, runUrl: string): string {
  return `Deployment failed: ${repo} to ${env}. View run: ${runUrl}`;
}
export function cancelledMessage(repo: string, env: string): string {
  return `Deployment cancelled: ${repo} to ${env}.`;
}