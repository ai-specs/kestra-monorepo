#!/usr/bin/env bash
set -euo pipefail
image="${1:?usage: blackbox-management.sh IMAGE@sha256:DIGEST PLUGIN_JAR SHA256}"
plugin="${2:?explicit plugin jar required}"
expected="${3:?explicit plugin hash required}"
[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || exit 2
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || exit 2
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="management-bb-$(date -u +%Y%m%d%H%M%S)-$$"
area="$root_dir/.work/management/$project"
port="${BB_MANAGEMENT_PORT:-18100}"
mkdir -p "$area/libs" "$area/plugins" "$area/empty-libs"
cp "$plugin" "$area/libs/kestra-rbac-authorizer.jar"
chmod 644 "$area/libs/kestra-rbac-authorizer.jar"
python3 - "$area/libs/kestra-rbac-authorizer.jar" "$expected" <<'PY'
import hashlib,sys
with open(sys.argv[1],'rb') as source:
    assert hashlib.file_digest(source,'sha256').hexdigest()==sys.argv[2], 'Plugin hash mismatch'
PY
cat > "$area/.env" <<EOF
POSTGRES_PASSWORD=management-test-only
KESTRA_IMAGE=$image
KESTRA_OIDC_UI_CLIENT_SECRET=management-ui-test-only
KESTRA_OIDC_BOOTSTRAP_USERNAME=tester
KESTRA_OIDC_BOOTSTRAP_PASSWORD=Passw0rd!
KESTRA_OIDC_SETUP_ALLOWED=false
KESTRA_RBAC_ENABLED=false
EOF
chmod 600 "$area/.env"
export POSTGRES_PASSWORD=management-test-only KESTRA_IMAGE="$image" KESTRA_OIDC_UI_CLIENT_SECRET=management-ui-test-only
export KESTRA_OIDC_BOOTSTRAP_USERNAME=tester KESTRA_OIDC_BOOTSTRAP_PASSWORD='Passw0rd!' KESTRA_OIDC_SETUP_ALLOWED=false KESTRA_RBAC_ENABLED=false
docker compose --env-file "$area/.env" -f "$root_dir/docker-compose.yml" config --format json |
  python3 "$root_dir/scripts/render-management-config.py" --admin-subject tester > "$area/management.yml"
chmod 600 "$area/management.yml"
python3 - "$area" "$port" "$image" "$expected" <<'PY'
import json,pathlib,sys,yaml
area,port,image,expected=sys.argv[1:]
path=pathlib.Path(area)
configuration=yaml.safe_load((path/'management.yml').read_text())['services']['kestra']['environment']['KESTRA_CONFIGURATION']
configuration=configuration.replace('http://localhost:8080', 'http://localhost:'+port)
configuration=configuration.replace('url: http://localhost:'+port+'/oidc/token','url: http://localhost:8080/oidc/token')
configuration=configuration.replace('jwks-uri: http://localhost:'+port+'/oidc/jwks','jwks-uri: http://localhost:8080/oidc/jwks')
with (path/'runtime.yml').open('w') as output:
 output.write('services:\n  postgres:\n    ports: ["127.0.0.1::5432"]\n  kestra:\n')
 output.write('    ports: !override ['+json.dumps('127.0.0.1:'+port+':8080')+']\n')
 output.write('    volumes:\n      - '+json.dumps({'type':'bind','source':area+'/libs','target':'/app/libs','read_only':True})+'\n')
 output.write('      - '+json.dumps({'type':'bind','source':area+'/plugins','target':'/app/plugins'})+'\n')
 output.write('    environment:\n      KESTRA_CONFIGURATION: '+json.dumps(configuration)+'\n')
(path/'initial-policy.json').write_text(json.dumps({'schemaVersion':1,'roles':[],'subjects':{},'roleMapping':{}}))
(path/'inputs.json').write_text(json.dumps({'image':image,'pluginSha256':expected,'base':'http://localhost:'+port,'project':path.name},indent=2)+'\n')
PY
chmod 600 "$area/runtime.yml"
compose() {
  docker compose --project-directory "$root_dir" --env-file "$area/.env" -p "$project" \
    -f "$root_dir/docker-compose.yml" -f "$area/management.yml" -f "$area/runtime.yml" "$@"
}
cleanup() {
  status=$?
  if [ "$status" != 0 ]; then compose logs --no-color --tail 120 kestra > "$area/host-failure.log" 2>&1 || true; fi
  if [ "${BB_MANAGEMENT_KEEP:-0}" != 1 ]; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
  return "$status"
}
trap cleanup EXIT
compose config --quiet
compose up -d postgres
for attempt in $(seq 1 60); do
  if compose exec -T postgres pg_isready -U kestra -d kestra >/dev/null 2>&1; then break; fi
  sleep 1
done
compose run --rm --no-deps --entrypoint java \
  -e RBAC_POLICY_JDBC_URL=jdbc:postgresql://postgres:5432/kestra -e RBAC_POLICY_JDBC_USER=kestra \
  -e RBAC_POLICY_JDBC_PASSWORD=management-test-only -e RBAC_POLICY_OPERATOR_SUBJECT=tester \
  -v "$area/initial-policy.json:/tmp/initial-policy.json:ro" kestra \
  -cp /app/kestra:/app/libs/kestra-rbac-authorizer.jar \
  io.kestra.extensions.rbac.store.PolicyImportCommand initialize /tmp/initial-policy.json
compose up -d kestra
ready=0
for attempt in $(seq 1 90); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/.well-known/openid-configuration" || true)" = 200 ]; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo 'Management host startup failed' >&2; exit 1; }
echo "Management test environment: project=$project evidence=$area base=http://localhost:$port"
if [ "${BB_MANAGEMENT_START_ONLY:-0}" = 1 ]; then
  echo 'START ONLY: management behavior has not been validated'
  exit 0
fi
export BB_MANAGEMENT_PG="$(compose ps -q postgres)"
node "$root_dir/scripts/blackbox-management.mjs" "http://localhost:$port" "$area"
if [ "${BB_BROWSER_DRIVER:-ego}" = ci ]; then
  node "$root_dir/scripts/management-ui-style-ci.cjs" "http://localhost:$port" "$area/ui-style.json"
fi
echo 'MANAGEMENT COMPOSE BLACKBOX ALL GREEN'
