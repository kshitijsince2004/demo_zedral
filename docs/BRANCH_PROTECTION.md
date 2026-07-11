# Branch protection checklist (main)

Apply in GitHub → Settings → Branches → Add rule for `main`:

- [ ] Require a pull request before merging
- [ ] Require approvals (recommended: 1+)
- [ ] Require status checks to pass:
  - `Lint · Typecheck · Test · Security`
  - `Docker build validation`
- [ ] Require branches to be up to date before merging
- [ ] Do not allow bypassing the above settings
- [ ] Restrict force pushes
- [ ] Restrict deletions

Allowed branch patterns for work: `feature/*`, `hotfix/*`.
