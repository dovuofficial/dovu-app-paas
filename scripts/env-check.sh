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
