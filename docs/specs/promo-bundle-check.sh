#!/usr/bin/env bash
# Acceptance check for the .mcpb bundles of docs/specs/promo-mcp.md.
# Builds them with the repository's own scripts/build-mcpb.sh, then for every
# expected bundle checks structure and version (promo_check.py bundle), runs the
# official validator (mcpb validate, pinned CLI) and, for bundles this host can
# run, starts the bundle from its own mcp_config and compares the tools it lists
# with the ones its manifest declares. Exit 0 only when everything passed.
# Written by the task author; the executor does not edit it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHECK=docs/specs/promo_check.py
MCPB_CLI=@anthropic-ai/mcpb@2.1.2
NODE_IMAGE=node:24.21.0-slim
UV_IMAGE=ghcr.io/astral-sh/uv:0.12.23-python3.14-trixie-slim
OUT=dist-mcpb
NPM_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/promo-mcpb-npm"
mkdir -p "$NPM_CACHE"
MAX_MB=20
VERSION=$(python3 -c 'import json; print(json.load(open("packages/yandex-search-mcp/package.json"))["version"])')
for p in search wordstat webmaster metrika direct; do
  v=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "packages/yandex-$p-mcp/package.json")
  [ "$v" = "$VERSION" ] || { echo "FAIL: packages disagree on version ($p: $v, search: $VERSION)"; exit 1; }
done
SERVER_TYPE=node
PRIVACY=--require-privacy
BUNDLES=()
for p in search wordstat webmaster metrika direct; do BUNDLES+=("yandex-$p-mcp-$VERSION.mcpb"); done
build() { bash scripts/build-mcpb.sh; }
e2e() {
  for p in search wordstat webmaster metrika direct; do
    python3 "$CHECK" e2e --dir "$1/yandex-$p-mcp-$VERSION" --image "$NODE_IMAGE" \
      --set api_key=smoke --set folder_id=smoke --set token=smoke --set client_login= --set sandbox=false
  done
}

MAX_BYTES=$((MAX_MB * 1024 * 1024))
build
test -d "$OUT" || { echo "FAIL: $OUT/ was not created"; exit 1; }
found=$(find "$OUT" -maxdepth 1 -name '*.mcpb' | wc -l)
if [ "$found" -ne "${#BUNDLES[@]}" ]; then
  echo "FAIL: $found bundles in $OUT, expected ${#BUNDLES[@]}: ${BUNDLES[*]}"
  ls -la "$OUT"
  exit 1
fi
work=$(mktemp -d)
for b in "${BUNDLES[@]}"; do
  f="$OUT/$b"
  test -f "$f" || { echo "FAIL: missing $f"; exit 1; }
  size=$(stat -c %s "$f")
  [ "$size" -le "$MAX_BYTES" ] || { echo "FAIL: $f is $size bytes, limit $MAX_BYTES"; exit 1; }
  d="$work/${b%.mcpb}"
  mkdir "$d"
  python3 "$CHECK" bundle "$f" --version "$VERSION" --server-type "$SERVER_TYPE" $PRIVACY --extract "$d"
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/npm \
    -v "$NPM_CACHE":/npm -v "$d":/w:ro "$NODE_IMAGE" npx -y "$MCPB_CLI" validate /w/manifest.json
done
e2e "$work"
echo "promo-bundle-check: all ${#BUNDLES[@]} bundles passed"
