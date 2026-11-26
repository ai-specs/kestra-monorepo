package io.kestra.root.amisprobe;

import io.kestra.core.repositories.AuthorizationInvocationContext;
import io.kestra.webserver.rbac.AuthorizationEvaluationProviderV2;
import io.kestra.webserver.rbac.AuthorizationUnavailableException;
import io.micronaut.context.annotation.Requires;
import io.micronaut.context.event.BeanCreatedEvent;
import io.micronaut.context.event.BeanCreatedEventListener;
import jakarta.inject.Singleton;
import java.util.concurrent.CompletableFuture;

@Singleton
@Requires(property="amis.acceptance.fault.auth.unavailable", value="true")
public final class OwnedUnavailableAuthorizationListener implements BeanCreatedEventListener<AuthorizationEvaluationProviderV2> {
    @Override public AuthorizationEvaluationProviderV2 onCreated(BeanCreatedEvent<AuthorizationEvaluationProviderV2> event) {
        return decorate(event.getBean());
    }

    static AuthorizationEvaluationProviderV2 decorate(AuthorizationEvaluationProviderV2 delegate) {
        java.util.Objects.requireNonNull(delegate, "Authorization delegate required");
        return (identity, tenant) -> {
            if (AuthorizationInvocationContext.currentRequest().map(request -> OwnedFaultRouteProvider.metadataPath(request.getUri().getRawPath())).orElse(false))
                return CompletableFuture.failedFuture(new AuthorizationUnavailableException());
            return delegate.begin(identity, tenant);
        };
    }
}
