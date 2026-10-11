#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: bash scripts/mcpb-checksums.sh DIR SUMS" >&2
  exit 1
fi

# Resolve SUMS before changing directories; glob expansion must use C ordering.
export LC_ALL=C
dir=$(cd -- "$1" && pwd -P)
sums=$(cd -- "$(dirname -- "$2")" && pwd -P)/$(basename -- "$2")
cd -- "$dir"
shopt -s nullglob
files=()
for file in *.mcpb; do
  if [[ -f "$file" ]]; then
    files+=("$file")
  fi
done
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No .mcpb files in $dir" >&2
  exit 1
fi

# GNU sha256sum may prefix escaped filename records with a backslash.
bundle_pattern='^\\?[[:xdigit:]]{64} [ *].*\.mcpb$'
bundle_lines() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $bundle_pattern ]]; then
      printf '%s\n' "$line"
    fi
  done < "$1"
}

temporary=$(mktemp -- "${sums}.tmp.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
if [[ -f "$sums" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ ! "$line" =~ $bundle_pattern ]]; then
      # A missing final LF gains the separator needed before the bundle block.
      printf '%s\n' "$line"
    fi
  done < "$sums" > "$temporary"
fi
sha256sum -- "${files[@]}" >> "$temporary"

# Verify only bundle records: other release assets need not exist in DIR.
bundle_lines "$temporary" | sha256sum -c --strict -
mv -- "$temporary" "$sums"
bundle_lines "$sums" | sha256sum -c --strict -
