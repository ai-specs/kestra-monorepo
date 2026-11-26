package io.kestra.root.amisprobe;

import io.kestra.core.repositories.AuthorizationInvocationContext;
import io.kestra.webserver.rbac.AuthorizationEvaluationProviderV2;
import io.kestra.webserver.rbac.AuthorizationUnavailableException;
import io.micronaut.core.propagation.PropagatedContext;
import io.micronaut.http.HttpMethod;
import io.micronaut.http.HttpRequest;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicInteger;
import io.micronaut.context.ApplicationContext;
import reactor.core.publisher.Mono;

public final class OwnedFaultSelfTest {
    public static void main(String[] args) throws Exception {
        var overlap = new OwnedFaultRouteProvider("overlap", "owned-fault");
        if (overlap.match(HttpMethod.GET, "/company.amis/app/pages/home").isEmpty()) throw new AssertionError("AMIS metadata not matched");
        for (HttpMethod method : HttpMethod.values())
            if (overlap.match(method, "/company.amis.child/app/apis/run").isEmpty()) throw new AssertionError("method metadata not matched");
        if (overlap.match(null, "/company.amis/app/pages/home").isPresent() || overlap.match(HttpMethod.GET, null).isPresent()) throw new AssertionError("null metadata matched");
        for (String path : new String[]{"/company.amis2/app/pages/home", "/company.other/app/pages/home", "/company.amis/app/assets/../secret", "/company.amis/app/pages/%68ome", "/company.amis/app/pages//home", "/company.amis/app/pages/home?x=1"})
            if (overlap.match(HttpMethod.GET, path).isPresent()) throw new AssertionError("non-owner or malformed path matched");
        for (String mode : new String[]{null, "", "unknown"}) {
            try { new OwnedFaultRouteProvider(mode, "owned-fault"); throw new AssertionError("invalid mode accepted"); }
            catch (IllegalArgumentException expected) { }
        }
        for (String id : new String[]{null, "", "bad.id", "../bad"}) {
            try { new OwnedFaultRouteProvider("overlap", id); throw new AssertionError("invalid ID accepted"); }
            catch (IllegalArgumentException expected) { }
        }
        for (String path : new String[]{"/api/v1/main/flows", "/ui/", "/oauth/login/kestra", "/oidc/login", "/static/app.js", "/favicon.ico", "/api/app/pages/home", "/ui/app/apis/run", "/oauth/app/pages/home", "/company/app/assets/../secret", "/company/app/pages/%68ome"})
            if (overlap.match(HttpMethod.GET, path).isPresent()) throw new AssertionError("reserved path matched");
        if (!new OwnedFaultRouteProvider("duplicate-id", "ignored").id().equals("amis-apps")) throw new AssertionError("duplicate ID not selected");
        try { new OwnedFaultRouteProvider("throw-match", "owned-fault").match(HttpMethod.GET, "/company.amis/app/pages/home"); throw new AssertionError("match fault absent"); }
        catch (IllegalStateException expected) { if (!expected.getMessage().equals("owned-match-fault")) throw expected; }
        var calls = new AtomicInteger();
        var marker = new IllegalStateException("delegate-marker");
        AuthorizationEvaluationProviderV2 delegate = (identity, tenant) -> { calls.incrementAndGet(); return CompletableFuture.failedFuture(marker); };
        var wrapped = OwnedUnavailableAuthorizationListener.decorate(delegate);
        try { wrapped.begin(null, "main").toCompletableFuture().join(); throw new AssertionError("delegate failure absent"); }
        catch (CompletionException expected) { if (expected.getCause() != marker) throw expected; }
        if (calls.get() != 1) throw new AssertionError("delegate not called exactly once");
        try (var scope = PropagatedContext.empty().plus(new AuthorizationInvocationContext(HttpRequest.GET("/company.amis/app/apis/run"), false)).propagate()) {
            try { wrapped.begin(null, "main").toCompletableFuture().join(); throw new AssertionError("unavailable absent"); }
            catch (CompletionException expected) { if (!(expected.getCause() instanceof AuthorizationUnavailableException)) throw expected; }
        }
        if (calls.get() != 1) throw new AssertionError("fault request delegated");
        try { Mono.from(overlap.handle(HttpRequest.GET("/company/app/pages/home"), new io.kestra.webserver.rbac.HttpExtensionRouteProviderV1.Target("company"))).block(); throw new AssertionError("handler allowed"); }
        catch (IllegalStateException expected) { if (!expected.getMessage().equals("owned-fault-handler-must-not-run")) throw expected; }
        try (var scope = PropagatedContext.empty().plus(new AuthorizationInvocationContext(HttpRequest.GET("/api/app/pages/home"), false)).propagate()) {
            try { wrapped.begin(null, "main").toCompletableFuture().join(); throw new AssertionError("delegate failure absent"); }
            catch (CompletionException expected) { if (expected.getCause() != marker) throw expected; }
        }
        if (calls.get() != 2) throw new AssertionError("reserved request not delegated");
        AuthorizationEvaluationProviderV2 synchronousFailure = (identity, tenant) -> { throw marker; };
        try { OwnedUnavailableAuthorizationListener.decorate(synchronousFailure).begin(null, null); throw new AssertionError("synchronous failure absent"); }
        catch (IllegalStateException expected) { if (expected != marker) throw expected; }
        var completed = CompletableFuture.<io.kestra.webserver.rbac.AuthorizationEvaluationV1>completedFuture(null);
        if (OwnedUnavailableAuthorizationListener.decorate((identity, tenant) -> completed).begin(null, null) != completed)
            throw new AssertionError("delegate stage replaced");
        try { OwnedUnavailableAuthorizationListener.decorate(null); throw new AssertionError("missing delegate accepted"); }
        catch (NullPointerException expected) { }
        try { new OwnedDuplicateAuthorization().begin(null, null).toCompletableFuture().join(); throw new AssertionError("duplicate allowed"); }
        catch (CompletionException expected) { if (!(expected.getCause() instanceof IllegalStateException)) throw expected; }
        try (var context = ApplicationContext.builder().deduceEnvironment(false).build()) {
            for (Class<?> type : new Class<?>[]{OwnedFaultRouteProvider.class, OwnedDuplicateAuthorization.class, OwnedUnavailableAuthorizationListener.class}) {
                var reference = (io.micronaut.inject.BeanDefinitionReference<?>) Class.forName(type.getPackageName() + ".$" + type.getSimpleName() + "$Definition").getDeclaredConstructor().newInstance();
                if (reference.isEnabled(context)) throw new AssertionError("fault bean active by default: " + type.getSimpleName());
            }
        }
        System.out.println("PASS: AMIS metadata, reserved paths, duplicate ID, throw-match, delegate exception identity, classified unavailable");
    }
}
