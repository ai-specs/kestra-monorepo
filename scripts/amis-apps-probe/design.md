# AMIS P0 首门零 lookup probe 设计

## 目标

为根仓生产组合提供 root-owned 读取次数证据。Probe 只装载到 host BeanContext，使用公开 API；不读取插件源码、私有 RBAC 表，不增加 HTTP 端点，不改变许可结果。

## 计数

- `flowLookup`：`FlowRepositoryInterface` 上执行查找或 count 方法，且当前可信 request 的 raw path 是 AMIS namespace/flow 路径。
- `flowMeta`：同一请求下的公开 `FlowMetaStoreInterface` 调用。
- `schemaStorage`：同一请求下 `StorageInterface` 名称含 get/list/exists 的调用；不是任意数据库读取次数。
- `storageCalls`：所有 AMIS 请求下的 StorageInterface 代理调用总数。
- `namespaceResolve`：同一请求下的公开 `NamespaceFactory.of` 调用。
- `flowAuthorization`：同一请求下公开 `RbacGate.authorize` 的 FLOW 操作；由同类型装饰器完全委托原 gate，不能改变许可。

Probe 只在 `AuthorizationInvocationContext.currentRequest()` 存在且路径匹配 `/{namespace}/{flow}/(pages|schemas|assets|apis...)` 时计数。代理始终调用原 bean；异常、返回值、顺序和许可结果不改变。

## 发现与报告

- `@Singleton` + `@Requires(property="amis.acceptance.probe.enabled", value="true")` bean-created listeners。
- 接口 listener 返回相同公开接口的 JDK proxy；NamespaceFactory/RbacGate 使用仅完全委托公开方法的同类型装饰器。反射调用解包 InvocationTargetException，保留原异常类型，不替换 host jar 字节。
- 每个 listener 实际装载后写 readiness。每次 JVM 启动有独立 generation；缺 readiness、写入失败、代次改变或正控制未使计数增加时，不能将报告里的零值作为首门证据。
- 计数写 `/tmp/amis-acceptance-probe/counts.json`，目录不存在时创建；写入采用临时文件后原子替换。
- `ProbeAgent.premain` 仅调用 `Instrumentation.appendToSystemClassLoaderSearch` 追加自身 jar；它不改 host 类。
- `compile.sh` 要求显式提供正式 host executable 路径及 SHA-256，使用独立固定 Micronaut 注解处理器及其 SHA-256。JDK25 来自 JAVA_HOME 或 PATH；输出必须为新建根仓 `.work` 目录。编译不运行宿主 Gradle，不读取相邻源码、开发树或 AMIS 插件。

## 限制

这是 root-owned BeanContext/代理计数探针。自测只证明委托与计数规则，不能代替真实组合。
根仓必须在已发布正式组合中先执行允许调用，确认对应计数实际增加，再比较拒绝请求的
前后差值；readiness 本身不能代替这个正控制。真实身份、策略、页面、资产和 execution
结论仍由根仓生产组合门提供。故障类由独立 `amis.acceptance.fault.*` 开关控制，默认关闭；
它们只制造受控拒绝，不提供授权允许结果，不得装入用户正式部署。
