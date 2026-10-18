#!/usr/bin/env bash
# No implicit .env, credentials, browser space or candidate artifact consumption.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/blackbox-application-projects.mjs" "$@"
