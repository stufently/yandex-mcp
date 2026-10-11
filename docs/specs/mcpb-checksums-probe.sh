#!/usr/bin/env bash
# Probe for scripts/mcpb-checksums.sh (written by the milestone author, not the executor).
# Usage: bash docs/specs/mcpb-checksums-probe.sh [path/to/mcpb-checksums.sh]
# Simulates a release directory with fake .mcpb files and checks the result with
# `sha256sum -c`. Exit 0 only when every check passes. Leaves its temp dir in place.
set -uo pipefail

script="${1:-scripts/mcpb-checksums.sh}"
script="$(cd "$(dirname "$script")" && pwd)/$(basename "$script")"
[ -f "$script" ] || { echo "FAIL: no $script" >&2; exit 1; }

work="$(mktemp -d)"
fails=0
run() { timeout 60 bash "$script" "$@" < /dev/null; }
fail() { echo "FAIL: $*" >&2; fails=$((fails + 1)); }
ok() { echo "ok: $*"; }

line_re='^[0-9a-f]{64}  [^/ ]+$'

# --- T1: fresh file inside the bundle directory ---------------------------------
d1="$work/t1/dist-mcpb"
mkdir -p "$d1"
printf 'bundle-a\n' > "$d1/app-1.0.0-linux-amd64.mcpb"
printf 'bundle-b\n' > "$d1/app-1.0.0-darwin-arm64.mcpb"
printf 'not a bundle\n' > "$d1/notes.txt"
printf 'backup\n' > "$d1/old.mcpb.bak"
if run "$d1" "$d1/checksums.txt"; then
  expected="$(cd "$d1" && LC_ALL=C sha256sum -- *.mcpb | LC_ALL=C sort -k2)"
  actual="$(LC_ALL=C sort -k2 "$d1/checksums.txt")"
  [ "$actual" = "$expected" ] && ok "T1 sums equal sha256sum of every .mcpb" || fail "T1 content differs: $(cat "$d1/checksums.txt")"
  [ "$(wc -l < "$d1/checksums.txt")" -eq 2 ] && ok "T1 exactly two lines" || fail "T1 line count $(wc -l < "$d1/checksums.txt")"
  grep -Evq "$line_re" "$d1/checksums.txt" && fail "T1 line not in sha256sum text format" || ok "T1 sha256sum text format, basenames only"
  (cd "$d1" && sha256sum -c --strict checksums.txt >/dev/null) && ok "T1 sha256sum -c passes" || fail "T1 sha256sum -c failed"
  grep -q 'notes.txt\|\.bak' "$d1/checksums.txt" && fail "T1 non-.mcpb file listed" || ok "T1 only .mcpb listed"
  # --- T2: re-run is idempotent ---
  before="$(sha256sum < "$d1/checksums.txt")"
  run "$d1" "$d1/checksums.txt" || fail "T2 re-run rc!=0"
  [ "$(sha256sum < "$d1/checksums.txt")" = "$before" ] && ok "T2 re-run leaves identical file" || fail "T2 re-run changed file: $(cat "$d1/checksums.txt")"
  # --- T5: tampering is detected (the check above is not vacuous) ---
  printf 'tampered\n' >> "$d1/app-1.0.0-linux-amd64.mcpb"
  (cd "$d1" && sha256sum -c --strict checksums.txt >/dev/null 2>&1) && fail "T5 tampered bundle still verifies" || ok "T5 tampered bundle detected"
else
  fail "T1 script rc!=0"
fi

# --- T3: merge into an existing checksums file outside the bundle dir ------------
d3="$work/t3/dist-mcpb"
mkdir -p "$d3"
printf 'bundle-a\n' > "$d3/app-1.0.0-linux-amd64.mcpb"
sums3="$work/t3/checksums.txt"
other='4f61ef6bf24ae8c914c8ba41f668fbf8033e9b2b28682f1b95c372c8b7e8900d  app_1.0.0_linux_amd64.tar.gz'
stale='0000000000000000000000000000000000000000000000000000000000000000  app-1.0.0-linux-amd64.mcpb'
printf '%s\n%s\n' "$other" "$stale" > "$sums3"
if run "$d3" "$sums3"; then
  [ "$(head -n1 "$sums3")" = "$other" ] && ok "T3 foreign line kept first and verbatim" || fail "T3 foreign line lost or moved: $(cat "$sums3")"
  [ "$(wc -l < "$sums3")" -eq 2 ] && ok "T3 stale .mcpb line replaced, not duplicated" || fail "T3 line count $(wc -l < "$sums3"): $(cat "$sums3")"
  want="$(cd "$d3" && sha256sum -- app-1.0.0-linux-amd64.mcpb)"
  [ "$(tail -n1 "$sums3")" = "$want" ] && ok "T3 fresh .mcpb sum appended" || fail "T3 last line $(tail -n1 "$sums3")"
  (cd "$d3" && grep '\.mcpb$' "$sums3" | sha256sum -c --strict - >/dev/null) && ok "T3 sha256sum -c passes on .mcpb lines" || fail "T3 sha256sum -c failed"
else
  fail "T3 script rc!=0"
fi

# --- T4: no bundles is an error and leaves the file untouched --------------------
d4="$work/t4/dist-mcpb"
mkdir -p "$d4"
printf 'x\n' > "$d4/readme.txt"
sums4="$work/t4/checksums.txt"
printf '%s\n' "$other" > "$sums4"
snap="$(sha256sum < "$sums4")"
if run "$d4" "$sums4" 2>/dev/null; then
  fail "T4 empty bundle dir returned rc=0"
else
  ok "T4 empty bundle dir rejected"
fi
[ "$(sha256sum < "$sums4")" = "$snap" ] && ok "T4 existing file untouched" || fail "T4 file changed on error"
d4b="$work/t4b/dist-mcpb"
mkdir -p "$d4b"
if run "$d4b" "$d4b/checksums.txt" 2>/dev/null; then
  fail "T4 empty dir, no file: rc=0"
else
  ok "T4 empty dir, no file: rejected"
fi

echo "workdir: $work"
if [ "$fails" -ne 0 ]; then
  echo "PROBE FAILED: $fails check(s)" >&2
  exit 1
fi
echo "PROBE PASSED"
