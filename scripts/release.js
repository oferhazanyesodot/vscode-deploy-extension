// Create a GitHub release for the current version and upload the packaged .vsix.
// Assumes `npm run publish-local` (or `npm run package`) has produced the vsix.
// Usage: npm run release
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const version = pkg.version;
const vsix = path.join(root, `${pkg.name}-${version}.vsix`);

if (!fs.existsSync(vsix)) {
  console.error(`No .vsix found for v${version}. Run "npm run package" or "npm run publish-local" first.`);
  process.exit(1);
}

const notes = [
  `VS Code / Kiro deploy extension v${version}.`,
  "",
  "Install: download the .vsix below, then either run",
  "`code --install-extension <file>` (or `kiro --install-extension <file>`),",
  "or use the Extensions panel -> ... -> \"Install from VSIX...\".",
  "",
  "Requires the GitHub CLI (gh) installed and authenticated (`gh auth login`).",
].join("\n");

const res = spawnSync(
  "gh",
  ["release", "create", `v${version}`, vsix, "--title", `v${version}`, "--notes", notes],
  { cwd: root, stdio: "inherit", shell: true }
);
process.exit(res.status ?? 1);