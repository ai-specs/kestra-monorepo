package io.kestra.root.amisprobe;
import io.kestra.core.storages.StorageInterface;
import io.micronaut.context.annotation.Requires;
import io.micronaut.context.event.BeanCreatedEvent;
import io.micronaut.context.event.BeanCreatedEventListener;
import jakarta.inject.Singleton;
@Singleton @Requires(property="amis.acceptance.probe.enabled", value="true")
public final class StorageListener implements BeanCreatedEventListener<StorageInterface> {
 public StorageInterface onCreated(BeanCreatedEvent<StorageInterface> event){
  var wrapped=(StorageInterface)ProbeProxies.wrap(StorageInterface.class,event.getBean(),ProbeState.INSTANCE::storage);
  ProbeState.INSTANCE.ready("storage");
  return wrapped;
 }
}
