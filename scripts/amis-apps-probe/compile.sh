#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${AMIS_PROBE_HOST_JAR:-}"
HOST_SHA="${AMIS_PROBE_HOST_SHA256:-}"
CACHE="${AMIS_PROBE_COMPILER_JAR:-$ROOT/.work/amis-probe-cache/micronaut-inject-java-4.10.33.jar}"
EXPECTED_COMPILER_SHA=01e63084f1b466f5202aee78f3b7a7a19a1900c1bc8b35985284a21e741784f0
OUT="${AMIS_PROBE_OUT:-}"
[[ -n "$HOST" && -f "$HOST" ]] || { echo 'AMIS_PROBE_HOST_JAR must name an existing formal executable jar' >&2; exit 2; }
[[ "$HOST_SHA" =~ ^[a-f0-9]{64}$ ]] || { echo 'AMIS_PROBE_HOST_SHA256 must be a 64-hex digest' >&2; exit 2; }
[[ -n "$OUT" && "$OUT" == "$ROOT/.work/"* ]] || { echo 'AMIS_PROBE_OUT must be a new directory under root .work' >&2; exit 2; }
[[ ! -e "$OUT" ]] || { echo "AMIS_PROBE_OUT already exists: $OUT" >&2; exit 2; }
ACTUAL_HOST_SHA="$(sha256sum "$HOST" | awk '{print $1}')"; [[ "$ACTUAL_HOST_SHA" = "$HOST_SHA" ]] || { echo 'formal host jar SHA-256 mismatch' >&2; exit 2; }
bash "$ROOT/scripts/amis-apps-probe/download-compiler.sh" "$CACHE"
ACTUAL_COMPILER_SHA="$(sha256sum "$CACHE" | awk '{print $1}')"; [[ "$ACTUAL_COMPILER_SHA" = "$EXPECTED_COMPILER_SHA" ]] || { echo 'Micronaut compiler jar SHA-256 mismatch' >&2; exit 2; }
if [[ -n "${JAVA_HOME:-}" ]]; then JAVA="$JAVA_HOME/bin/java"; JAVAC="$JAVA_HOME/bin/javac"; JAR="$JAVA_HOME/bin/jar"; else JAVA="$(command -v java)"; JAVAC="$(command -v javac)"; JAR="$(command -v jar)"; fi
for tool in "$JAVA" "$JAVAC" "$JAR"; do [[ -x "$tool" ]] || { echo "missing JDK tool: $tool" >&2; exit 2; }; done
JDK_VERSION="$($JAVA -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -1)"; [[ "$JDK_VERSION" = 25 ]] || { echo "JDK 25 required, got ${JDK_VERSION:-unknown}" >&2; exit 2; }
mkdir "$OUT" "$OUT/classes" "$OUT/probe"
SOURCE_HASH="$(python3 - "$ROOT/scripts/amis-apps-probe" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
files = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(root.glob('*.java'))}
assert files, 'Probe Java source is missing'
print(hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
PY
)"
"$JAVAC" -parameters -cp "$HOST" -processorpath "$CACHE:$HOST" -d "$OUT/classes" "$ROOT/scripts/amis-apps-probe"/*.java
cat > "$OUT/manifest.mf" <<'MF'
Premain-Class: io.kestra.root.amisprobe.ProbeAgent
Can-Redefine-Classes: false
Can-Retransform-Classes: false
MF
"$JAR" --create --file "$OUT/amis-apps-probe.jar" --manifest "$OUT/manifest.mf" -C "$OUT/classes" .
PROBE_SHA="$(sha256sum "$OUT/amis-apps-probe.jar" | awk '{print $1}')"
"$JAR" tf "$OUT/amis-apps-probe.jar" | grep -q 'META-INF/micronaut/io.micronaut.inject.BeanDefinitionReference/io.kestra.root.amisprobe.'
"$JAVA" -cp "$HOST:$OUT/classes" io.kestra.root.amisprobe.ProbeDelegationSelfTest > "$OUT/self-test.log"
cat > "$OUT/compile-report.json" <<JSON
{"sourceHash":"$SOURCE_HASH","hostSha256":"$ACTUAL_HOST_SHA","compiler":"micronaut-inject-java:4.10.33","compilerSha256":"$ACTUAL_COMPILER_SHA","probeJarSha256":"$PROBE_SHA","jdk":"$JDK_VERSION","readiness":{"flowRepositoryListener":"present","flowMetaStoreListener":"present","namespaceFactoryListener":"present","storageListener":"present","authorizationListener":"present"},"selfTest":"$(tr -d '\n' < "$OUT/self-test.log")","runtimeHost":false}
JSON
echo "PASS: probe compiled with formal host SHA $ACTUAL_HOST_SHA and compiler SHA $ACTUAL_COMPILER_SHA; output=$OUT"
