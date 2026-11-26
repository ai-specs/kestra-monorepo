package io.kestra.root.amisprobe;

import io.kestra.webserver.oidc.TrustedIdentityV1;
import io.kestra.webserver.rbac.AuthorizationEvaluationProviderV2;
import io.kestra.webserver.rbac.AuthorizationEvaluationV1;
import io.micronaut.context.annotation.Requires;
import jakarta.inject.Singleton;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

@Singleton
@Requires(property="amis.acceptance.fault.auth.duplicate", value="true")
public final class OwnedDuplicateAuthorization implements AuthorizationEvaluationProviderV2 {
    @Override public CompletionStage<AuthorizationEvaluationV1> begin(TrustedIdentityV1.Identity identity, String tenant) {
        return CompletableFuture.failedFuture(new IllegalStateException("owned-duplicate-authorization-must-not-run"));
    }
}
