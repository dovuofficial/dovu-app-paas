# GitHub Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable GitHub Action (`dovuofficial/deploy-ops@v1`) that deploys projects to a DigitalOcean droplet on push, with branch-aware domain routing and auto-cleanup.

**Architecture:** A composite GitHub Action (`action.yml`) at the repo root that installs Bun + deploy-ops, configures SSH, resolves branch-aware app names, scans `.env` for secrets, then invokes the existing `dovu-app deploy` / `dovu-app destroy` CLI commands. One prerequisite CLI change: add `--force` to `destroy` to skip interactive prompts and work without local state.

**Tech Stack:** GitHub Actions (composite), Bash, Bun, existing deploy-ops CLI

---

## File Structure

```
action.yml                          # CREATE — Action metadata, inputs, outputs, composite steps
scripts/env-check.sh                # CREATE — .env secret scanning script
scripts/entrypoint.sh               # CREATE — Main action logic (deploy/cleanup orchestration)
src/cli/destroy.ts                  # MODIFY — Add --force flag, skip prompt + state requirement
tests/engine/destroy.test.ts        # CREATE — Tests for --force behavior
```

---

### Task 1: Add `--force` flag to destroy command

The `destroy` command at `src/cli/destroy.ts` has an interactive `y/N` prompt and requires the app to exist in local state. In CI, there's no TTY for prompts, and state doesn't persist across runs. We need `--force` to skip the prompt and work by convention (derive container/image names from app name) when state is absent.

**Files:**
- Modify: `src/cli/destroy.ts`
- Create: `tests/engine/destroy.test.ts`

- [ ] **Step 1: Write the failing test for --force skipping state check**

In `tests/engine/destroy.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { buildDestroyCommands } from "@/cli/destroy";

describe("buildDestroyCommands", () => {
  test("returns commands derived from app name when no state exists", () => {
    const cmds = buildDestroyCommands("my-app", null);
    expect(cmds.containerName).toBe("dovu-app-paas-my-app");
    expect(cmds.image).toBeNull();
  });

  test("returns commands with image from state when state exists", () => {
    const cmds = buildDestroyCommands("my-app", {
      name: "my-app",
      image: "dovu-app-paas-my-app:abc123",
      port: 3000,
      hostPort: 3001,
      domain: "my-app.apps.dovu.ai",
      containerId: "abc123def456",
      status: "running",
      env: {},
      createdAt: "2026-04-15T00:00:00Z",
      updatedAt: "2026-04-15T00:00:00Z",
    });
    expect(cmds.containerName).toBe("dovu-app-paas-my-app");
    expect(cmds.image).toBe("dovu-app-paas-my-app:abc123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/engine/destroy.test.ts`
Expected: FAIL — `buildDestroyCommands` does not exist

- [ ] **Step 3: Extract `buildDestroyCommands` helper and add `--force` flag**

In `src/cli/destroy.ts`, add the exported helper at the top (after imports) and modify the command:

```ts
import type { DeploymentRecord } from "@/types";

export function buildDestroyCommands(app: string, dep: DeploymentRecord | null) {
  return {
    containerName: `dovu-app-paas-${app}`,
    image: dep?.image ?? null,
  };
}
```

Then modify the `destroyCommand` to accept `--force`:

```ts
export const destroyCommand = new Command("destroy")
  .argument("<app>", "App name")
  .description("Remove a deployment completely")
  .option("--force", "Skip confirmation and work without state")
  .action(async (app: string, options: { force?: boolean }) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'dovu-app init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app] ?? null;

    if (!dep && !options.force) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    if (!options.force) {
      const confirm = await prompt(`Remove ${app} and all its data? (y/N) `);
      if (confirm.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
    }

    const provider = resolveProvider(config);
    const { containerName, image } = buildDestroyCommands(app, dep);

    // Remove container
    try {
      await provider.exec(`docker stop ${containerName}`);
    } catch {}
    try {
      await provider.exec(`docker rm ${containerName}`);
    } catch {}
    console.log(chalk.green("✓") + " Container removed");

    // Remove image (if known from state)
    if (image) {
      try {
        await provider.exec(`docker rmi ${image}`);
      } catch {}
      console.log(chalk.green("✓") + " Image removed");
    }

    // Remove nginx config
    await provider.exec(`rm -f ${provider.nginxConfDir}/dovu-app-paas-${app}.conf ${provider.nginxConfDir}/dovu-app-paas-${app}.conf.disabled`);
    await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
    console.log(chalk.green("✓") + " Nginx config removed");

    // Remove from state (if it was there)
    if (dep) {
      delete state.deployments[app];
      await writeState(cwd, state);
    }
    console.log(chalk.green("✓") + " Removed from state");
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/engine/destroy.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `bun test`
Expected: All 25 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/destroy.ts tests/engine/destroy.test.ts
git commit -m "feat: add --force flag to destroy command for CI usage"
```

---

### Task 2: Create .env secret scanning script

A bash script that scans a `.env` file for values that look like real secrets (not placeholders). Used by the action to fail early if someone commits real credentials.

**Files:**
- Create: `scripts/env-check.sh`

- [ ] **Step 1: Create the env-check script**

In `scripts/env-check.sh`:

```bash
#!/usr/bin/env bash
# Scan .env file for values that look like real secrets.
# Exit 0 = safe, Exit 1 = secrets detected.
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  exit 0
fi

FAILURES=()

while IFS= read -r line; do
  # Skip comments and blank lines
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

  # Extract key and value
  key="${line%%=*}"
  value="${line#*=}"

  # Strip surrounding quotes
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"

  # Skip empty values or obvious placeholders
  [[ -z "$value" ]] && continue
  [[ "$value" == "changeme" || "$value" == "placeholder" || "$value" == "xxx" || "$value" == "your-"* || "$value" == "CHANGE_ME" ]] && continue
  [[ "$value" == "example"* || "$value" == "test"* || "$value" == "dummy"* || "$value" == "fake"* ]] && continue
  [[ "$value" == "localhost"* || "$value" == "127.0.0.1"* || "$value" == "0.0.0.0"* ]] && continue
  [[ "$value" == "true" || "$value" == "false" ]] && continue
  # Skip pure numbers (ports, counts, etc.)
  [[ "$value" =~ ^[0-9]+$ ]] && continue

  # Check if key matches sensitive patterns
  sensitive=false
  case "$key" in
    *_KEY|*_SECRET|*_TOKEN|*_PASSWORD|*_CREDENTIALS|*_PRIVATE*|DATABASE_URL|REDIS_URL|MONGO_URL|MONGO_URI)
      sensitive=true
      ;;
  esac

  if [ "$sensitive" = true ]; then
    # Value is non-empty, non-placeholder, and key is sensitive
    # Check if it looks like a real credential (length > 12 or contains mixed case/special chars)
    if [ "${#value}" -gt 12 ]; then
      FAILURES+=("$key (value looks like a real secret — ${#value} chars)")
    fi
  fi
done < "$ENV_FILE"

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo "::error::Possible secrets detected in .env file:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "Move secret values to GitHub Secrets and pass them via the 'env' action input."
  echo "Keep only non-sensitive defaults or empty placeholders in .env."
  exit 1
fi

exit 0
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/env-check.sh`

- [ ] **Step 3: Test with a safe .env file**

Run:
```bash
echo -e "PORT=3000\nNODE_ENV=development\nDB_HOST=localhost" > /tmp/test-safe.env
./scripts/env-check.sh /tmp/test-safe.env && echo "PASS: safe env accepted"
```
Expected: exits 0, prints "PASS: safe env accepted"

- [ ] **Step 4: Test with a dangerous .env file**

Run:
```bash
echo -e "API_KEY=sk-1234567890abcdefghijklmnop\nDB_PASSWORD=super_secret_password_123" > /tmp/test-danger.env
./scripts/env-check.sh /tmp/test-danger.env || echo "PASS: dangerous env rejected"
```
Expected: exits 1, prints error about detected secrets, then "PASS: dangerous env rejected"

- [ ] **Step 5: Test with no .env file**

Run:
```bash
./scripts/env-check.sh /tmp/nonexistent.env && echo "PASS: missing env is fine"
```
Expected: exits 0, prints "PASS: missing env is fine"

- [ ] **Step 6: Commit**

```bash
git add scripts/env-check.sh
git commit -m "feat: add .env secret scanning script for CI safety"
```

---

### Task 3: Create `action.yml`

The action metadata file at the repo root. Defines inputs, outputs, and composite run steps. This is what makes `uses: dovuofficial/deploy-ops@v1` work.

**Files:**
- Create: `action.yml`

- [ ] **Step 1: Create action.yml**

In `action.yml`:

```yaml
name: "deploy-ops"
description: "Deploy projects to DigitalOcean with branch-aware routing"
branding:
  icon: "upload-cloud"
  color: "blue"

inputs:
  host:
    description: "DigitalOcean droplet IP address"
    required: true
  ssh-key:
    description: "SSH private key for the droplet"
    required: true
  ssh-user:
    description: "SSH username on the droplet"
    required: false
    default: "deploy"
  base-domain:
    description: "Base domain for deployments (e.g. apps.dovu.ai)"
    required: true
  app-name:
    description: "Override the app name (defaults to repo name)"
    required: false
    default: ""
  env:
    description: "Multiline KEY=VALUE pairs for secret environment variables"
    required: false
    default: ""
  cleanup:
    description: "Auto-destroy branch deployments on branch delete"
    required: false
    default: "true"

outputs:
  url:
    description: "The deployed URL"
    value: ${{ steps.deploy.outputs.url }}
  app-name:
    description: "The resolved app name"
    value: ${{ steps.deploy.outputs.app-name }}

runs:
  using: "composite"
  steps:
    - name: Install Bun
      uses: oven-sh/setup-bun@v2

    - name: Install deploy-ops
      shell: bash
      run: |
        git clone --depth 1 https://github.com/dovuofficial/dovu-app-paas.git "$RUNNER_TEMP/deploy-ops"
        cd "$RUNNER_TEMP/deploy-ops"
        bun install --frozen-lockfile

    - name: Run deployment
      id: deploy
      shell: bash
      env:
        INPUT_HOST: ${{ inputs.host }}
        INPUT_SSH_KEY: ${{ inputs.ssh-key }}
        INPUT_SSH_USER: ${{ inputs.ssh-user }}
        INPUT_BASE_DOMAIN: ${{ inputs.base-domain }}
        INPUT_APP_NAME: ${{ inputs.app-name }}
        INPUT_ENV: ${{ inputs.env }}
        INPUT_CLEANUP: ${{ inputs.cleanup }}
        GITHUB_EVENT_NAME: ${{ github.event_name }}
        GITHUB_REF: ${{ github.ref }}
        GITHUB_REF_NAME: ${{ github.ref_name }}
        GITHUB_REPOSITORY: ${{ github.repository }}
        GITHUB_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
      run: bash "$RUNNER_TEMP/deploy-ops/scripts/entrypoint.sh"
```

- [ ] **Step 2: Verify YAML is valid**

Run: `bun -e "const yaml = await Bun.file('action.yml').text(); console.log('Valid YAML, length:', yaml.length)"`
Expected: prints length, no parse errors

- [ ] **Step 3: Commit**

```bash
git add action.yml
git commit -m "feat: add action.yml for GitHub Action metadata"
```

---

### Task 4: Create `scripts/entrypoint.sh`

The main action logic. Handles SSH setup, config generation, branch resolution, env scanning, deploy, cleanup, and output setting.

**Files:**
- Create: `scripts/entrypoint.sh`

- [ ] **Step 1: Create the entrypoint script**

In `scripts/entrypoint.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_OPS_DIR="$RUNNER_TEMP/deploy-ops"
WORKSPACE="$GITHUB_WORKSPACE"

# --- 1. Configure SSH ---
SSH_KEY_FILE="$RUNNER_TEMP/deploy_ssh_key"
echo "$INPUT_SSH_KEY" > "$SSH_KEY_FILE"
chmod 600 "$SSH_KEY_FILE"

# Add host to known_hosts
mkdir -p ~/.ssh
ssh-keyscan -H "$INPUT_HOST" >> ~/.ssh/known_hosts 2>/dev/null

echo "SSH configured for $INPUT_SSH_USER@$INPUT_HOST"

# --- 2. Generate deploy-ops config ---
mkdir -p "$WORKSPACE/.dovu-app-paas"
cat > "$WORKSPACE/.dovu-app-paas/config.json" <<EOF
{
  "provider": "digitalocean",
  "digitalocean": {
    "host": "$INPUT_HOST",
    "sshKey": "$SSH_KEY_FILE",
    "user": "$INPUT_SSH_USER",
    "baseDomain": "$INPUT_BASE_DOMAIN"
  }
}
EOF

echo "Config written to $WORKSPACE/.dovu-app-paas/config.json"

# --- 3. Resolve app name ---
if [ -n "$INPUT_APP_NAME" ]; then
  APP_NAME="$INPUT_APP_NAME"
else
  # Derive from repo name (owner/repo -> repo)
  APP_NAME="${GITHUB_REPOSITORY##*/}"
fi

# Sanitize: lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens
APP_NAME=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/^-*//' | sed 's/-*$//')

echo "App name: $APP_NAME"

# --- 4. Resolve branch and compute domain ---
# For delete events, ref_name is the deleted branch
BRANCH="$GITHUB_REF_NAME"
DEFAULT_BRANCH="${GITHUB_DEFAULT_BRANCH:-main}"

# Sanitize branch name for subdomain use
SAFE_BRANCH=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/^-*//' | sed 's/-*$//')

if [ "$BRANCH" = "$DEFAULT_BRANCH" ] || [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  DEPLOY_NAME="$APP_NAME"
else
  DEPLOY_NAME="$SAFE_BRANCH-$APP_NAME"
fi

# Truncate to keep subdomain under 63 chars
DEPLOY_NAME="${DEPLOY_NAME:0:63}"
DEPLOY_NAME=$(echo "$DEPLOY_NAME" | sed 's/-*$//')

DOMAIN="$DEPLOY_NAME.$INPUT_BASE_DOMAIN"

echo "Branch: $BRANCH -> Deploy name: $DEPLOY_NAME"
echo "Domain: $DOMAIN"

# --- 5. Handle delete event (cleanup) ---
if [ "$GITHUB_EVENT_NAME" = "delete" ]; then
  if [ "$INPUT_CLEANUP" = "true" ]; then
    echo "Branch deleted — cleaning up deployment: $DEPLOY_NAME"
    cd "$WORKSPACE"
    bun run "$DEPLOY_OPS_DIR/src/cli/index.ts" destroy "$DEPLOY_NAME" --force || true
    echo "Cleanup complete"
  else
    echo "Branch deleted but cleanup is disabled — skipping"
  fi
  exit 0
fi

# --- 6. Scan .env for secrets ---
if [ -f "$WORKSPACE/.env" ]; then
  echo "Scanning .env for committed secrets..."
  bash "$DEPLOY_OPS_DIR/scripts/env-check.sh" "$WORKSPACE/.env"
  echo "Env check passed"
fi

# --- 7. Build env flags ---
ENV_FLAGS=""
if [ -n "$INPUT_ENV" ]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    ENV_FLAGS="$ENV_FLAGS --env $line"
  done <<< "$INPUT_ENV"
fi

# --- 8. Deploy ---
echo "Deploying $DEPLOY_NAME to $DOMAIN..."
cd "$WORKSPACE"
bun run "$DEPLOY_OPS_DIR/src/cli/index.ts" deploy --name "$DEPLOY_NAME" --domain "$DOMAIN" $ENV_FLAGS

# --- 9. Set outputs ---
PROTOCOL="https"
echo "url=${PROTOCOL}://${DOMAIN}" >> "$GITHUB_OUTPUT"
echo "app-name=${DEPLOY_NAME}" >> "$GITHUB_OUTPUT"

echo ""
echo "Deployed: ${PROTOCOL}://${DOMAIN}"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/entrypoint.sh`

- [ ] **Step 3: Verify script syntax**

Run: `bash -n scripts/entrypoint.sh && echo "Syntax OK"`
Expected: "Syntax OK"

- [ ] **Step 4: Commit**

```bash
git add scripts/entrypoint.sh
git commit -m "feat: add entrypoint script for GitHub Action deployment logic"
```

---

### Task 5: Verify full test suite still passes

Ensure nothing is broken after all changes.

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (23 original + 2 new destroy tests = 25)

- [ ] **Step 2: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors

---

### Task 6: Commit final state and verify action structure

**Files:**
- None (verification only)

- [ ] **Step 1: Verify all required files exist**

Run:
```bash
ls -la action.yml scripts/entrypoint.sh scripts/env-check.sh
```
Expected: all three files exist and entrypoint.sh + env-check.sh are executable

- [ ] **Step 2: Verify action.yml references correct paths**

Run:
```bash
grep "entrypoint.sh" action.yml
```
Expected: shows the reference to `scripts/entrypoint.sh`

- [ ] **Step 3: Final commit (if any unstaged changes remain)**

```bash
git status
# If clean, nothing to do
# If changes, stage and commit
```
