# 流式响应授权与 MCP 会话生命周期修复任务书

日期：2026-11-13，更新2026-11-14。状态：P1/P2已正式交付；P3已按有效正例核对未复现泄露；P4宿主修复、独立插件消费与根仓生产组合验收已完成；P5/P6尚未实施。
接收方：后续修复 AI。交付后由主控独立复核源码、产物与生产组合。

## 1. 目标与阅读顺序

解决已确认的测试会话清理缺口，并调查本轮 SSE 修复未证明的长连接与延迟读取边界。
必须先复现、独立归因，再选择最小修复；不得按接口清单一次性批量套用 SSE helper。
本文用于跨仓任务划分和组合验收；所属仓业务设计及宿主扩展提案仍写入所属仓文档。

开始前完整阅读三仓 AGENTS.md 和 README，再读以下入口：

- 根仓 `docs/rbac-first-account-consistency-issues.md`：原缺陷、纠正后的授权口径和后续范围。
- 根仓 `docs/rbac-ui-contract.md`、`docs/rbac-onboarding-experience.md`：公开消费和生产首装边界。
- overlay `docs/r-ee-rbac.md`、`docs/r-oidc-server.md`、`docs/extension-mechanisms.md`、
  `docs/oss-ee-gap.md`：既有机制、接收规则与已发布授权契约。
- plugin `docs/authorization-flow.md`、`docs/application-groups.md`、`docs/management-api.md`：
  身份、权限、scope 交集、目录版本、撤权及管理操作。路径变化时查找当前替代文档。

第一项动作：读取规则后提交只读调查表，列出SA-01/02实际调用链、POST取消与DELETE终止差别、
当前session登记/移除/心跳路径，并给出阶段一最小红例；完成该表后才开始实现。

先核对三仓 Git、远端、submodule、用户修改和当前正式输入。本文基线仅用于复现和比较，
不是要求回退仓库。后续新提交优先按实际契约复核，不直接套用旧行号或旧测试数量。

## 2. 2026-11-14 当前执行状态

- P1/P2已按 `05ae6b1` / CI `43524119358` 完成根仓组合验收；MCP会话显式DELETE、异步关闭、资源释放和告警归零已核对。
- P3使用同一A-only生产连接取得有效正例：A命名空间15个事件可达，C命名空间0个事件，C执行直接GET为403；数据库存在A→C拓扑边。`AbstractJdbcFlowTopologyRepository.topologyAccess()`同时过滤source/destination，未授权依赖在图查询前移除，未复现泄露。
- P4复现旧正式输入的真实缺陷：撤权提交75.642秒后已打开execution SSE仍收到5个后续事件。宿主`95863ec` / CI `43552415541`在共享SSE授权入口增加策略快照守卫，空闲流和延迟事件在快照拒绝时终止；正式镜像digest `7bef038e2383bae6b3c01ea381b8e0abd822d66da6a7727a02eb71686e071304`，executable SHA-256 `5b730a3f153674e05952776cff3c5c4a6bb92ff45a6d93bf1e292a35c28aeb73`。
- 插件`189206c` / CI `43575563419`已消费上述正式宿主输入并独立发布；jar SHA-256保持 `42b901a4b51ea53b9540aeeb87a7056ee7a223ff2ca286aee14265bbdda4bb0c`。根仓在`rest-subject-revoke`中同时打开execution与logs SSE：两条连接均在59.741秒终止，重连均为403，撤权后事件为0，测试执行与流程资源恢复成功。干净根仓本地new-install验收通过REST56、必需集成50、生产UI88，失败/跳过/未运行均为0。
- P5 CSV延迟正文与P6 AI/MCP长会话仍未实施；不得因P4交付宣称全部专项完成。

## 2. 已验证基线与证据入口

| 仓库 | 基线提交 | 成功 CI |
| --- | --- | --- |
| root | `64d4a862d6b18dcd7169090a9bd3dda71f4aabe7` | [43259252494](https://github.com/ai-specs/kestra-monorepo/actions/runs/43259252494) |
| overlay | `c3fe84866280095d1bd218f110a682b5cd502089` | [43202366854](https://github.com/ai-specs/kestra-overlay/actions/runs/43202366854) |
| plugin | `a4a725c6590667c245b877fffb6739ca4c8353a6` | [43213408320](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/43213408320) |

正式镜像：`ghcr.io/ai-specs/kestra-overlay@sha256:5e7f2736b228fc993b911a10afa6670b584e978cb7c38553edf232ca519db721`。
正式 jar SHA-256：`42b901a4b51ea53b9540aeeb87a7056ee7a223ff2ca286aee14265bbdda4bb0c`。
arm64 executable SHA-256：`7185552b17cbcc567d7f6d2425bb3604621f92af2cd6a32a98a9c0f01a28d72d`。
双架构 provenance 的提交/run 已核对，`completeness=false` 限制保留。

最终 root artifact 名 `compose-acceptance-43259252494-1`，ID `13966124254`。
插件 artifact 名 `kestra-rbac-authorizer`，ID `13943781507`。可通过有权限的 `gh run download`
读取；正式 README 提供 jar 的具体目录。不得假定另一个克隆存在本机 `.work`。

本地参考证据在根 `.work/first-account-consistency/`：

- `root-final-head/audit.json`、`checker.log`、`artifacts/`：最终提交报告及下载后检查。
- `feeds-host-final/`：宿主正式报告、registry、provenance、提取 executable。
- `plugin-feeds-published/`：正式插件报告与 jar。
- `mcp-keepalive-review.md`：会话告警初查，本文已吸收其正式需求。
- `final-monaco-failed03/`、`final-monaco-failed04/`：生产资讯异常原始失败证据。
- overlay `.work/first-account-20261111/next-iteration/stream-authorization-follow-up.md`：
  原始静态反查，本文取代它作为正式专项入口。

前次成功证明 new-install、REST56、必需集成50、生产UI88、144项交付检查通过，
并审计 plugin UI840、host认证UI156、SDK949、几何64。不能据此宣称下列长连接专项通过。
schema2 declaration-upgrade PostgreSQL8项已审计；schema1/旧凭据/物理回滚属 legacy-migration，
未在默认profile执行。修复方必须报告实际新矩阵，不把历史数量当成可删减或永不变化的目标。

## 3. 事实、假设与禁止误判

| ID | 当前结论 | 尚缺证据 |
| --- | --- | --- |
| SA-01 | 已确认 root MCP 测试没有显式 DELETE 自建 session，最终依赖容器销毁回收 | 逐 session 终止、撤权后终止语义、两个周期的资源释放回归 |
| SA-02 | 实际日志周期重复 `KeepAliveScheduler ... Stream unavailable for session`；不是只有一次短暂取消 | 七个日志 ID 与场景逐一关联；宿主无监听流的保活/过期契约；堆内资源是否持续增长 |
| SA-03 | SSE helper 在订阅源建立新授权评估，不自动证明连接期间撤权 | 生效时限契约、撤权后新事件实际投递结果 |
| SA-04 | 依赖流入口授权父 execution，关联资源链需反查 | 未授权子 execution/flow/输出是否真的到达订阅者，不能仅凭内部读取认定泄露 |
| SA-05 | CSV 延迟查询不经过 SSE 包装 | 真实HTTP正文订阅是否丢上下文；逐行范围、慢消费和取消行为 |
| SA-06 | AI/MCP有独立异步链，不能直接套用REST helper | 正式能力激活、公开操作计划、异步副作用和长session撤权实测 |

不能把所有 HTTP200 当作流成功；响应头发出后仍可失败。不能把 DB SUCCESS 当作浏览器读到
结果。不能用首账号证明范围拒绝：首账号明确 BUSINESS_INSTANCE grants 可能赋予广泛业务能力。
`company`及其子空间是模式A/B共同测试输入，不是首账号权限上限。未知API403保持失败关闭，
不得为“模式一致”放宽路径或将猜测URL的403当成真实UI缺陷。

## 4. 本轮 SSE 修复的机制与可借鉴边界

### 2026-11-13 MCP 生命周期的上游来源核对

root未显式DELETE测试session属于本仓测试缺口。宿主的全local session保活、
异步delete返回值未订阅、旧GET无条件注销三项关键结构已存在于固定BASE原始源码；
0170的RBAC身份适配改变了删除匹配方式，须验证叠加行为，不能将宿主问题全归定制引入。

上游 [891fb2261f57 / #18585](https://github.com/kestra-io/kestra/commit/891fb2261f57c6ee757598cd3c37414a720a3661)
修复context关闭时scheduler shutdown，固定BASE源码已具备其doFinally与PreDestroy机制。
它不证明运行期间POST-only、DELETE关闭或GET重连问题已解决。
实际读取的上游默认分支为develop，核对HEAD为
`2b128aeadfe318632bf86dd76790557faf0e8366`；另核对正式标签v2.0.10（2026-11-10发布）。
两者session/provider源码仍保留上述三项关键结构；v2.0.10的platform仍固定SDK1.1.3。
最新相关 [ec3d99318878 / #22196](https://github.com/kestra-io/kestra/commit/ec3d99318878)
是session ID和仓库键重构，不等于本专项释放修复。
这是源码与版本核对，不冒称已部署上游v2.0.10运行全部红例。

因此当前不能以“后续升级即可解决”跳过已复现问题。后续升级必须对具体目标版本重跑
同组生命周期回归，满足功能与公开身份契约后才移除等价补丁；不把整个上游升级混进本轮修复。

固定上游 BASE 为 `172dd0f3760fb1255d3b22bd1fd07ce31b173fa3`（v2.0.5），必须重新核对当前 BASE。
Micronaut 4.10.28 的 `RouteExecutor.processPublisherBody` 会为正文绑定响应构造时的旧
`PropagatedContext`。只在外层 filter/Publisher 建新 evaluation，可能被正文包装的旧上下文
覆盖；本轮早期候选单测与本地构建通过，但真实 Ego 新建保存执行仍失败，这个方案已废弃。

已发布实现位于 overlay：

- `patches/webserver/0330-authorization-evaluation-lifecycle.patch`：
  `SseAuthorization`、`AuthorizationEvaluations`、`TypedAuthorizationGate`、
  `ExecutionFollowContextTest`；HTTP入口在所有操作决策和查询域交集后记录 `restPlan`。
- `SseConnectionMetrics.track` 是 execution/logs/dependencies 的共享流源激活点。
  `SseAuthorization.bind` 捕获不可变 principal、tenant、操作计划和HTTP来源，在流源订阅内
  `gate.boundary` 重新授权；不捕获旧 owner/JDBC connection/transaction。
- `0260-rbac-typed-host-adapter.patch`：`OssRestOperationAdapter` 的实际操作与资源解析。
- `0393`执行通知补丁：真实401/403/404与网络失败区分、恢复/卸载清理、通知所有权。
- `0394` Monaco兼容、`0395`可选资讯调用边界是组合发现的独立缺陷，不是授权放宽。

`ExecutionFollowContextTest`已有12项，包括真实控制器/ACL、旧上下文框架包装、订阅前撤权、
取消释放、logs/dependencies、缺来源和关闭功能。修复方先核对原测试，再增加不被覆盖的红例。
仅测试裸 `HttpResponse.ok(Flux)` 不足以复现生产问题。不能再次用外层包装“修复”覆盖内层上下文。

## 5. 分阶段任务与进入/退出条件

2026-11-13 主控实施拆分：下列主题保留原SA标识，实际按六个独立交付单元推进：
P1仅root测试客户端显式终止；P2宿主MCP保活/异步关闭；P3依赖流关联资源范围；
P4执行/日志持续撤权；P5 CSV延迟正文；P6 AI与MCP长会话专项。
本文后面的四组主题说明是调查与验收细则，不要求同组内容同时修改或同时发布。
P1不依赖P2先修，P3/P4分别取得红例和契约后实施。若先证实真实数据泄露则立即提高优先级。
每单元必须独立交付；未复现项归档证据，不因阶段名称存在就制造代码修改。

阶段顺序由已知缺口和风险确定；每阶段先交付可核验结果，再进入下阶段。后续静态疑点
不得伪装为前一阶段未完成。若实测暴露真实授权泄露，立即报告并调整优先级，不能为保进度隐藏。
不要求为每阶段制造三个仓提交；无必要改动的仓库只核实既有正式输入兼容。

### 阶段一：MCP 测试会话终止与宿主保活复现（SA-01/02）

目标：先修已确认的 root 客户端清理缺口，同时取得宿主告警可重复证据。
允许root修改测试客户端、MCP场景、报告检查器和契约说明；宿主只先调查，不改插件策略。

当前入口：root `scripts/production-oauth-client.mjs` 的 `rpc()`，
`scripts/application-project-mcp-cases.mjs` 的 `session()`、`revoked`及 `finally`。
`rpc()`读到匹配JSON-RPC响应后 `reader.cancel()`，这只关闭该POST正文，不等于终止会话。
当前finally恢复管理变更，没有MCP终止。测试报告sessions未保留足够的session关联生命周期。

宿主重放源码用 `rg --files` 定位 `KestraFluxStreamableServerTransportProvider`、
`McpSessionService`、`McpServerHandlerTransport`、`McpToolController`。源码一般在
`webserver/src/main/java/io/kestra/mcp/`与controllers下，不能猜包路径。SDK版本从实际锁定
依赖取得，查看 `KeepAliveScheduler`、`McpStreamableServerSession`；不要复制网上最新实现。
GET listening stream的dispose与deregister、DELETE的session close/删除广播、本地集合移除、
transport关闭与scheduler shutdown必须分别追踪。

建议最小实现：

1. 客户端新增显式终止方法，使用该session的真实原身份、同协议版本和真实DELETE端点。
   区分POST流取消、GET监听断开、DELETE终止；从当前宿主契约核对成功码，不凭记忆写死。
2. 所有初始化成功的session立即登记到本轮私有清理清单，包括中途断言失败和缺组件场景。
   清理放finally，逐个有界等待、尝试全部清理，记录失败且不覆盖原失败；不能整体吞错。
3. 撤权用例先完成原始拒绝/无副作用断言，再按既有恢复流程恢复策略，重新核实原主体可信身份，
   尝试原会话终止。若契约拒绝旧身份或已失效session，记录实际状态并验证宿主过期/移除路径。
   不使用管理员、伪造身份或临时放宽策略绕过原拒绝断言。无恢复条件的场景必须明确处置规则。
4. 报告记录场景到session的脱敏稳定关联、创建/取消/终止时间、状态、旧session后续请求结果，
   及终止后至少两个保活周期是否仍ping。不得提交token/cookie/密码；完整session标识仅留私有证据。
5. 单独复现 initialize→POST完成→无GET流→等待；再对照GET监听、取消/重连和显式DELETE。
   若宿主确有不符合公开契约的持续心跳或泄漏，按overlay入口C最小修复；需新契约则入口B提案。

不能直接在ping失败时删除session：无GET流可能是协议允许的正常状态，后续POST/恢复可能仍需它。
不能只降低WARN、关闭所有keep-alive、缩短未裁决会话寿命或用容器退出证明释放。

阶段退出：客户端旧实现红/新实现绿；正常/撤权/缺组件/异常/关闭全部清理路径具名；
告警ID与场景关联；宿主保活结果分为符合契约/已复现缺陷/未复现。若改宿主则先独立发布。
没有证据证明越权，不把此阶段宣称为安全漏洞修复。

### 阶段二：执行/日志持续撤权与依赖范围（SA-03/04）

进入：阶段一交付门通过；当前公开撤权契约与维护者可调时限已核对。
先确定变更提交到停止发送的允许时限。文档中的60秒是维护者可调参数，不能宣称技术必然，
也不能把快照最大年龄直接等同连接自动断开时限。契约冲突须记录裁决依据再实施。

入口：`SseAuthorization`、`ExecutionStreamingService`、`LogStreamingService`、
`ExecutionDependenciesStreamingService`、`ExecutionController.followDependenciesExecutions`、
`OssRestOperationAdapter.ownedExecution`以及插件runtime/evaluation实现。
按当前路由核对execution/logs/follow-dependencies的真实GET及Accept，不能照旧URL猜测。

复现必须包含：A可写、B只读、C范围外；不同角色不互相包含；父执行A及子执行A/B/C。
先证明A新事件可达，再在连接保持期间撤scope、权限、组启用状态或账号资格。
使用变更提交之后新产生的事件，记录数据库提交、事件产生、发送和接收时间；排除撤权前缓冲。
分别测空闲流、持续事件、重新连接及订阅前撤权。依赖的现有终态、运行中转终态和新建子执行
均覆盖；检查图节点、namespace/flow/execution ID、输出和日志，不只检查事件数量。

若复现：优先在实际读取/投递边界重新核对当前可信身份及明确操作计划，并按真实关联资源授权。
拒绝后不得发送敏感payload；响应头已发送时按接口约定结束流，不伪造HTTP403或资源不存在。
不得长时间持有数据库事务、全局锁或旧evaluation；避免逐事件无界建连接、阻塞队列线程。
先用测试证明候选evaluation生存期、取消/异常释放恰好一次、subscriber/指标回落和其他账号不受影响。
是否复用helper以实测和契约为准；不得简单复制REST快照到队列线程或用父授权代替子授权。

退出：范围允许/拒绝、订阅前后撤权、关联资源、异常/取消/重连、缺组件/关闭全部具名通过；
未复现项提交证据结论，不制造无必要改动。公开新机制必须由overlay先发布。

### 阶段三：CSV 延迟正文（SA-05）

入口：`ExecutionController.exportExecutions`、`executionRepository.findAsync`与query domain。
核对 `GET /api/v1/{tenant}/executions/export/by-query/csv` 当前正式路由及流类型。
先真实HTTP构造响应已返回、正文延迟消费，模拟Micronaut旧上下文包装；对照正常/空/多批数据。
每行、总数和关联字段必须只含授权范围，覆盖精确资源ID、namespace子树、慢客户端、取消，
以及订阅前/导出期间撤权。先确定导出是已授权快照还是持续查询，再决定撤权预期。

仅在复现同类缺陷后考虑通用延迟正文授权入口；不把CSV挂到SSE指标类，不改变CSV格式，
不预取全库后前端过滤，不用WithoutAcl或全量内存缓存绕过repository授权。
退出：真实HTTP红绿及范围/多批/取消/释放矩阵通过；未复现则证据归档，不宣称修复。

### 阶段四：AI 与 MCP 长会话专项（SA-06）

AI先确认正式版本是否激活和公开操作计划。源码存在不等于支持。核对
`AiAgentController.chat/confirm/stream`、agent principal、orchestrator及工具实际调用。
覆盖chat、approve/reject、重复确认、取消与异步工具写入；比较线程、消息、execution、存储
及队列前后状态。流源授权不能保护已经在返回前发生的 `tryMarkRunning` 等写入。

MCP沿现有独立身份、协议scope、typed业务授权与输出链，覆盖长session、等待期间撤权、
工具列表/提交/输出/重连。不得因传输同为SSE就复用REST owner或跨协议身份。
此阶段若需新能力支持，先写所属仓设计，不在root创造宿主/插件业务模型。
退出：能力范围明确，激活/关闭/缺组件及允许/拒绝/撤权/无副作用门通过；未支持能力明确排除原因。

## 6. 每阶段共同测试与交付规则

修复方必须给出“需求ID→真实触发→当前失败→所属仓→契约→红绿测试→发布门→状态”表。
每个缺陷先交付原实现失败证据，再修改；不能让测试只镜像实现或只证明调用过mock。
并发、异步与取消测试必须有有界超时和可观察完成条件，不用固定sleep代替副作用证明。

- overlay：真实框架上下文、operation/query交集、释放及独立最小探针；执行所属仓要求的
  结构、重放、全触达字节一致、完整相关local-ci及镜像门。不得读取插件源码或构建插件。
- plugin：仅在需要策略或消费调整时修改；独立克隆使用已发布宿主编译jar，核对薄jar/SPI、
  PostgreSQL、生命周期与对应真实浏览器门。不得消费相邻开发树、未发布jar或候选镜像。
- root：正式镜像+jar，生产登录/真实点击/保存读回/允许拒绝/撤权refresh/无副作用/退出换号。
  不重复独立仓完整主题/抽屉矩阵，但必须下载匹配提交的正式报告并核对具名矩阵与hash。

浏览器优先Ego，先读skill；本地与CI复用同一业务断言和角色矩阵。中文英文完整流程，其他语言
检查key/非空/插值。页面错误须关联source document/frame/request，旧文档取消只按具体证据
分类，不能整体忽略console。保留失败用例、截图、事件、最终ID顺序及输入/结束hash。

发布固定顺序：overlay必要改动→独立CI/正式镜像；plugin消费正式输入→独立CI/jar；
root选择正式组合→本地生产验收→最终提交CI→实际下载审计。无必要改动的仓不制造发布。
CI失败先下载日志报告归因，再相关本地复测，不盲重跑，不删断言；外部DNS/上传故障与业务失败
分开记录。zsh可使用 `proxy_on` 重试受影响网络请求，不输出凭据。

默认只一个主Compose和一个PostgreSQL，辅助缺组件用例按需隔离数据库。资源带owner标签，
按owner清理；保留`.work`/正式jar，不清用户数据。当前用户8080保留部署和未跟踪
`docker-compose.override.yml`不可改作测试现场；`.env.bak-round-ap`禁止读取/改动/删除/提交。
临时防睡眠可用进程级caffeinate，不修改系统设置。正式测试输入运行中不得重建覆盖。

## 7. 修复方交付格式与后续独立验收

每阶段交付一份所属仓正式记录，包含以下内容，不能只回复“已完成”：

1. 实际三仓HEAD/远端/工作树；已保护的用户修改；本阶段ID及未处理项。
2. 契约与归因结论：已复现/符合契约/未复现/证据不足，静态观察不得计漏洞。
3. 精确修改文件与最小理由；原实现红例、新实现绿例；真实框架/浏览器证据。
4. 测试命令、profile、具名ID、总数、失败/错误/跳过/未运行及原因；CI对应最终提交。
5. 实际下载的正式报告、镜像digest、jar SHA、provenance与限制；root选用组合一致。
6. session/subscriber/evaluation/connection/scheduler资源前后结果和清理证据；无敏感值。
7. 当前README能否从零执行；仍待验证的风险和下一阶段进入条件。

主控收到后重新读取规则与需求，亲自审查diff，按正式产物重新复现原缺陷及允许/拒绝场景，
核对撤权时序、取消释放和真实副作用，下载最终CI报告，不采用子agent口头通过。
修复方不得替主控作最终验收裁决，也不得以本文设计建议取代实际调查。
