#!/usr/bin/env bash
set -euo pipefail
CACHE="${1:?Compiler cache path required}"
EXPECTED=01e63084f1b466f5202aee78f3b7a7a19a1900c1bc8b35985284a21e741784f0
# Maven Central canonical endpoint; fixed artifact and digest remain unchanged.
URL=https://repo.maven.apache.org/maven2/io/micronaut/micronaut-inject-java/4.10.33/micronaut-inject-java-4.10.33.jar
if [[ -e "$CACHE" ]]; then
  [[ -f "$CACHE" && ! -L "$CACHE" ]] || { echo 'Unsafe compiler cache' >&2; exit 2; }
  [[ "$(sha256sum "$CACHE" | awk '{print $1}')" = "$EXPECTED" ]] || { echo 'Micronaut compiler jar SHA-256 mismatch' >&2; exit 2; }
  exit 0
fi
mkdir -p "$(dirname "$CACHE")"
TEMP="$(mktemp "${CACHE}.download.XXXXXX")"
trap 'rm -f "$TEMP"' EXIT
for attempt in 1 2 3; do
  if curl --fail --silent --show-error --location --retry 0 --connect-timeout 10 --max-time 30 "$URL" --output "$TEMP"; then
    break
  else
    code=$?
    [[ "$attempt" != 3 ]] || exit "$code"
    # Retrying only the immutable public artifact download; never business calls.
    : > "$TEMP"
    sleep 1
  fi
done
[[ "$(sha256sum "$TEMP" | awk '{print $1}')" = "$EXPECTED" ]] || { echo 'Micronaut compiler jar SHA-256 mismatch' >&2; exit 2; }
mv "$TEMP" "$CACHE"
