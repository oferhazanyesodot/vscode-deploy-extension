# VS Code Deploy Extension

Trigger GitHub Actions deploy workflows for your repositories from inside VS Code,
via the GitHub CLI (`gh`). No more clicking through the GitHub website.

## What it does

- **Deploy command + status bar button** (`Deploy: Run Deployment`).
- **Multi-repo aware**: in a multi-root workspace it preselects the repo of the active
  file and lets you pick another; a single-repo workspace skips the picker.
- **Workflow resolution**: uses a configurable repo -> workflow map, and falls back to
  auto-discovery via `gh workflow list`.
- **Environment gating**:
  - `dev` deploys immediately.
  - `preprod` asks for an in-editor confirmation.
  - `prod` dispatches and relies on your GitHub Environment protection rules (required
    reviewers). The extension surfaces the "waiting for approval" state; it never
    approves on your behalf.
- **Pre-flight checks**: warns on uncommitted changes (staged/unstaged/untracked), and
  verifies `gh` is installed and authenticated.
- **Extra inputs**: prompts for any additional `workflow_dispatch` inputs a workflow
  declares (for example boolean toggles like `deploy_api` / `deploy_workers`).
- **Live progress + notifications**: polls the run and shows a progress indicator with
  job counts, then a success / failure (with run link) / cancelled notification.

## Requirements

- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`).
- `git` on PATH.

## Settings

- `deploy.workflowMapping` — object mapping a repository folder name to a deploy
  workflow file name or id. Example (replace with your own repo/workflow names):
  ```json
  {
    "deploy.workflowMapping": {
      "my-service": "deploy.yaml",
      "another-service": "deploy-service.yaml"
    }
  }
  ```
- `deploy.pinnedWorkflows` — object mapping a repository folder name to an ordered list
  of workflow file names or ids to show first in the picker. Example:
  ```json
  {
    "deploy.pinnedWorkflows": {
      "my-service": ["deploy.yaml", "deploy-extras.yaml"]
    }
  }
  ```
- `deploy.pollIntervalSeconds` — interval between run-status polls (default 5, min 2).

## Development

```bash
npm install
npm test        # vitest (unit + property tests via fast-check)
npm run typecheck
npm run build   # bundles to dist/extension.js via esbuild
```

Press F5 in VS Code to launch an Extension Development Host (for iterative debugging
only).

## Installing / Updating the installed extension

This extension is installed locally (not from a marketplace). To bump the version,
build, package a `.vsix`, and install it into every detected editor (Kiro, VS Code,
Cursor, Windsurf), run:

```bash
npm run publish-local
```

It installs with `--force` into any VS Code-family CLI found on your PATH and removes
older `.vsix` files. After it finishes, reload the editor window
(`Ctrl+Shift+P` -> "Reload Window") to activate the new version.

> **IMPORTANT (for humans and AI agents):** After making ANY change to this
> extension's source, you MUST run `npm run publish-local` so the change is actually
> installed and usable. Editing the source alone does nothing to the installed
> extension — the installed copy is the packaged `.vsix`, not the working tree.

## Installing for other people (teammates)

The extension is distributed as a `.vsix` via this repository's GitHub Releases page
(it is not on a marketplace). Each teammate:

1. Downloads the latest `.vsix` from the Releases page of this repository.
2. Installs it, either:
   - CLI: `code --install-extension <file>.vsix` (or `kiro --install-extension ...`), or
   - In the editor: Extensions panel -> `...` menu -> "Install from VSIX..." -> pick
     the file.
3. Reloads the editor window.

### Prerequisites for each teammate

- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`),
  with access to the repositories they intend to deploy.
- `git` on PATH.
- Their own `deploy.workflowMapping` / `deploy.pinnedWorkflows` settings (or a
  workspace that already contains them).

### Cutting a new release (maintainer)

```bash
npm run publish-local   # bumps version, builds, packages, installs locally
git commit -am "..." && git push
npm run release         # creates the GitHub Release and uploads the .vsix
```

## Architecture

A single orchestrator (`DeployCommandHandler`) drives a linear deploy flow backed by
focused services. All `gh` / `git` calls go through one `ProcessRunner` using `spawn`
with argument arrays and `shell: false` (injection-safe, cross-platform). The decision
logic (repo/workflow resolution, gating, git-status parsing, input parsing, run
classification, run identification) is pure and covered by property-based tests.