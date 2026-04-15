#!/usr/bin/env bash
set -euo pipefail

# DEPLOY_OPS_DIR is set by action.yml via github.action_path
DEPLOY_OPS_DIR="${DEPLOY_OPS_DIR:?DEPLOY_OPS_DIR must be set}"
WORKSPACE="$GITHUB_WORKSPACE"

# --- 0. Validate required inputs ---
errors=()
[ -z "${INPUT_HOST:-}" ] && errors+=("'host' is required but not set")
[ -z "${INPUT_SSH_KEY:-}" ] && errors+=("'ssh-key' is required but not set — add DEPLOY_SSH_KEY to your repo/org secrets")
[ -z "${INPUT_BASE_DOMAIN:-}" ] && errors+=("'base-domain' is required but not set")
[ -z "${INPUT_SSH_USER:-}" ] && INPUT_SSH_USER="deploy"
[ -z "${GITHUB_REPOSITORY:-}" ] && errors+=("GITHUB_REPOSITORY is not set — are you running this outside GitHub Actions?")

if [ ${#errors[@]} -gt 0 ]; then
  echo "::error::deploy-ops: missing required configuration:"
  for e in "${errors[@]}"; do
    echo "  - $e"
  done
  exit 1
fi

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
