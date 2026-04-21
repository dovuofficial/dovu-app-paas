#!/usr/bin/env bash
#
# test-build-cache.sh
#
# SSH into the droplet and run three back-to-back `docker build` invocations
# with the same flags that src/engine/docker.ts uses. Validates that the
# BuildKit layer cache actually triggers CACHED lines on warm builds.
#
# Does NOT exercise the MCP pipeline — for that, use harness/perf-deploy.ts.
#
# Usage:
#   ./scripts/test-build-cache.sh <ssh-target>
#   ./scripts/test-build-cache.sh root@your-droplet.example.com
#
# The ssh-target can be any user@host the running shell already has SSH
# access to (agent key, ssh config alias, etc). No secrets are read from
# the repo.
#
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <ssh-target>" >&2
  echo "Example: $0 root@droplet-host.example.com" >&2
  exit 1
fi

SSH_TARGET="$1"
IMAGE="build-cache-probe"

echo "Running on: $SSH_TARGET"
echo

ssh -o ConnectTimeout=10 "$SSH_TARGET" bash -s <<REMOTE
set -e
cleanup() { docker rmi ${IMAGE}:a ${IMAGE}:b ${IMAGE}:c ${IMAGE}:latest 2>/dev/null || true; rm -rf /tmp/build-cache-probe; }
trap cleanup EXIT

rm -rf /tmp/build-cache-probe
mkdir -p /tmp/build-cache-probe
cat > /tmp/build-cache-probe/package.json <<'JSON'
{"name":"probe","scripts":{"start":"node index.js"}}
JSON
cat > /tmp/build-cache-probe/index.js <<'JS'
console.log("v1");
JS
cat > /tmp/build-cache-probe/Dockerfile <<'DF'
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* ./
RUN npm install --production 2>/dev/null || true
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
DF

docker rmi ${IMAGE}:a ${IMAGE}:b ${IMAGE}:c ${IMAGE}:latest 2>/dev/null || true

run_build() {
  local tag=\$1
  DOCKER_BUILDKIT=1 docker build \\
    --cache-from ${IMAGE}:latest \\
    --build-arg BUILDKIT_INLINE_CACHE=1 \\
    -t ${IMAGE}:\$tag \\
    -t ${IMAGE}:latest \\
    /tmp/build-cache-probe 2>&1 |
    grep -E "^#[0-9]+ (\[|DONE|CACHED|naming)" | head -20
}

echo "=== BUILD 1 (cold — no :latest exists yet) ==="
time run_build a

echo
echo "=== BUILD 2 (warm, identical source — every layer should CACHE) ==="
time run_build b

echo
echo "=== BUILD 3 (warm, index.js edited — deps layers CACHE, only COPY . . rebuilds) ==="
echo 'console.log("v2");' > /tmp/build-cache-probe/index.js
time run_build c
REMOTE

echo
echo "Done."
