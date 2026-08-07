# Branch protection (`main`)

Required after Pipeline Reliability Phase 5:

1. Settings → Branches → `main` → Protect
2. Require a pull request before merging (linear history / rebase merge preferred)
3. Require status checks to pass:
   - `Lint`
   - `Build · typecheck · client`
   - `Server unit`
   - `Migrate · integration`
   - `Architecture`
   - `Docker build (PR)` (or the main `Docker build · Trivy · Push GHCR` when applicable)
   - `Secrets (gitleaks)`
4. Do not allow bypass for admins in normal flow

Apply via `gh` (needs admin):

```bash
gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks='{"strict":true,"contexts":["Lint","Build · typecheck · client","Server unit","Migrate · integration","Architecture","Docker build (PR)","Secrets (gitleaks)"]}' \
  -F enforce_admins=true \
  -F required_pull_request_reviews='{"required_approving_review_count":1}' \
  -F restrictions=null
```

## Long-lived branches

Collapse or delete `update` and `hsl_zedral_CTL` / `RW` / `Q` once merged — short-lived feature branches only. Divergent long-lived branches amplify CRLF churn and migration timestamp collisions.
