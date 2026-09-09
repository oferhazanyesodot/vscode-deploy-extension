// Build the argument array for `gh workflow run`.
// Never interpolates values into a shell string; each value is a discrete element.
export function buildRunArgs(
  workflow: string,
  ref: string,
  fields: Record<string, string>
): string[] {
  const args: string[] = ["workflow", "run", workflow, "--ref", ref];
  for (const [key, value] of Object.entries(fields)) {
    args.push("--field", `${key}=${value}`);
  }
  return args;
}
