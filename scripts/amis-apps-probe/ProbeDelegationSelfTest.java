package io.kestra.root.amisprobe;
import io.kestra.core.repositories.FlowRepositoryInterface;import io.kestra.webserver.rbac.*;import java.lang.reflect.Proxy;import java.util.Optional;import io.micronaut.core.propagation.PropagatedContext;import io.kestra.core.repositories.AuthorizationInvocationContext;import io.micronaut.http.HttpRequest;import reactor.core.publisher.Mono;import reactor.core.publisher.Flux;
public final class ProbeDelegationSelfTest {
 public static void main(String[] args)throws Exception{
  var delegate=Proxy.newProxyInstance(ProbeDelegationSelfTest.class.getClassLoader(),new Class[]{FlowRepositoryInterface.class},(p,m,a)->{if(m.getName().startsWith("findById"))return Optional.empty();throw new IllegalStateException("delegate-marker");});
  var wrapped=(FlowRepositoryInterface)ProbeProxies.wrap(FlowRepositoryInterface.class,delegate,ProbeState.INSTANCE::flow);
  if(wrapped.findById("main","ns","flow",Optional.empty()).isPresent())throw new AssertionError("delegate result changed");
  try{wrapped.count("main");throw new AssertionError("delegate exception lost");}catch(IllegalStateException expected){if(!expected.getMessage().equals("delegate-marker"))throw expected;}
  int before=ProbeState.INSTANCE.flowLookup.get();ProbeState.INSTANCE.flow("findById");if(ProbeState.INSTANCE.flowLookup.get()!=before)throw new AssertionError("no-context counted");
  try(var scope=PropagatedContext.empty().plus(new AuthorizationInvocationContext(HttpRequest.GET("/company/app/pages/home"),false)).propagate()){
   ProbeState.INSTANCE.flow("findById");
   var fake=new RbacGate((io.micronaut.context.BeanProvider<RbacAuthorizer>) null){public Mono<Boolean> authorize(RbacAuthorizer.Principal p,RbacAuthorizer.Resource r,RbacAuthorizer.Action a){return Mono.just(r.kind()==RbacAuthorizer.Kind.FLOW);}public <R> Flux<R> boundary(RbacAuthorizer.Principal p,String t,java.util.function.Supplier<? extends org.reactivestreams.Publisher<R>> x){return Flux.from(x.get());}public Mono<Void> finishCurrent(){return Mono.empty();}};
   var gate=new RbacGateListener.ProbeGate(fake);if(!gate.authorize(null,new RbacAuthorizer.Resource(RbacAuthorizer.Kind.FLOW,RbacAuthorizer.Scope.NAMESPACE,"main","company","app"),RbacAuthorizer.Action.READ).block())throw new AssertionError("true delegation changed");if(gate.authorize(null,new RbacAuthorizer.Resource(RbacAuthorizer.Kind.EXECUTION,RbacAuthorizer.Scope.NAMESPACE,"main","company","id"),RbacAuthorizer.Action.READ).block())throw new AssertionError("false delegation changed");gate.boundary(null,"main",()->Mono.just("ok")).blockLast();gate.finishCurrent().block();
  }
  if(ProbeState.INSTANCE.flowLookup.get()!=before+1)throw new AssertionError("AMIS context not counted");
  var bad=java.nio.file.Files.createTempFile("amis-probe-integrity-","file");System.setProperty("amis.probe.dir",bad.toString());try(var scope=PropagatedContext.empty().plus(new AuthorizationInvocationContext(HttpRequest.GET("/company/app/pages/home"),false)).propagate()){try{ProbeState.INSTANCE.flow("findById");throw new AssertionError("write failure swallowed");}catch(IllegalStateException expected){if(ProbeState.INSTANCE.integrityFailure()==null)throw new AssertionError("integrity failure missing");}}System.clearProperty("amis.probe.dir");
  System.out.println("PASS: delegate result/cause, gate true/false/boundary/finish, no-context suppression, AMIS count, write failure rejection");
 }
}
