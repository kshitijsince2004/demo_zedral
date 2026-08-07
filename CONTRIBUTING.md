# Contributing

## Before you push

CI is expensive and OneDrive/Windows lockfiles hide Linux-only failures. Treat local green as the gate:

1. Prefer a **non-OneDrive** checkout (`C:\dev\…` or **WSL2 Ubuntu**) so `npm ci` / tests are not blocked by EBUSY locks.
2. Set once per machine: `git config --global core.autocrlf false` (line endings are LF via `.gitattributes`).
3. Run the CI quality mirror (Docker Desktop required):

   ```bash
   bash scripts/run-ci-quality-local.sh
   ```

4. Only push when that script exits 0 (or you intentionally skip and accept a likely red CI).

## npm version

This repo requires **npm ≥ 11.3** so cross-OS optional natives stay in the lockfile (see `packageManager` in root `package.json`). CI and the Dockerfile install `npm@11.4.2` from that single pin — do not invent a second version elsewhere.

## Lockfile

Regenerate `package-lock.json` on **Linux** (WSL2 or `node:20` container), not on Windows, so Linux optional bindings are native to the lockfile.
