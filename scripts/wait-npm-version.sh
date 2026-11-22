#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 4 || -z ${1-} || -z ${2-} ]]; then
  echo 'Usage: wait-npm-version.sh PKG VERSION [ATTEMPTS] [DELAY]' >&2
  exit 2
fi

pkg=$1
version=$2
attempts=${3-30}
delay=${4-10}
if [[ ! $attempts =~ ^0*([1-9][0-9]*)$ ]]; then
  echo 'ATTEMPTS must be a positive integer' >&2
  exit 2
fi
attempts=${BASH_REMATCH[1]}
if [[ ! $delay =~ ^[0-9]+$ ]]; then
  echo 'DELAY must be a non-negative integer' >&2
  exit 2
fi

for ((attempt = 1; ; attempt++)); do
  if actual=$(npm view "$pkg@$version" version); then
    # Strip trailing whitespace while preserving leading and internal whitespace.
    actual=${actual%"${actual##*[![:space:]]}"}
    if [[ $actual == "$version" ]]; then
      echo "$pkg@$version is available on npm"
      exit 0
    fi
  fi
  if [[ $attempt == "$attempts" ]]; then
    break
  fi
  sleep "$delay"
done

echo "::error::$pkg@$version unavailable on npm after $attempts attempts" >&2
exit 1
