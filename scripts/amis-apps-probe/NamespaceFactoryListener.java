package io.kestra.root.amisprobe;
import io.kestra.core.namespace.NamespaceFileMetadataStateStore;import io.kestra.core.storages.*;import io.micronaut.context.annotation.Requires;import io.micronaut.context.event.*;import jakarta.inject.Singleton;import org.slf4j.Logger;
@Singleton @Requires(property="amis.acceptance.probe.enabled",value="true")
public final class NamespaceFactoryListener implements BeanCreatedEventListener<NamespaceFactory> {
 public NamespaceFactory onCreated(BeanCreatedEvent<NamespaceFactory> event){
  var wrapped=new ProbeFactory(event.getBean());
  ProbeState.INSTANCE.ready("namespace");
  return wrapped;
 }
 static final class ProbeFactory extends NamespaceFactory {private final NamespaceFactory delegate;ProbeFactory(NamespaceFactory delegate){super(null,null);this.delegate=delegate;}
  public Namespace of(String tenant,String namespace){ProbeState.INSTANCE.namespace();return delegate.of(tenant,namespace);}
  public Namespace of(Logger logger,String tenant,String namespace){ProbeState.INSTANCE.namespace();return delegate.of(logger,tenant,namespace);}
 }
}
