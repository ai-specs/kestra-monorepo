# RBAC UI 授权契约

> UI 行为基线：应用组目标模型优先于本文中与旧应用项目或旧恢复流程有关的描述。实现新页面前必须先核对根仓 `docs/application-group-target-model.md`。

## 状态

本文定义目标架构与审查条件。版本化 typed SPI、宿主 REST/查询/owner 适配、
Dashboard 每个实际查询授权和独立插件策略已发布。当前组合的本地真实浏览器与根仓
CI 覆盖记录见 `docs/rbac-acceptance.md`。插件已删除旧路径分派实现。
请求来源传播、上下文缺失失败关闭与 Execution graph 展开目标 owner 检查已加入
宿主探针及实际组合验收。后台来源由宿主入口明确声明，不能仅凭缺少 HTTP 上下文判断。
验收记录只证明其中列明的行为；本文未被对应探针或组合测试证明的条目仍须审查，
不得将 CI 全绿解释为任意上游路由、后台调用或第三方 datasource 已支持。

## MCP 服务页面的权限要求

本节记录已明确的部署需求。适用条件为 RBAC 与类型化授权均开启、授权插件已装载。
“受限用户”指已有有效角色映射和资源权限的用户，不包含角色无映射且无用户身份绑定的
零授权用户。“实例管理员”指通过扩展策略明确获得实例管理权限的用户。

| 页面 | 有权限的受限用户 | 实例管理员 |
|---|---|---|
| `/ui/main/admin/mcp-servers` | 可以查看服务列表 | 可以查看和管理 |
| `/ui/main/admin/mcp-servers/edit/default/edit` | 可以查看；不得保存配置或开启/关闭服务 | 可以修改、保存和开启/关闭 |
| `/ui/main/admin/mcp-servers/edit/default/connect` | 可以查看和使用连接说明；页面无额外配置变更操作 | 可以查看和使用 |
| `/ui/main/admin/mcp-servers/edit/default/tool-flows` | 可以查看，只显示其 Flow 授权命名空间中的数据 | 可以查看完整授权范围 |

页面位于 `admin` 路径下，不代表全部读取需要实例管理权限。页面可见不代表配置写入获准。
当前界面可能显示编辑控件；服务端必须拒绝受限用户的配置变更，并保持原配置不变。
使用连接说明不授予工具执行权限。MCP 工具调用仍须同时通过 OAuth 能力范围和实际资源
RBAC 检查。零授权用户仍须进入独立拒绝页面，并可以退出换号。

当前实现与配置的对应关系：

- 服务列表与配置读取使用 `MCP_SERVER` 的租户级 READ/LIST 权限。主部署普通角色和
  multi 角色仅配置服务只读权限，不配置服务 CREATE/UPDATE/DELETE 权限。
- 保存和开启/关闭经过配置 UPDATE 授权。当前部署只授予实例管理员相关权限。
- 工具列表实际读取 Flow，必须使用完整 Flow 查询授权，并在查询和数量计算前应用
  Flow 授权范围。不得因服务配置可读而返回全局工具列表。

对应实现为 overlay 的 0260/0300 补丁、根仓 `docker-compose.yml`、
`scripts/blackbox-namespace.mjs` 和 `scripts/blackbox-namespace-ui.mjs`。
版本证据见 `docs/rbac-acceptance.md`。后续修改必须保留上述权限边界，并重新检查页面
读取、修改拒绝及配置不变、工具数据范围和零授权用户退出行为。

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
