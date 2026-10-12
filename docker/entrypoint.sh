#!/bin/sh
# Picks one of the five servers by its short name and runs it over stdio.
# Anything after the name goes to the server, e.g. `webmaster auth`.
set -eu

server="${1:-webmaster}"
[ "$#" -gt 0 ] && shift

case "$server" in
  search | wordstat | webmaster | metrika | direct)
    exec node "/app/packages/yandex-${server}-mcp/src/index.mjs" "$@"
    ;;
  *)
    echo "usage: yandex-mcp {search|wordstat|webmaster|metrika|direct} [args...]" >&2
    echo "unknown server: ${server}" >&2
    exit 64
    ;;
esac
