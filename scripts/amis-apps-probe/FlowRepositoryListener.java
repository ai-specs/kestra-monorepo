package io.kestra.root.amisprobe;
import io.kestra.core.repositories.FlowRepositoryInterface;
import io.micronaut.context.annotation.Requires;
import io.micronaut.context.event.BeanCreatedEvent;
import io.micronaut.context.event.BeanCreatedEventListener;
import jakarta.inject.Singleton;
@Singleton @Requires(property="amis.acceptance.probe.enabled", value="true")
public final class FlowRepositoryListener implements BeanCreatedEventListener<FlowRepositoryInterface> {
 public FlowRepositoryInterface onCreated(BeanCreatedEvent<FlowRepositoryInterface> event){
  var wrapped=(FlowRepositoryInterface)ProbeProxies.wrap(FlowRepositoryInterface.class,event.getBean(),ProbeState.INSTANCE::flow);
  ProbeState.INSTANCE.ready("flow");
  return wrapped;
 }
}
