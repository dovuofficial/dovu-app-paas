# deploy-ops GitHub Action — Design Spec

## Overview

A reusable GitHub Action (`uses: dovuofficial/deploy-ops@v1`) that deploys projects to a user's DigitalOcean droplet on push. Branch-aware routing gives `main`/`master` the clean domain and feature branches a namespaced subdomain. Auto-cleanup removes branch deployments when branches are deleted.

## Use Case

A user has a DigitalOcean droplet provisioned with deploy-ops. They add this action to any repo. On push, the project is automatically deployed (or redeployed). An AI agent creating a project can include the workflow YAML to get instant deployment with zero manual setup beyond the initial secrets.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | yes | — | Droplet IP address |
| `ssh-key` | yes | — | SSH private key (from GitHub secret) |
| `ssh-user` | no | `deploy` | SSH username on the droplet |
| `base-domain` | yes | — | Base domain, e.g. `apps.dovu.ai` |
| `app-name` | no | repo name | Override the app name |
| `env` | no | — | Multiline `KEY=VALUE` pairs for secret env vars |
| `cleanup` | no | `true` | Auto-destroy branch deployments on branch delete |

## Outputs

| Output | Description |
|--------|-------------|
| `url` | The deployed URL, e.g. `https://my-app.apps.dovu.ai` |
| `app-name` | The resolved app name used for the deployment |

## Domain Routing

Branch-aware subdomain assignment:

| Branch | App Name | Domain |
|--------|----------|--------|
| `main` or `master` | `{app-name}` | `{app-name}.{base-domain}` |
| `feature-auth` | `feature-auth-{app-name}` | `feature-auth-{app-name}.{base-domain}` |

Branch names are sanitized: lowercased, non-alphanumeric characters replaced with hyphens, leading/trailing hyphens stripped, truncated to keep the full subdomain under 63 characters.

## Event Handling

### Push event

Deploys the current code. If the app already exists in deploy-ops state, it redeploys (updates). If new, it creates a fresh deployment.

### Delete event (branch deletion)

If `cleanup` input is `true` (default), runs `dovu-app destroy {branch-app-name}` to remove the branch deployment and free resources.

## .env Safety Check

Before deploying, the action scans any `.env` file committed in the repo for patterns that look like real secrets:

- Lines matching common secret patterns: `*_KEY=`, `*_SECRET=`, `*_TOKEN=`, `*_PASSWORD=`, `DATABASE_URL=`, `PRIVATE_KEY=`
- Values that look like actual credentials (long alphanumeric strings, base64, key-formatted strings) rather than empty placeholders or example values

If detected, the action **fails** with a clear error message telling the user to:
1. Move secret values to GitHub Secrets
2. Pass them via the `env` action input
3. Keep only non-sensitive defaults or empty placeholders in `.env`

The `.env` file should be `.env.example`-style: safe to commit with placeholder or default values only.

## Internal Steps

The action runs on `ubuntu-latest` and executes:

1. **Install dependencies** — Install Bun, clone/install deploy-ops CLI
2. **Configure SSH** — Write `ssh-key` to a temp file, set `chmod 600`, add droplet host to `known_hosts` via `ssh-keyscan`
3. **Generate config** — Write `.dovu-app-paas/config.json` with digitalocean provider settings (host, ssh key path, user, base domain)
4. **Resolve app name** — Use `app-name` input if provided, otherwise derive from `github.event.repository.name`
5. **Resolve branch** — Determine branch from `github.ref`. Detect `main`/`master` as primary. Sanitize branch name for subdomain use.
6. **Compute domain** — Primary branch: `{app-name}.{base-domain}`. Other branches: `{branch}-{app-name}.{base-domain}`.
7. **Handle delete event** — If event is `delete` and `cleanup` is `true`, run `dovu-app destroy {app-name}` and exit.
8. **Scan .env** — Check for committed secrets. Fail if found.
9. **Merge env vars** — Combine `.env` file (non-sensitive defaults) with `env` input (secrets). Input overrides file.
10. **Deploy** — Run `dovu-app deploy --name {app-name} --domain {domain}` with `--env` flags for each secret env var.
11. **Set outputs** — Write deployed URL and app name to `$GITHUB_OUTPUT`.

## Example Workflow (User's Repo)

```yaml
name: Deploy
on:
  push:
    branches: ['**']
  delete:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dovuofficial/deploy-ops@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          ssh-key: ${{ secrets.DEPLOY_SSH_KEY }}
          base-domain: apps.dovu.ai
          env: |
            DB_URL=${{ secrets.DB_URL }}
            API_KEY=${{ secrets.API_KEY }}
```

Secrets (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`, etc.) configured once at the repo or org level.

## Minimal Workflow (Zero Optional Config)

```yaml
name: Deploy
on:
  push:
    branches: ['**']
  delete:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dovuofficial/deploy-ops@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          ssh-key: ${{ secrets.DEPLOY_SSH_KEY }}
          base-domain: apps.dovu.ai
```

## Action File Structure

```
.github/
  action.yml          # Action metadata, inputs, outputs
scripts/
  entrypoint.sh       # Main action logic (bash)
  env-check.sh        # .env secret scanning
```

The action is defined in the deploy-ops repo root so it can be referenced as `dovuofficial/deploy-ops@v1`. The `action.yml` uses `runs: composite` with bash steps.

## Out of Scope (v1)

- Wildcard domain configuration (future enhancement)
- Multiple droplet targets / load balancing
- Deployment previews with PR comments
- Rollback support
- Custom Dockerfile path override
- Health checks after deployment
- Slack/webhook notifications

These are all good future additions but not needed for the initial working version.
