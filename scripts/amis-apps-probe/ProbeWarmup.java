package io.kestra.root.amisprobe;

import io.kestra.webserver.rbac.RbacGate;
import io.micronaut.context.annotation.Context;
import io.micronaut.context.annotation.Requires;

@Context
@Requires(property = "amis.acceptance.probe.enabled", value = "true")
public final class ProbeWarmup {
    public ProbeWarmup(RbacGate gate) {
        java.util.Objects.requireNonNull(gate);
    }
}
