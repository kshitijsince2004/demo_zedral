# GitHub Actions Architecture & Audit

## Architecture Overview
- CI runs on GitHub-hosted `ubuntu-latest`: lint → build → client tests → operator bundle → migrate → server unit + integration → arch check → (report-only) npm audit; then `docker-build-push` (only on push to `main`) builds `backend`+`nginx`, Trivy-scans both, pushes to **GHCR** tagged `SHA` + `latest-main`.
- Deploy is **pull-only** on **self-hosted runners that live on each server**:
  - `deploy-aws.yml` → runner label `aws-qa`, env `staging`; auto after CI on `main`, or manual.
  - `deploy-production.yml` → runner label `factory`, env `production`; manual only.
- Deploy steps run **locally on the box** (no SSH): GHCR login → local `rsync` of `deploy/` into `APP_DIR` (preserving `.env`) → `remote-ghcr-deploy.sh` (compose up + migrate; backup+verify on prod) → local `/health` retries → `rollback-images.sh` on failure.

## Secrets & Environments

### `staging`
- `AWS_APP_DIR` (default `/opt/zedralv2`)
- `AWS_PUBLIC_URL`
- `SMOKE_BADGE_ID`
- `SMOKE_PIN`
- `DEPLOY_WEBHOOK_URL`

### `production`
- `FACTORY_APP_DIR` (default `/opt/zedralv2`)
- `FACTORY_PUBLIC_URL`
- `SMOKE_BADGE_ID`
- `SMOKE_PIN`
- `DEPLOY_WEBHOOK_URL`

*(SSH secrets, `vm-deploy.sh`, `SKIP_GIT_SYNC`, `AWS_GIT_DEPLOY_TOKEN`, `GITHUB_REPO`, and single `zedral` runner labels have been fully retired).*

## Runner Setup
Register one runner per box with `deploy/setup-github-runner.sh`.
```bash
# AWS QA
export RUNNER_TOKEN='...'
export RUNNER_ENV=aws-qa
bash /opt/zedralv2/deploy/setup-github-runner.sh

# Factory
export RUNNER_TOKEN='...'
export RUNNER_ENV=factory
bash /opt/zedralv2/deploy/setup-github-runner.sh
```
