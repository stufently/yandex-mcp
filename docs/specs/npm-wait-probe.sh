#!/usr/bin/env bash
# Author's probe for milestone npm-wait-registry (yandex-mcp, 22.11.2026).
#
# Usage: bash docs/specs/npm-wait-probe.sh scripts/wait-npm-version.sh
#
# Runs the script under test against a fake `npm` and a fake `sleep` put first
# on PATH, so no network and no real waiting. Each case checks the exit code,
# the exact npm calls and the exact sleeps. Exit 0 = PROBE PASSED.
set -uo pipefail

target="${1:?usage: npm-wait-probe.sh path/to/wait-npm-version.sh}"
if [ ! -f "$target" ]; then
  echo "FAIL: no $target"
  exit 1
fi
target="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"

work="$(mktemp -d)"
fails=0
rc=0

# setup PLAN... — each plan line is one npm answer: "fail" (404, rc 1),
# "ok:<stdout>" (rc 0, prints <stdout> and a newline). The last line repeats.
setup() {
  mkdir -p "$work/bin"
  : > "$work/npm.log"
  : > "$work/sleep.log"
  echo 0 > "$work/n"
  printf '%s\n' "$@" > "$work/plan"
  cat > "$work/bin/npm" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$work/npm.log"
n=\$(( \$(cat "$work/n") + 1 ))
echo "\$n" > "$work/n"
line=\$(sed -n "\${n}p" "$work/plan")
[ -n "\$line" ] || line=\$(tail -n 1 "$work/plan")
case "\$line" in
  fail) echo "npm error code E404" >&2; exit 1 ;;
  ok:*) printf '%s\n' "\${line#ok:}" ;;
esac
EOF
  cat > "$work/bin/sleep" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$work/sleep.log"
EOF
  chmod +x "$work/bin/npm" "$work/bin/sleep"
}

run() {
  PATH="$work/bin:$PATH" bash "$target" "$@" < /dev/null > "$work/out" 2> "$work/err"
  rc=$?
}

fail() {
  echo "FAIL [$1]: $2"
  fails=$((fails + 1))
}

calls() { wc -l < "$work/npm.log" | tr -d ' '; }
sleeps() { wc -l < "$work/sleep.log" | tr -d ' '; }

expect_rc0() { [ "$rc" -eq 0 ] || fail "$1" "rc=$rc, expected 0; stderr: $(head -c 300 "$work/err")"; }
expect_rcnz() { [ "$rc" -ne 0 ] || fail "$1" "rc=0, expected non-zero"; }
expect_calls() { [ "$(calls)" = "$2" ] || fail "$1" "npm called $(calls) times, expected $2"; }
expect_sleeps() { # name count value
  [ "$(sleeps)" = "$2" ] || fail "$1" "sleep called $(sleeps) times, expected $2"
  if [ "$2" != 0 ] && grep -vqxF -- "$3" "$work/sleep.log"; then
    fail "$1" "sleep args $(tr '\n' ' ' < "$work/sleep.log"), expected all '$3'"
  fi
}
expect_npm_args() { # name pkg@ver
  if grep -vqxF -- "view $2 version" "$work/npm.log"; then
    fail "$1" "npm args $(head -n 1 "$work/npm.log"), expected 'view $2 version'"
  fi
}

# 1. 404 twice, then the version appears: success on the third call.
setup fail fail ok:2.3.0
run @stufently/yandex-search-mcp 2.3.0 5 7
expect_rc0 lag-then-ok
expect_calls lag-then-ok 3
expect_sleeps lag-then-ok 2 7
expect_npm_args lag-then-ok @stufently/yandex-search-mcp@2.3.0

# 2. Never appears: exactly ATTEMPTS calls, ATTEMPTS-1 sleeps, ::error with pkg@ver.
setup fail
run @stufently/yandex-direct-mcp 2.3.0 4 3
expect_rcnz never
expect_calls never 4
expect_sleeps never 3 3
grep -qF '::error' "$work/err" "$work/out" || fail never "no ::error annotation"
cat "$work/err" "$work/out" | grep -qF '@stufently/yandex-direct-mcp@2.3.0' || fail never "message does not name pkg@version"

# 3. Available at once: one call, no sleep.
setup ok:2.3.0
run @stufently/yandex-wordstat-mcp 2.3.0 5 7
expect_rc0 immediate
expect_calls immediate 1
expect_sleeps immediate 0 -

# 4. npm answers with another version (stale metadata): not success.
setup ok:2.2.9 ok:2.3.0
run @stufently/yandex-metrika-mcp 2.3.0 5 1
expect_rc0 stale
expect_calls stale 2

# 5. Exact match only: "12.3.0" and "2.3.01" are not "2.3.0".
setup ok:12.3.0 ok:2.3.01
run @stufently/yandex-metrika-mcp 2.3.0 3 1
expect_rcnz exact
expect_calls exact 3

# 6. Empty stdout with rc 0 is not success.
setup ok: ok:2.3.0
run @stufently/yandex-webmaster-mcp 2.3.0 5 1
expect_rc0 empty-out
expect_calls empty-out 2

# 7. Trailing whitespace in npm output is tolerated.
setup 'ok:2.3.0  '
run @stufently/yandex-webmaster-mcp 2.3.0 5 1
expect_rc0 trailing-ws
expect_calls trailing-ws 1

# 8. Defaults: 30 attempts, 10 s between them.
setup fail
run @stufently/yandex-search-mcp 2.3.0
expect_rcnz defaults
expect_calls defaults 30
expect_sleeps defaults 29 10

# 9. Bad arguments: non-zero, npm never called.
for args in "@stufently/yandex-search-mcp" "@stufently/yandex-search-mcp 2.3.0 abc 1" \
            "@stufently/yandex-search-mcp 2.3.0 0 1" "@stufently/yandex-search-mcp 2.3.0 3 -1" \
            "@stufently/yandex-search-mcp 2.3.0 3 x" " 2.3.0" "@stufently/yandex-search-mcp  3"; do
  setup ok:2.3.0
  read -r -a argv <<< "$args"
  if [[ "$args" == " 2.3.0" ]]; then argv=("" "2.3.0"); fi
  if [[ "$args" == "@stufently/yandex-search-mcp  3" ]]; then argv=("@stufently/yandex-search-mcp" "" "3"); fi
  run "${argv[@]}"
  expect_rcnz "args:$args"
  expect_calls "args:$args" 0
done

if [ "$fails" -ne 0 ]; then
  echo "PROBE FAILED: $fails check(s)"
  exit 1
fi
echo "PROBE PASSED"
