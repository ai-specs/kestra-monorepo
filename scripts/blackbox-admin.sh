#!/usr/bin/env bash
# Monorepo integration only: consume independently built overlay image + plugin jar.
# Usage: ./scripts/blackbox-admin.sh IMAGE@sha256:DIGEST PLUGIN_JAR SHA256 [PLUGIN_REPO]
set -euo pipefail
IMAGE="${1:?usage: blackbox-admin.sh IMAGE@sha256:DIGEST PLUGIN_JAR SHA256 [PLUGIN_REPO]}"
PLUGIN_JAR="${2:?explicit plugin jar required}"
EXPECTED_SHA="${3:?explicit plugin SHA-256 required}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_REPO="${4:-$REPO/kestra-plugin-rbac}"
[[ "$IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo 'FAIL IMAGE must be an immutable repository@sha256 digest'; exit 1; }
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo 'FAIL invalid plugin SHA-256'; exit 1; }
test -s "$PLUGIN_JAR"
ACTUAL_SHA=$(python3 - "$PLUGIN_JAR" <<'PY'
import hashlib,sys
with open(sys.argv[1],'rb') as f: print(hashlib.file_digest(f,'sha256').hexdigest())
PY
)
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || { echo 'FAIL plugin jar SHA-256 mismatch'; exit 1; }
PLUGIN_JAR="$(cd "$(dirname "$PLUGIN_JAR")" && pwd)/$(basename "$PLUGIN_JAR")"
PLUGIN_REPO="$(cd "$PLUGIN_REPO" && pwd)"
PORT="${BB_RBAC_PORT:-18097}"
BASE="http://localhost:$PORT"
PROJECT="admin-bb-$(date -u +%Y%m%d%H%M%S)-$$"
TEMP_DIR=$(mktemp -d)
OVERRIDE="$TEMP_DIR/override.yml"
ENV_FILE="$TEMP_DIR/compose.env"
mkdir -p "$TEMP_DIR/libs" "$TEMP_DIR/empty-libs" "$TEMP_DIR/plugins"
cp "$PLUGIN_JAR" "$TEMP_DIR/libs/kestra-rbac-authorizer.jar"
chmod 644 "$TEMP_DIR/libs/kestra-rbac-authorizer.jar"
python3 - "$TEMP_DIR/libs/kestra-rbac-authorizer.jar" "$EXPECTED_SHA" <<'PY'
import hashlib,sys
with open(sys.argv[1],'rb') as f: assert hashlib.file_digest(f,'sha256').hexdigest()==sys.argv[2], 'Mounted copy hash mismatch'
PY
cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=local-ci-only
KESTRA_IMAGE=$IMAGE
KESTRA_OIDC_UI_CLIENT_SECRET=rbac-blackbox-ui-secret-only
KESTRA_OIDC_BOOTSTRAP_USERNAME=tester
KESTRA_OIDC_BOOTSTRAP_PASSWORD=Passw0rd!
KESTRA_OIDC_SETUP_ALLOWED=false
KESTRA_RBAC_ENABLED=false
EOF
chmod 600 "$ENV_FILE"
compose() {
  # Explicit --env-file excludes the developer's .env; project name isolates networks/volumes.
  docker compose --project-directory "$REPO" --env-file "$ENV_FILE" -p "$PROJECT" \
    -f "$REPO/docker-compose.yml" -f "$OVERRIDE" "$@"
}
cleanup() {
  local code=$?
  if [ "$code" != 0 ] && [ -f "$OVERRIDE" ]; then compose logs --no-color --tail 150 kestra >&2 || true; fi
  if [ "${BB_RBAC_CONFIG_ONLY:-0}" != 1 ] && [ -f "$OVERRIDE" ]; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -rf "$TEMP_DIR"
  return "$code"
}
trap cleanup EXIT
# Render the existing deployment config rather than introducing another docker run topology.
# Inline exports also override any conflicting inherited developer environment values.
POSTGRES_PASSWORD=local-ci-only KESTRA_IMAGE="$IMAGE" KESTRA_OIDC_UI_CLIENT_SECRET=rbac-blackbox-ui-secret-only \
KESTRA_OIDC_BOOTSTRAP_USERNAME=tester KESTRA_OIDC_BOOTSTRAP_PASSWORD='Passw0rd!' KESTRA_OIDC_SETUP_ALLOWED=false \
KESTRA_RBAC_ENABLED=false docker compose --project-directory "$REPO" --env-file "$ENV_FILE" \
  -p "$PROJECT" -f "$REPO/docker-compose.yml" config --format json > "$TEMP_DIR/base.json"
# Subsequent compose invocations must likewise be insulated from inherited substitution values.
export POSTGRES_PASSWORD=local-ci-only KESTRA_IMAGE="$IMAGE" KESTRA_OIDC_UI_CLIENT_SECRET=rbac-blackbox-ui-secret-only
export KESTRA_OIDC_BOOTSTRAP_USERNAME=tester KESTRA_OIDC_BOOTSTRAP_PASSWORD='Passw0rd!' KESTRA_OIDC_SETUP_ALLOWED=false KESTRA_RBAC_ENABLED=false
make_override() {
  local enabled="$1" mounted="$2"
  python3 - "$TEMP_DIR/base.json" "$OVERRIDE" "$BASE" "$PORT" "$TEMP_DIR" "$enabled" "$mounted" "$IMAGE" <<'PY'
import json,sys
source,target,base,port,temp,enabled,mounted,image=sys.argv[1:]
config=json.load(open(source))['services']['kestra']['environment']['KESTRA_CONFIGURATION']
config=config.replace('http://localhost:8080',base)
# OAuth backchannel runs within Kestra, independent of the host-published test port.
config=config.replace('url: '+base+'/oidc/token','url: http://localhost:8080/oidc/token')
config=config.replace('jwks-uri: '+base+'/oidc/jwks','jwks-uri: http://localhost:8080/oidc/jwks')
config=config.replace('enabled: false\n            role-mapping:', 'enabled: '+enabled+'\n            role-mapping:')
# Compose emits the configuration at its original indentation; replace only the RBAC switch.
import re
config,n=re.subn(r'(  rbac:\n    enabled: )[^\n]+', r'\g<1>'+enabled, config)
assert n==1, 'Expected a single RBAC switch in default deployment policy'
libs=temp+('/libs' if mounted=='true' else '/empty-libs')
# Compose merges volumes by container target; !override replaces the original published port.
with open(target,'w') as f:
 f.write('services:\n  postgres:\n    ports: ["127.0.0.1::5432"]\n  kestra:\n')
 f.write('    image: '+json.dumps(image)+'\n')
 f.write('    ports: !override ['+json.dumps('127.0.0.1:'+port+':8080')+']\n')
 f.write('    volumes:\n      - '+json.dumps({'type':'bind','source':libs,'target':'/app/libs','read_only':True})+'\n')
 f.write('      - '+json.dumps({'type':'bind','source':temp+'/plugins','target':'/app/plugins'})+'\n')
 f.write('    environment:\n      KESTRA_CONFIGURATION: '+json.dumps(config)+'\n')
PY
}
check_config() {
  compose config --format json > "$TEMP_DIR/rendered.json"
  python3 - "$TEMP_DIR/rendered.json" "$IMAGE" <<'PYCONFIG'
import json,sys
rendered=json.load(open(sys.argv[1]))
assert rendered['services']['kestra']['image']==sys.argv[2]
text=rendered['services']['kestra']['environment']['KESTRA_CONFIGURATION']
assert 'instance-admin-roles: [deployment-admin]' in text
assert 'admin: [deployment-admin]' in text
assert 'deployment-admin: []' in text
print('PASS default deployment policy retains explicit instance administrator')
PYCONFIG
}
ready() {
  local complete=0
  for attempt in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)" = 200 ]; then complete=1; break; fi
    sleep 2
  done
  [ "$complete" = 1 ] || { echo 'FAIL Compose Kestra readiness'; return 1; }
}
phase() {
  local name="$1" enabled="$2" mounted="$3"
  make_override "$enabled" "$mounted"
  check_config
  compose up -d --force-recreate kestra
  ready
  BB_RBAC_PG="$(compose ps -q postgres)" node "$REPO/scripts/blackbox-admin.mjs" "$BASE" "$TEMP_DIR" "$name"
  if [ "$name" != missing ]; then
    if [ "${BB_BROWSER_DRIVER:-ego}" = ci ]; then
      BASE="$BASE" PHASE="$name" DIRECTORY="$TEMP_DIR" node "$REPO/scripts/blackbox-admin-ci.cjs"
    else
    python3 - "$REPO/scripts/blackbox-admin-ui.mjs" "$BASE" "$name" "$TEMP_DIR" "$ADMIN_UI_SPACE" <<'PYUI' | ego-browser nodejs
import json,sys
source,base,phase,directory,space=sys.argv[1:]
text=open(source).read()
for key,value in {'ADMIN_UI_BASE':base,'ADMIN_UI_PHASE':phase,'ADMIN_UI_DIRECTORY':directory,'ADMIN_UI_SPACE':space}.items():
 text=text.replace('process.env.'+key,json.dumps(value))
print(text)
PYUI
    mkdir -p "$REPO/.work/admin-ui"
    cp "$TEMP_DIR/$name.ui.json" "$REPO/.work/admin-ui/$name.json"
    fi
  fi
  test -s "$TEMP_DIR/$name.passed"
}
echo "RBAC integration input: image=$IMAGE plugin-sha256=$EXPECTED_SHA project=$PROJECT"
make_override false true
check_config
if [ "${BB_RBAC_CONFIG_ONLY:-0}" = 1 ]; then
  for settings in "true true" "true false" "false true"; do
    read -r enabled mounted <<< "$settings"
    make_override "$enabled" "$mounted"
    check_config
  done
  echo "PASS all isolated monorepo Compose phases render (configuration only; no containers started)"
  exit 0
fi
# The caller may supply a TaskSpace already created for this goal.
if [ "${BB_BROWSER_DRIVER:-ego}" = ci ]; then
  export ADMIN_UI_SPACE=0
elif [ -n "${BB_RBAC_EGO_SPACE:-}" ]; then
  export ADMIN_UI_SPACE="$BB_RBAC_EGO_SPACE"
else
  ADMIN_UI_SPACE_FILE="$TEMP_DIR/ego-space" ego-browser nodejs <<'EOFEGO'
const fs=await import('node:fs/promises');
const task=await taskSpace("RBAC bootstrap administrator UI parity");
await fs.writeFile(process.env.ADMIN_UI_SPACE_FILE,String(task.spaceId));
console.log({spaceId:task.spaceId});
EOFEGO
  export ADMIN_UI_SPACE="$(cat "$TEMP_DIR/ego-space")"
fi
compose up -d
ready
phase seed false true
phase enabled true true
phase missing true false
phase disabled false true
echo "ADMIN COMPOSE BLACKBOX ALL GREEN image=$IMAGE plugin-sha256=$EXPECTED_SHA"
if [ "${BB_BROWSER_DRIVER:-ego}" != ci ] && [ -z "${BB_RBAC_EGO_SPACE:-}" ]; then
  ego-browser nodejs -e "const task=await taskSpace($ADMIN_UI_SPACE);await task.finish({keep:[]});"
fi
