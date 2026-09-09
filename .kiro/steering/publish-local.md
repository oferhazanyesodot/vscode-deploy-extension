---
inclusion: always
---

# Deploy extension: always publish-local after changes

This repository is a locally-installed VS Code / Kiro extension. The copy the user
actually uses is the packaged `.vsix` that has been installed into their editor(s) —
NOT the source in the working tree.

## Mandatory rule

After making ANY change to this extension (source, config, package.json, or
dependencies), you MUST run:

```bash
npm run publish-local
```

Do this as the final step of the change, after the code compiles and tests pass. This
command:

1. Builds the bundle (`npm run build`)
2. Packages a `.vsix` (`npm run package`)
3. Installs it with `--force` into every detected editor CLI (kiro, code, etc.)

If you skip it, the user's installed extension will NOT reflect your change and they
will (correctly) report that nothing happened.

## Verification

- Confirm the command exits 0 and reports "Updated N editor(s)".
- Remind the user to reload their editor window ("Reload Window") to activate the new
  version.
- If no editor CLI is found on PATH, tell the user so they can install manually with
  `code --install-extension <vsix>` / `kiro --install-extension <vsix>`.

## Do not

- Do not consider a change "done" until `npm run publish-local` has been run.
- Do not rely on F5 / the Extension Development Host for delivering changes to the
  user; that is for debugging only.