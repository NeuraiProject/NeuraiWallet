#!/bin/sh
# Runs host.e2e.ts in the Playwright Docker image (Chromium) against testnet.
#   privacy-host/e2e/run.sh /path/to/privacy-c6-artifacts [work-dir]
# The artifacts are the 18 pinned C6 XNA files (as installed for the web wallet).
# Build the host first: npm run privacy:host
set -e
REPO=$(cd "$(dirname "$0")/../.." && pwd)
ARTIFACTS=$(cd "$1" && pwd)
WORK=${2:-$(mktemp -d)}
mkdir -p "$WORK"
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/work -e PRIVACY_ARTIFACTS=/artifacts \
  -e PRIVACY_HOST_HTML=/app/privacy-host/dist/privacy-host.html \
  -v "$REPO":/app:ro -v "$ARTIFACTS":/artifacts:ro -v "$WORK":/work -w /work \
  mcr.microsoft.com/playwright:v1.58.2-noble sh -c '
    [ -d node_modules/playwright-core ] || npm i --no-audit --no-fund playwright-core@1.58.2 esbuild@0.28.2 >/dev/null
    npx esbuild /app/privacy-host/e2e/host.e2e.ts --bundle --platform=node --format=esm \
      --outfile=/work/host.e2e.mjs --external:playwright-core --log-level=warning
    node /work/host.e2e.mjs'
