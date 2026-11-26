#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HOST="${AMIS_PROBE_HOST_JAR:?AMIS_PROBE_HOST_JAR required}"; SHA="${AMIS_PROBE_HOST_SHA256:?AMIS_PROBE_HOST_SHA256 required}"; AREA="$ROOT/.work/amis-probe-cli-negative-$(date +%s)"; mkdir "$AREA"
if AMIS_PROBE_HOST_JAR="$HOST" AMIS_PROBE_HOST_SHA256="0000000000000000000000000000000000000000000000000000000000000000" AMIS_PROBE_OUT="$AREA/bad-host" bash "$ROOT/scripts/amis-apps-probe/compile.sh" >"$AREA/bad-host.log" 2>&1; then echo 'FAIL: bad host hash accepted'; exit 1; fi
mkdir "$AREA/existing"
if AMIS_PROBE_HOST_JAR="$HOST" AMIS_PROBE_HOST_SHA256="$SHA" AMIS_PROBE_OUT="$AREA/existing" bash "$ROOT/scripts/amis-apps-probe/compile.sh" >"$AREA/existing-out.log" 2>&1; then echo 'FAIL: existing output accepted'; exit 1; fi
echo "PASS: invalid host hash and existing output rejected; evidence=$AREA"
