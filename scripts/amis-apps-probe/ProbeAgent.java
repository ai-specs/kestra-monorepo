package io.kestra.root.amisprobe;
import java.io.File;
import java.lang.instrument.Instrumentation;
import java.util.jar.JarFile;
public final class ProbeAgent { public static void premain(String ignored,Instrumentation instrumentation)throws Exception{String location=ProbeAgent.class.getProtectionDomain().getCodeSource().getLocation().toURI().getPath();instrumentation.appendToSystemClassLoaderSearch(new JarFile(new File(location)));} }
