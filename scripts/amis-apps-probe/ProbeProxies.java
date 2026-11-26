package io.kestra.root.amisprobe;

import java.lang.reflect.*;

final class ProbeProxies {
    private ProbeProxies() {}
    static Object wrap(Class<?> type,Object delegate,java.util.function.Consumer<String> counter) {
        return Proxy.newProxyInstance(delegate.getClass().getClassLoader(),new Class[]{type},(proxy,method,args)->{
            counter.accept(method.getName());
            try{return method.invoke(delegate,args);}catch(InvocationTargetException failure){throw failure.getCause();}
        });
    }
}
