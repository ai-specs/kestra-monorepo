package io.kestra.root.amisprobe;

import io.kestra.core.repositories.AuthorizationInvocationContext;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

final class ProbeState {
    static final ProbeState INSTANCE = new ProbeState();
    private static final Pattern AMIS=Pattern.compile("^/[^/]+/[^/]+/(pages|schemas|assets|apis)(?:/|$)");
    final AtomicInteger flowLookup=new AtomicInteger(), flowMeta=new AtomicInteger(), schemaStorage=new AtomicInteger(), storageCalls=new AtomicInteger(), namespaceResolve=new AtomicInteger(), flowAuthorization=new AtomicInteger();
    volatile boolean flowListener, metaListener, storageListener, namespaceListener, authorizationListener;
    private volatile String integrityFailure;
    private final String generation = java.util.UUID.randomUUID().toString();
    synchronized void ready(String component) {
        switch (component) {
            case "flow" -> flowListener = true;
            case "metadata" -> metaListener = true;
            case "storage" -> storageListener = true;
            case "namespace" -> namespaceListener = true;
            case "authorization" -> authorizationListener = true;
            default -> throw new IllegalArgumentException("Unknown probe component");
        }
        write();
    }
    boolean amis(){return AuthorizationInvocationContext.currentRequest().map(r->AMIS.matcher(r.getUri().getRawPath()).find()).orElse(false);}
    void flow(String method){if(!amis())return;if(method.startsWith("find")||method.equals("count"))flowLookup.incrementAndGet();write();}
    void meta(String method){if(!amis())return;flowMeta.incrementAndGet();write();}
    void storage(String method){if(!amis())return;storageCalls.incrementAndGet();if(method.contains("get")||method.contains("list")||method.contains("exists"))schemaStorage.incrementAndGet();write();}
    void namespace(){if(!amis())return;namespaceResolve.incrementAndGet();write();}
    void authorize(io.kestra.webserver.rbac.RbacAuthorizer.Resource resource){if(!amis()||resource==null||resource.kind()!=io.kestra.webserver.rbac.RbacAuthorizer.Kind.FLOW)return;flowAuthorization.incrementAndGet();write();}
    synchronized void write(){
        try {
            Path dir=Path.of(System.getProperty("amis.probe.dir","/tmp/amis-acceptance-probe"));Files.createDirectories(dir);Path tmp=dir.resolve("counts.json.tmp");
            String json = "{\"generation\":\"" + generation + "\",\"processId\":" + ProcessHandle.current().pid() + ",\"readiness\":{"
                + "\"flowRepositoryListener\":" + flowListener + ","
                + "\"flowMetaStoreListener\":" + metaListener + ","
                + "\"storageListener\":" + storageListener + ","
                + "\"namespaceFactoryListener\":" + namespaceListener + ","
                + "\"authorizationListener\":" + authorizationListener + "},"
                + "\"flowLookup\":" + flowLookup + ",\"flowMeta\":" + flowMeta
                + ",\"schemaStorage\":" + schemaStorage + ",\"storageCalls\":" + storageCalls
                + ",\"namespaceResolve\":" + namespaceResolve + ",\"flowAuthorization\":" + flowAuthorization
                + ",\"integrity\":\"" + (integrityFailure == null ? "ok" : "failed") + "\"}\n";
            Files.writeString(tmp,json,StandardCharsets.UTF_8);Files.move(tmp,dir.resolve("counts.json"),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        } catch(IOException failure){integrityFailure=failure.toString();throw new IllegalStateException("Probe count integrity write failed",failure);}
    }
    String integrityFailure(){return integrityFailure;}
}
