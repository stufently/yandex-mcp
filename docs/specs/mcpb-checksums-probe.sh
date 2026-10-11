#!/usr/bin/env bash
# Usage: bash probe-v2.sh path/to/mcpb-checksums.sh
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
trap 'fail "unexpected error at line $LINENO"' ERR

script=${1:-}
[[ -n "$script" ]] || fail "missing script argument"
[[ "$script" == /* ]] || script="$PWD/$script"
[[ -f "$script" ]] || fail "no script: $script"

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
run() { timeout 60 bash "$script" "$@" < /dev/null; }
same() { cmp -s -- "$1" "$2" || fail "$3"; }

line_re='^[0-9a-f]{64}  [^/ ]+$'
other='4f61ef6bf24ae8c914c8ba41f668fbf8033e9b2b28682f1b95c372c8b7e8900d  z-archive.tar.gz'
other2='1111111111111111111111111111111111111111111111111111111111111111  a-archive.zip'
stale='0000000000000000000000000000000000000000000000000000000000000000  app-1.0.0-linux-amd64.mcpb'

# T1: fresh sums contain only immediate files, in C filename order.
d1="$work/t1/dist-mcpb"
mkdir -p "$d1/nested" "$d1/directory.mcpb"
printf 'bundle-a\n' > "$d1/app-1.0.0-linux-amd64.mcpb"
printf 'bundle-b\n' > "$d1/app-1.0.0-darwin-arm64.mcpb"
printf 'not a bundle\n' > "$d1/notes.txt"
printf 'backup\n' > "$d1/old.mcpb.bak"
printf 'nested bundle\n' > "$d1/nested/hidden.mcpb"
if ! run "$d1" "$d1/checksums.txt"; then
  fail "T1 script rejected a directory with bundles"
fi
(
  cd -- "$d1"
  LC_ALL=C sha256sum -- app-1.0.0-darwin-arm64.mcpb app-1.0.0-linux-amd64.mcpb |
    LC_ALL=C sort -k2
) > "$work/expected1"
same "$work/expected1" "$d1/checksums.txt" "T1 bundle sums differ or are not in LC_ALL=C filename order"
[[ $(wc -l < "$d1/checksums.txt") -eq 2 ]] || fail "T1 expected exactly two bundle lines"
if grep -Evq "$line_re" "$d1/checksums.txt"; then
  fail "T1 line is not in sha256sum text format with a basename"
fi
if ! (cd -- "$d1" && sha256sum -c --strict checksums.txt > /dev/null); then
  fail "T1 sha256sum -c failed"
fi
if grep -q 'notes.txt\|\.bak\|nested\|directory' "$d1/checksums.txt"; then
  fail "T1 listed a non-bundle or a nested entry"
fi
ok "T1 correct hashes, format, file selection and bundle order"

# T2: a repeat is byte-for-byte identical.
cp -- "$d1/checksums.txt" "$work/before2"
if ! run "$d1" "$d1/checksums.txt"; then
  fail "T2 repeat returned nonzero"
fi
same "$work/before2" "$d1/checksums.txt" "T2 repeat changed the checksum file"
ok "T2 idempotent"

# T5: the external checksum verification also detects real tampering.
printf 'tampered\n' >> "$d1/app-1.0.0-linux-amd64.mcpb"
if (cd -- "$d1" && sha256sum -c --strict checksums.txt > /dev/null 2>&1); then
  fail "T5 tampered bundle still verifies"
fi
ok "T5 tampered bundle detected"

# T3: preserve multiple foreign lines, including blank lines and CR bytes.
d3="$work/t3/dist-mcpb"
mkdir -p "$d3"
printf 'bundle-a\n' > "$d3/app-1.0.0-linux-amd64.mcpb"
sums3="$work/t3/checksums.txt"
printf '%s\n\n%s\r\n%s\n' "$other" '# release archives' "$other2" > "$work/foreign3"
{
  printf '%s\n%s\n' "$other" "$stale"
  printf '\n%s\r\n%s\n' '# release archives' "$other2"
} > "$sums3"
cp -- "$work/foreign3" "$work/expected3"
(cd -- "$d3" && sha256sum -- app-1.0.0-linux-amd64.mcpb) >> "$work/expected3"
if ! run "$d3" "$sums3"; then
  fail "T3 merge returned nonzero"
fi
head -n4 -- "$sums3" > "$work/actual-foreign3"
same "$work/foreign3" "$work/actual-foreign3" "T3 foreign block lost bytes, lines or original order"
same "$work/expected3" "$sums3" "T3 stale bundle line was not replaced with one fresh appended sum"
if ! (cd -- "$d3" && grep '\.mcpb$' "$sums3" | sha256sum -c --strict - > /dev/null); then
  fail "T3 sha256sum -c failed on bundle lines"
fi
ok "T3 foreign block preserved byte-for-byte before fresh bundle sum"

# T4: no immediate bundles must report an error and leave SUMS untouched.
d4="$work/t4/dist-mcpb"
mkdir -p "$d4/nested" "$d4/directory.mcpb"
printf 'x\n' > "$d4/readme.txt"
printf 'nested bundle\n' > "$d4/nested/hidden.mcpb"
sums4="$work/t4/checksums.txt"
cp -- "$work/foreign3" "$sums4"
cp -- "$sums4" "$work/before4"
if run "$d4" "$sums4" 2> "$work/stderr4"; then
  fail "T4 directory without immediate bundles returned zero"
fi
[[ -s "$work/stderr4" ]] || fail "T4 missing stderr diagnostic"
same "$work/before4" "$sums4" "T4 changed existing SUMS on empty input"
d4b="$work/t4b/dist-mcpb"
mkdir -p "$d4b"
if run "$d4b" "$d4b/checksums.txt" 2> "$work/stderr4b"; then
  fail "T4 empty directory without SUMS returned zero"
fi
[[ -s "$work/stderr4b" ]] || fail "T4 empty directory missing stderr diagnostic"
[[ ! -e "$d4b/checksums.txt" ]] || fail "T4 created SUMS on empty input"
ok "T4 empty input reports errors without changing or creating SUMS"

# T6: force only internal verification to fail, leaving hash generation real.
d6="$work/t6/dist-mcpb"
mkdir -p "$d6" "$work/shim"
printf 'bundle-a\n' > "$d6/app-1.0.0-linux-amd64.mcpb"
sums6="$work/t6/checksums.txt"
printf '%s\n%s\n' "$other" "$stale" > "$sums6"
cp -- "$sums6" "$work/before6"
real_sha256sum=$(command -v sha256sum)
[[ "$real_sha256sum" == /* && -x "$real_sha256sum" ]] || fail "T6 cannot locate real sha256sum"
{
  cat <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  if [[ "$arg" == -c ]]; then
    exit 1
  fi
done
SHIM
  printf 'exec %q "$@"\n' "$real_sha256sum"
} > "$work/shim/sha256sum"
chmod +x -- "$work/shim/sha256sum"
if PATH="$work/shim:$PATH" run "$d6" "$sums6" > "$work/stdout6" 2> "$work/stderr6"; then
  fail "T6 internal sha256sum -c failure returned zero"
fi
same "$work/before6" "$sums6" "T6 replaced SUMS despite internal sha256sum -c failure"
ok "T6 failed internal verification leaves existing SUMS unchanged"

# T7: the final foreign line without LF must survive, then gain a separator LF.
d7="$work/t7/dist-mcpb"
mkdir -p "$d7"
printf 'bundle-a\n' > "$d7/app-1.0.0-linux-amd64.mcpb"
sums7="$work/t7/checksums.txt"
printf '%s\n%s' "$other" "$other2" > "$sums7"
printf '%s\n%s\n' "$other" "$other2" > "$work/expected7"
(cd -- "$d7" && sha256sum -- app-1.0.0-linux-amd64.mcpb) >> "$work/expected7"
if ! run "$d7" "$sums7"; then
  fail "T7 merge with unterminated foreign line returned nonzero"
fi
same "$work/expected7" "$sums7" "T7 final foreign line without LF was lost or not separated from bundle sums"
ok "T7 unterminated foreign line preserved with separator LF"

# T8: GNU escaped bundle lines are replaced; escaped foreign lines stay intact.
d8="$work/t8/dist-mcpb"
mkdir -p "$d8"
printf 'bundle-a\n' > "$d8/app-1.0.0-linux-amd64.mcpb"
sums8="$work/t8/checksums.txt"
escaped_stale='\0000000000000000000000000000000000000000000000000000000000000000  a\\b.mcpb'
escaped_other='\1111111111111111111111111111111111111111111111111111111111111111  c\\d.tar.gz'
printf '%s\n%s\n' "$other" "$escaped_other" > "$work/foreign8"
printf '%s\n%s\n%s\n' "$other" "$escaped_stale" "$escaped_other" > "$sums8"
cp -- "$work/foreign8" "$work/expected8"
(cd -- "$d8" && sha256sum -- app-1.0.0-linux-amd64.mcpb) >> "$work/expected8"
if ! run "$d8" "$sums8"; then
  fail "T8 merge with GNU escaped bundle line returned nonzero"
fi
same "$work/expected8" "$sums8" "T8 escaped bundle line retained or foreign lines changed"
if ! run "$d8" "$sums8"; then
  fail "T8 repeat with GNU escaped foreign line returned nonzero"
fi
same "$work/expected8" "$sums8" "T8 repeat duplicated escaped bundle line or changed foreign lines"
ok "T8 GNU escaped bundle lines replaced and foreign lines preserved"

echo "PROBE PASSED"
