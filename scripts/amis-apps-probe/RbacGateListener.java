package io.kestra.root.amisprobe;
import io.kestra.webserver.rbac.*;import io.micronaut.context.annotation.Requires;import io.micronaut.context.event.*;import jakarta.inject.Singleton;import reactor.core.publisher.*;import java.util.function.Supplier;
@Singleton @Requires(property="amis.acceptance.probe.enabled",value="true")
public final class RbacGateListener implements BeanCreatedEventListener<RbacGate> {
 public RbacGate onCreated(BeanCreatedEvent<RbacGate> event){
  var wrapped=new ProbeGate(event.getBean());
  ProbeState.INSTANCE.ready("authorization");
  return wrapped;
 }
 static final class ProbeGate extends RbacGate {private final RbacGate delegate;ProbeGate(RbacGate delegate){super(null);this.delegate=delegate;}
  public Mono<Boolean> authorize(RbacAuthorizer.Principal p,RbacAuthorizer.Resource r,RbacAuthorizer.Action a){ProbeState.INSTANCE.authorize(r);return delegate.authorize(p,r,a);}
  public Mono<Boolean> authorize(RbacAuthorizer.Principal p,RbacAuthorizer.Resource r,RbacAuthorizer.Action a,boolean q){ProbeState.INSTANCE.authorize(r);return delegate.authorize(p,r,a,q);}
  public <R> Flux<R> boundary(RbacAuthorizer.Principal p,String t,Supplier<? extends org.reactivestreams.Publisher<R>> x){return delegate.boundary(p,t,x);}
  public Mono<Void> finishCurrent(){return delegate.finishCurrent();}
 }
}
