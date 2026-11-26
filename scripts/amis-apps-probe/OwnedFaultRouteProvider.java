package io.kestra.root.amisprobe;

import io.kestra.webserver.rbac.HttpExtensionRouteProviderV1;
import io.micronaut.context.annotation.Requires;
import io.micronaut.context.annotation.Value;
import io.micronaut.http.HttpMethod;
import io.micronaut.http.HttpRequest;
import io.micronaut.http.MutableHttpResponse;
import jakarta.inject.Singleton;
import java.util.Optional;
import org.reactivestreams.Publisher;
import reactor.core.publisher.Mono;

@Singleton
@Requires(property="amis.acceptance.fault.route.enabled", value="true")
public final class OwnedFaultRouteProvider implements HttpExtensionRouteProviderV1 {
    private final String mode;
    private final String providerId;

    public OwnedFaultRouteProvider(@Value("${amis.acceptance.fault.route.mode:}") String mode,
        @Value("${amis.acceptance.fault.route.id:}") String providerId) {
        if (mode == null || !java.util.Set.of("overlap", "duplicate-id", "throw-match").contains(mode))
            throw new IllegalArgumentException("Explicit owned fault mode required");
        if (providerId == null || !providerId.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))
            throw new IllegalArgumentException("Explicit owned fault ID required");
        this.mode = mode;
        this.providerId = providerId;
    }

    @Override public String id() {
        return mode.equals("duplicate-id") ? "amis-apps" : providerId;
    }

    static boolean metadataPath(String path) {
        if (path == null || !path.matches("/company[.]amis(?:[.][A-Za-z0-9_-]+)*/[A-Za-z0-9][A-Za-z0-9._-]*/(?:pages|schemas|assets|apis)(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*"))
            return false;
        for (String segment : path.split("/"))
            if (segment.equals(".") || segment.equals("..")) return false;
        return true;
    }

    @Override public Optional<Target> match(HttpMethod method, String path) {
        if (method == null || !metadataPath(path)) return Optional.empty();
        if (mode.equals("throw-match")) throw new IllegalStateException("owned-match-fault");
        if (!mode.equals("overlap") && !mode.equals("duplicate-id")) return Optional.empty();
        String namespace = path.substring(1, path.indexOf('/', 1));
        return Optional.of(new Target(namespace, method == HttpMethod.GET && path.contains("/pages/")));
    }

    @Override public Publisher<MutableHttpResponse<?>> handle(HttpRequest<?> request, Target target) {
        return Mono.error(new IllegalStateException("owned-fault-handler-must-not-run"));
    }
}
