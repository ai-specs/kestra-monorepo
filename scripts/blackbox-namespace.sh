#!/usr/bin/env bash
# Monorepo integration only: consume independently built overlay image + plugin jar.
# Usage: ./scripts/blackbox-namespace.sh IMAGE@sha256:DIGEST PLUGIN_JAR SHA256 [PLUGIN_REPO]
# The fixture host fat jar is extracted from this exact Compose image/container.
# BB_RBAC_FIXTURE_TEST defaults to io.kestra.extensions.rbac.OidcRbacFixtureTest.
# The fixture must use production OidcUserService against OIDC_FIXTURE_JDBC and create:
# rbac-reader / ReaderPass123! / reader, rbac-writer / WriterPass123! / writer.
# No fixture SQL writes are performed here. Counts/checks use read-only SELECT.
# Docker Compose >=2.24.4 required for !override; Node >=22; JDK 25 for plugin fixture.
set -euo pipefail
IMAGE="${1:?usage: blackbox-namespace.sh IMAGE@sha256:DIGEST PLUGIN_JAR SHA256 [PLUGIN_REPO]}"
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
PORT="${BB_RBAC_PORT:-18106}"
BASE="http://localhost:$PORT"
PROJECT="namespace-bb-$(date -u +%Y%m%d%H%M%S)-$$"
mkdir -p "$REPO/.work/namespace"
TEMP_DIR="$REPO/.work/namespace/$PROJECT"
mkdir -p "$TEMP_DIR"
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
  if [ "$code" != 0 ] && [ -f "$OVERRIDE" ]; then
    compose logs --no-color --tail 150 kestra 2>&1 | python3 -c 'import re,sys; [print("[redacted credential-bearing line]" if re.search(r"token|password|secret|cookie|authorization|Bearer|eyJ[A-Za-z0-9_-]+\.|state=|code=", line, re.I) else line, end="" if line.endswith("\n") else "\n") for line in sys.stdin]' >&2 || true
  fi
  if [ "${BB_RBAC_CONFIG_ONLY:-0}" != 1 ] && [ -f "$OVERRIDE" ] && { [ "$code" = 0 ] || [ "${BB_KEEP_FAILED:-0}" != 1 ]; }; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -f "$ENV_FILE"
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
from importlib.machinery import SourceFileLoader
database_policy=SourceFileLoader('ci_policy', 'scripts/ci-policy.py').load_module().database_policy
config=json.load(open(source))['services']['kestra']['environment']['KESTRA_CONFIGURATION']
config=config.replace('http://localhost:8080',base)
# OAuth backchannel runs within Kestra, independent of the host-published test port.
config=config.replace('url: '+base+'/oidc/token','url: http://localhost:8080/oidc/token')
config=config.replace('jwks-uri: '+base+'/oidc/jwks','jwks-uri: http://localhost:8080/oidc/jwks')
# Replace the entire known deployment RBAC subtree, never merge flat policy aliases.
lines=config.splitlines(keepends=True)
starts=[i for i,line in enumerate(lines) if line.startswith('  rbac:')]
assert len(starts)==1, 'Expected one nested kestra.rbac section in monorepo Compose'
start=starts[0]; stop=start+1
while stop<len(lines) and (not lines[stop].strip() or len(lines[stop])-len(lines[stop].lstrip())>2): stop+=1
config=''.join(lines[:start]+lines[stop:])
assert 'kestra.rbac.' not in config, 'Unexpected flat RBAC aliases in deployment config'
# Registration is protocol configuration; the plugin policy is inserted once as a complete subtree.
resources=['FLOW','EXECUTION','NAMESPACE','LOG','METRIC','TRIGGER','KVSTORE','NAMESPACE_FILE']
def grants(namespace, descendants, write):
 actions=['READ','LIST','ACCESS_OUTPUTS'] + (['CREATE','UPDATE','DELETE','EXECUTE'] if write else [])
 return [{'scope':'NAMESPACE','tenant':'main','namespace':namespace,'descendants':descendants,'resource':resource,'actions':actions,'all-ids':True} for resource in resources]
def mcp_read():
 return [{'scope':'TENANT','tenant':'main','resource':'MCP_SERVER','actions':['READ','LIST'],'all-ids':True}]
properties={'kestra.oidc.registration.enabled': True}
rbac={'enabled':enabled=='true','typed':{'enabled':True},'subjects':{},
 'instance-admin-roles':['deployment-admin'],
 'role-mapping':{'admin':['deployment-admin'],'reader':['reader'],'writer':['writer'],
                 'multi-reader':['multi-reader'],'multi-writer':['multi-writer'],'exact-reader':['exact']},
 'roles':{'deployment-admin':[],'reader':grants('rbac.allowed',True,False)+mcp_read(),
 'writer':grants('rbac.allowed',True,True)+mcp_read(),'multi-reader':grants('rbac.multi',False,False)+mcp_read(),
 'multi-writer':grants('rbac.allowed',False,True),'exact':grants('rbac.allowed',False,False)+mcp_read()}}
rbac=database_policy(rbac,temp+'/policy.json',['tester'])
assert config.splitlines().count('kestra:')==1, 'Expected one root kestra configuration'
config=config.replace('kestra:\n','kestra:\n  rbac: '+json.dumps(rbac)+'\n',1)
config+='\n'+''.join(json.dumps(key)+': '+json.dumps(value)+'\n' for key,value in properties.items())
assert 'typed' in config
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
policies=[line.removeprefix('  rbac: ') for line in text.splitlines() if line.startswith('  rbac: ')]
assert len(policies)==1 and 'kestra.rbac.' not in text, 'Ambiguous nested/flat RBAC policies'
policy=json.loads(policies[0])
assert policy['policy-source']=='database' and policy['typed']['enabled']
assert policy['evaluation']['enabled'] == policy['enabled']
assert 'roles' not in policy and 'role-mapping' not in policy
print('PASS rendered Compose namespace matrix policy')

PYCONFIG
}
ready() {
  local complete=0
  for attempt in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)" = 200 ]; then complete=1; break; fi
    sleep 2
  done
  [ "$complete" = 1 ] || { echo 'FAIL Compose Kestra readiness'; return 1; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/ui/assets/oidc-login-i18n.js")" = 200 ] || { echo 'FAIL anonymous login translation asset'; return 1; }
}
phase() {
  local name="$1" enabled="$2" mounted="$3"
  make_override "$enabled" "$mounted"
  check_config
  compose up -d --force-recreate kestra
  ready
  BB_RBAC_PG="$(compose ps -q postgres)" node "$REPO/scripts/blackbox-namespace.mjs" "$BASE" "$TEMP_DIR" "$name"
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
compose up -d
ready
BB_RBAC_PG="$(compose ps -q postgres)" node "$REPO/scripts/blackbox-namespace.mjs" "$BASE" "$TEMP_DIR" seed
PG_PORT=$(compose port postgres 5432 | sed 's/.*://')
HOST_JAR="$TEMP_DIR/host.jar"
# Consume the executable fat ZIP from the exact digest-backed Compose service, never a rolling local build.
docker cp "$(compose ps -q kestra):/app/kestra" "$HOST_JAR"
python3 - "$HOST_JAR" <<'PYHOST'
import sys,zipfile,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert 'io/kestra/webserver/rbac/RbacAuthorizer.class' in z.namelist(), 'Image lacks unified RBAC SPI'
 assert 'io/kestra/core/models/flows/Flow.class' in z.namelist(), 'Fixture host must be fat (missing core)'
with open(sys.argv[1],'rb') as f: print('Fixture image-extracted host SHA-256: '+hashlib.file_digest(f,'sha256').hexdigest())
PYHOST
HOST_ARGS=("-PkestraWebserverJar=$HOST_JAR")
if [ -n "${BB_RBAC_HOST_MODULES:-}" ]; then HOST_ARGS+=("-PkestraHostModules=$BB_RBAC_HOST_MODULES"); fi
FIXTURE_TEST="${BB_RBAC_FIXTURE_TEST:-io.kestra.extensions.rbac.OidcRbacFixtureTest}"
# The independent plugin owns this production-service fixture. Do not run overlay Gradle or fetch plugin from overlay CI.
(cd "$PLUGIN_REPO" && OIDC_FIXTURE_JDBC="jdbc:postgresql://127.0.0.1:$PG_PORT/kestra" \
  OIDC_FIXTURE_USER=kestra OIDC_FIXTURE_PASSWORD=local-ci-only \
  ./gradlew "${HOST_ARGS[@]}" test --rerun --tests "$FIXTURE_TEST" --console=plain)
python3 - "$PLUGIN_REPO/build/test-results/test/TEST-$FIXTURE_TEST.xml" <<'PY'
import sys,xml.etree.ElementTree as ET
suite=ET.parse(sys.argv[1]).getroot()
assert int(suite.get('tests','0')) > 0 and all(int(suite.get(k,'0'))==0 for k in ('failures','errors','skipped')), 'Fixture test missing/skipped/failed'
PY
source "$REPO/scripts/initialize-ci-policy.sh"
initialize_ci_policy
phase enabled true true
export NAMESPACE_UI_BASE="$BASE"
export NAMESPACE_UI_FIXTURE="$TEMP_DIR/resources.json"
export NAMESPACE_UI_REPORT="$TEMP_DIR/ui.json"
if [ "${BB_BROWSER_DRIVER:-ego}" = ci ]; then
  node "$REPO/scripts/blackbox-namespace-ci.cjs"
else
  export NAMESPACE_UI_SPACE="${BB_RBAC_EGO_SPACE:?Reuse the goal TaskSpace}"
  export NAMESPACE_UI_MODULE="file://$REPO/scripts/blackbox-namespace-ui.mjs"
  python3 - "$REPO/scripts/blackbox-namespace-ego.mjs" "$REPO/scripts/blackbox-namespace-ui.mjs" "$BASE" "$NAMESPACE_UI_FIXTURE" "$NAMESPACE_UI_REPORT" "$NAMESPACE_UI_SPACE" <<'PYBROWSER' | ego-browser nodejs
import json, pathlib, sys
source, module, base, fixture, report, space = sys.argv[1:]
text = pathlib.Path(source).read_text()
text = text.replace('pathToFileURL(`${process.cwd()}/scripts/blackbox-namespace-ui.mjs`)', json.dumps(pathlib.Path(module).resolve().as_uri()))
for key, value in {'NAMESPACE_UI_BASE': base, 'NAMESPACE_UI_FIXTURE': fixture, 'NAMESPACE_UI_REPORT': report, 'NAMESPACE_UI_SPACE': space}.items():
    text = text.replace('process.env.' + key, json.dumps(value))
print(text)
PYBROWSER
fi
python3 - "$TEMP_DIR/ui.json" <<'PYREPORT'
import json,sys
report=json.load(open(sys.argv[1]))
assert report['completed'] and report['rows'] and all(row['passed'] for row in report['rows'])
assert {row['user'] for row in report['rows']}=={'reader','writer','multi','exact','blocked'}
for user in ('reader','writer','multi','exact'):
 rows=[row for row in report['rows'] if row['user']==user]
 assert sum(row['case'].startswith('menu:') for row in rows)==7
 assert sum(row['case'].startswith('page:') for row in rows)==34
 assert any(row['case']=='dashboard-canonical-redirect' and row.get('passed') for row in rows)
 assert any(row['case']=='visible-flow-data-scope' and row.get('dataScopeVerified') for row in rows)
 assert any(row['case']=='visible-mcp-tool-flow-data-scope' and row.get('dataScopeVerified') for row in rows)
 if user in ('writer','multi'):
  assert all(any(row['case']=='action:flow-'+action and row.get('persistenceVerified') for row in rows) for action in ('create','update','execute','delete'))
 else:
  assert any(row['case']=='action:readonly-save-denied' and row.get('refusalVerified') and row.get('persistenceVerified') for row in rows)
blocked=[row for row in report['rows'] if row['user']=='blocked']
assert any(row['case']=='unknown-role-no-access' and row.get('authorizationVerified') for row in blocked)
PYREPORT
phase missing true false
phase disabled false true
echo "NAMESPACE COMPOSE BLACKBOX ALL GREEN image=$IMAGE plugin-sha256=$EXPECTED_SHA reports=$TEMP_DIR"
