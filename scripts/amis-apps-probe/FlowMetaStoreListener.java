package io.kestra.root.amisprobe;
import io.kestra.core.runners.FlowMetaStoreInterface;
import io.micronaut.context.annotation.Requires;
import io.micronaut.context.event.BeanCreatedEvent;
import io.micronaut.context.event.BeanCreatedEventListener;
import jakarta.inject.Singleton;
@Singleton @Requires(property="amis.acceptance.probe.enabled", value="true")
public final class FlowMetaStoreListener implements BeanCreatedEventListener<FlowMetaStoreInterface> {
 public FlowMetaStoreInterface onCreated(BeanCreatedEvent<FlowMetaStoreInterface> event){
  var wrapped=(FlowMetaStoreInterface)ProbeProxies.wrap(FlowMetaStoreInterface.class,event.getBean(),ProbeState.INSTANCE::meta);
  ProbeState.INSTANCE.ready("metadata");
  return wrapped;
 }
}
