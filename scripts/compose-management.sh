#!/usr/bin/env bash
set -euo pipefail
usage() { echo "Usage: scripts/compose-management.sh --admin-subject SUBJECT [--admin-subject SUBJECT ...] [docker compose arguments...]" >&2; }
subjects=()
while (($#)); do
  case "$1" in
    --admin-subject) (($# >= 2)) || { usage; exit 2; }; subjects+=("$2"); shift 2 ;;
    --admin-subject=*) subjects+=("${1#*=}"); shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
(( ${#subjects[@]} > 0 )) || { usage; exit 2; }
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
override="$(mktemp "${TMPDIR:-/tmp}/kestra-management.XXXXXX")"
chmod 600 "$override"
cleanup() { rm -f -- "$override"; }
trap cleanup EXIT HUP INT TERM
compose_json="$(docker compose -f "$root_dir/docker-compose.yml" config --format json)"
render_args=()
for subject in "${subjects[@]}"; do render_args+=(--admin-subject "$subject"); done
printf '%s' "$compose_json" | python3 "$root_dir/scripts/render-management-config.py" "${render_args[@]}" >"$override"
chmod 600 "$override"
set +e
docker compose -f "$root_dir/docker-compose.yml" -f "$override" "$@"
status=$?
set -e
exit "$status"
