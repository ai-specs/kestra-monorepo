# RBAC UI 授权契约

## 状态

本文定义目标架构。当前发布的 overlay 镜像和 RBAC jar 尚未实现本文全部契约。
在本文契约发布前，插件中的路径分派代码只能作为过渡实现。它不是长期扩展接口。

## 目标

overlay 负责适配当前 OSS 版本。插件负责 RBAC 策略。Compose 负责选择兼容的镜像和 jar。

插件不得解析上游 controller 名称、handler 名称、原始 URL、前端路由或 chart YAML。
overlay 必须把已匹配并解析的宿主操作转换为 typed operation。

未知操作、未知契约版本、无法确定资源归属、身份缺失和解析异常必须拒绝。

## 类型

实现时，公开 SPI 必须提供以下语义。名称可以调整，但字段含义必须保持稳定。

```java
record AuthorizationOperation(
    int contractVersion,
    Source source,
    ResourceKind resource,
    Action action,
    String tenant,
    String namespace,
    String resourceId,
    QueryDomain queryDomain,
    Coverage coverage,
    AggregateSource aggregateSource,
    SideEffect sideEffect
) {}

record QueryDomain(
    List<String> exactNamespaces,
    List<String> namespaceSubtrees,
    List<String> excludedNamespaces,
    boolean complete,
    boolean paginated
) {}

record AuthorizationDecision(
    boolean allowed,
    QueryDomain scope,
    String reason,
    int contractVersion
) {}
```

`Source` 表示 REST、MCP、内部可信调用或 dashboard aggregate。内部调用必须由宿主明确标记。
HTTP 身份丢失不得被解释为内部调用。

`ResourceKind` 至少覆盖 FLOW、EXECUTION、NAMESPACE、LOG、METRIC、TRIGGER、KVSTORE、
NAMESPACE_FILE 和安全声明的 metadata。

`Coverage` 必须区分单资源、完整查询和完整批次。`SideEffect` 必须区分只读、存储写入、
队列写入和外部副作用。

## 宿主责任

overlay route adapter 必须：

1. 匹配当前 OSS 路由并解析输入。
2. 从实际资源或 repository 解析 tenant、namespace、resource ID 和 owner。
3. 合并实际查询过滤条件，包括 dashboard global filter。
4. 生成完整的 `AuthorizationOperation`。
5. 在 SQL、分页、count 和 aggregate 前应用插件返回的范围。
6. 在 storage、repository、queue 或外部副作用前完成全部授权。
7. 对执行操作在 runtime flow、allocated execution 和依赖确定后再次授权。

overlay 不保存本地角色名、subject binding 或 namespace grant。

## 插件责任

插件只接收 typed operation。插件负责：

- 可信主体到本地角色的映射；
- 多角色权限并集；
- exact namespace 与 namespace subtree；
- resource/action 判定；
- query scope 的交集；
- 未知值失败关闭。

插件不得根据 URL、controller、handler 或 chart 文本猜测资源。

## Dashboard

overlay 必须先解析和验证 dashboard datasource，再生成 aggregate operation。

- Execution datasource 映射为受限 Execution aggregate。
- Logs datasource 映射为受限 Log aggregate。
- Triggers datasource 映射为受限 Trigger aggregate。
- FlowDescription 映射为具体 Flow READ。
- 展示字段，例如标题、legend 和宽度，不进入授权计划。
- 自定义 SQL、表达式、外部读取和未知 datasource 必须拒绝。
- 同一个 KPI 产生多个查询时，所有查询都必须生成 operation。

插件不比较 chart ID 或 YAML 模板。宿主决定实际查询内容，插件只授权 typed aggregate。

## 升级和验收

上游 OSS 升级时，优先修改 overlay adapter 和 overlay 契约测试。插件不应因 controller、
handler 或 UI 路由重命名而修改。

交付顺序必须是：

1. overlay 增加 typed SPI、adapter 和自身探针。
2. overlay CI 通过并发布镜像。
3. 插件从发布镜像取得公开契约，独立编译、测试和发布 jar。
4. monorepo 使用固定镜像 digest 和 jar hash 执行 Compose/UI 验收。

验收必须覆盖：允许、拒绝、exact/subtree、多个角色并集、分页、count、aggregate、详情、
写操作、异步执行、MCP、身份丢失、组件缺失、未知 operation 和上游没有提供的页面。

API 通过不能代替真实 UI 验收。页面可以打开不能代替数据范围、按钮操作和副作用检查。
