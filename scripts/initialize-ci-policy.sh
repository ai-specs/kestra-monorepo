#!/usr/bin/env bash
initialize_ci_policy() {
  compose run --rm --no-deps --entrypoint java \
    -e RBAC_POLICY_JDBC_URL=jdbc:postgresql://postgres:5432/kestra \
    -e RBAC_POLICY_JDBC_USER=kestra -e RBAC_POLICY_JDBC_PASSWORD=local-ci-only \
    -e RBAC_POLICY_OPERATOR_SUBJECT=tester \
    -v "$TEMP_DIR/policy.json:/tmp/ci-policy.json:ro" kestra \
    -cp /app/kestra:/app/libs/kestra-rbac-authorizer.jar \
    io.kestra.extensions.rbac.store.PolicyImportCommand initialize /tmp/ci-policy.json
}
