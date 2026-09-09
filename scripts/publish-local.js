// Bump patch version, build, package, and install into all detected editors.
// Usage: npm run publish-local
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// 1. Bump patch version in package.json.
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map((n) => parseInt(n, 10));
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Version bumped to ${newVersion}`);

const vsixName = `${pkg.name}-${newVersion}.vsix`;
const vsixPath = path.join(root, vsixName);

// 2. Build + package (package picks up the new version).
run("npm run build");
run("npm run package");

if (!fs.existsSync(vsixPath)) {
  console.error(`Package not found: ${vsixPath}`);
  process.exit(1);
}

// 3. Install into any editor CLI that exists on PATH.
const editors = ["kiro", "code", "code-insiders", "cursor", "windsurf"];
let installed = 0;
for (const editor of editors) {
  const found = spawnSync(process.platform === "win32" ? "where" : "which", [editor], {
    encoding: "utf8",
  });
  if (found.status !== 0) {
    continue;
  }
  console.log(`Installing into ${editor}...`);
  const res = spawnSync(editor, ["--install-extension", vsixPath, "--force"], {
    stdio: "inherit",
    shell: true,
  });
  if (res.status === 0) {
    installed++;
  } else {
    console.warn(`  (${editor} install returned ${res.status})`);
  }
}

// 4. Clean up old vsix files, keep only the current one.
for (const f of fs.readdirSync(root)) {
  if (f.endsWith(".vsix") && f !== vsixName) {
    try {
      fs.unlinkSync(path.join(root, f));
    } catch {
      /* ignore */
    }
  }
}

if (installed === 0) {
  console.warn("No editors were updated. Is a VS Code-family CLI on your PATH?");
} else {
  console.log(`\nDone. Installed v${newVersion} into ${installed} editor(s). Reload the window to activate.`);
}