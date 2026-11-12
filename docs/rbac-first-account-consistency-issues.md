# 模式 A / 模式 B 首装用户「使用表现一致」缺陷与需求清单

- 提出日期：2026-11-11
- 适用仓库：`ai-specs/kestra-monorepo`、`ai-specs/kestra-overlay`、`ai-specs/kestra-plugin-rbac`
- 本文件最初由测试方提出；下文原始调查保留，当前实施结果以主控交付记录为准。
- 目标：模式 A（`KESTRA_RBAC_ENABLED=false`）与模式 B（`KESTRA_RBAC_ENABLED=true`）的首装首个账号，在用户可感知的操作上表现一致

## 主控交付记录（2026-11-13）

宿主 `c3fe848` / CI `43202366854` 和插件 `a4a725c` / CI `43213408320`
已通过独立发布门。正式镜像 digest 为
`sha256:5e7f2736b228fc993b911a10afa6670b584e978cb7c38553edf232ca519db721`，
jar SHA-256 为 `42b901a4b51ea53b9540aeeb87a7056ee7a223ff2ca286aee14265bbdda4bb0c`。
根仓 `2f0ce78` / CI `43235076617` 成功，实际下载报告并重新运行检查器通过。
生产组合 REST56、必需集成50、UI88，整体144项交付检查零失败/跳过/未运行。
缺jar首装12与正常首装10分别通过；真实执行流十次保存/执行/读回及终止事件通过。
schema2 declaration-upgrade 的插件 PostgreSQL 8项报告已独立核对；schema1、旧凭据与
物理回滚未在默认 new-install 执行，不计通过。

实施包含延迟 SSE 正文授权生命周期、执行错误通知语义及释放、Monaco 公开释放回调兼容，
以及生产验收发现的可选资讯请求错误边界。未改变首账号明确 grants，不按账号身份放行。
宿主453项后端中451通过、2项镜像专用跳过，另有四份镜像 XML 各1项零跳过；UI130、
SDK949、几何64通过。插件UI840与宿主认证UI156由根仓下载审计，不冒充根仓重复执行。
镜像双架构 provenance 的提交/run 匹配，completeness=false 限制保留。

根仓前次 CI 的并发 dashboard200正文取消，已按精确旧文档、请求集合及卸载导航证据分类，
新增回归继续拒绝当前文档、证据缺失、不同来源和非只读业务路径。最终367项离线回归通过。
下文候选状态是历史过程，不代表仍待发布。

## 主控独立复核历史（2026-11-11）

### 当前修复与交付门发现

执行 follow 的延迟正文订阅授权上下文与通知语义/生命周期修复，已由宿主
`77de8c5` 的成功 CI `42990293208` 发布。插件 `79c871b` 的成功 CI
`43004680245` 提供配套正式 jar。上述发布不代表根仓最终组合已经通过。

根仓提交 `d07429a` 的本地正式组合通过，但 CI `43023388148` 未通过：十次
真实创建、保存、执行、数据库成功及 SSE 结束事件均通过，诊断门发现 YAML 编辑器
`this.provider.disposeInlineCompletions is not a function`。这属于独立的宿主
Monaco 接口兼容缺陷，不能通过忽略浏览器异常解决。

宿主 `6e187bd` 将 provider 的旧 `freeInlineCompletions` 回调调整为锁定版本
要求的 `disposeInlineCompletions`，移除类型强转，并补齐 command 的 title。
新增两项回归实际执行锁定 Monaco 的引用释放代码，旧实现失败、新实现通过。
本地后端453项中451通过、2项既有镜像专项未执行；UI128通过。镜像专项另有
四份零跳过 XML，其他镜像门与 SDK949、几何64均已本地通过。
CI `43032163810` 两次尝试均因 Chromium 系统依赖的软件源 DNS 失败，在浏览器
测试执行前终止。两轮失败日志均已保存，不计为业务测试失败或通过。
宿主 `9f68d94` 将三个浏览器任务的 runner Ubuntu 镜像列表切换为官方 HTTPS 源，
保留发行版、组件、签名校验与完整 Playwright 依赖安装；未知镜像格式明确失败。
CI `43059598261` 证明切源生效，但 runner 对两个官方 Ubuntu 域名仍然 DNS 失败，
浏览器门未开始；实际下载的后端453项零失败/错误、两项既有镜像跳过，UI128通过。
宿主 `8900e5c` 随后加入严格索引更新和受相同 Ubuntu keyring 校验的备用镜像：主源
成功不切换，失败才尝试备用源，备用源失败仍终止。未修改 DNS/IP 或关闭签名校验。
本地 Python 检查共25项、补丁结构15项通过，自动 CI `43069306397` 运行中，
尚不能计为 CI 成功或正式发布。
须取得最终正式镜像、配套插件产物及根仓最终提交成功 CI 后，才能认定交付通过。

### 下一阶段：流式授权覆盖专项（需求候选，未实施）

补充 MCP keep-alive 生命周期调查：2026-11-12 实际日志反复出现同一组 session 的
`KeepAliveScheduler: Stream unavailable`。已确认根仓测试创建 POST session 后未显式
DELETE，最终依靠 owner 容器销毁回收；没有证据据此认定越权或业务写入。
七个日志 ID 尚未与具体场景逐一对齐，不把数量一致当作完全实证。
长期运行时有残留会话、无效心跳与日志增长风险，不能简单归为正常噪声。
后续首先由 root 给测试客户端补充原身份显式终止回归；撤权后 DELETE 的拒绝与清理边界
须单独裁决。overlay 核对无GET监听流、取消重连和关闭后的调度器释放契约，至少观察两个
保活周期，不能只验证调用了close，也不通过删除session或压低日志掩盖问题。
当前业务门通过及容器回收不证明 JVM 内会话释放正确。本项未实施，不中断本轮已验证交付。

此项来自对已发布修复的静态覆盖反查。下列内容尚未逐项真实复现，不能认定为
漏洞，也不能算本轮已验证能力。先完成当前交付，再按下列顺序调查，避免将所有
异步接口错误地套用 SSE 实现。

| 顺序 | 待核问题 | 所属仓与调查边界 | 必须取得的证据 |
| --- | --- | --- | --- |
| 1 | 执行/日志流在连接期间撤权后何时停止投递 | overlay 订阅生命周期；plugin 策略评估；root 生产组合 | 先核对允许延迟契约，再区分撤权前缓冲与撤权后新事件；允许、拒绝、撤权、重连及取消释放 |
| 2 | 依赖流是否分别授权关联 execution/flow | overlay 关联资源读取；plugin 范围策略；root 组合 | 父资源可读、子资源分别可读/不可读，订阅前已有和订阅后新增事件；逐节点及输出检查，不推断父子授权继承 |
| 3 | CSV 延迟查询是否持有有效授权上下文 | overlay 正文订阅与 repository 适配 | 真实 Micronaut HTTP 延迟消费、范围内外逐行/总数、多批读取、撤权与取消；不能仅测裸 Flux |
| 4 | AI 流的状态变更和异步工具副作用 | 先确认正式版本是否激活，再裁决宿主/插件职责 | chat、确认、拒绝、重复确认、取消与延迟写入的实际状态；入口拒绝码不足以证明无副作用 |
| 5 | MCP 长 session、等待期间撤权和输出读取 | 沿既有 MCP 独立身份及授权链 | 工具列表、执行、撤权、输出及重连；不因使用 SSE 就复用 REST 身份或 owner |

各项必须使用明确收窄授权的测试账号及范围内外数据，不用首装账号证明隔离。
先核对源码、公开契约与生产请求，再区分已复现缺陷、符合契约、未复现及证据不足。
若发现缺陷，按所属仓规则裁决最小修复与公开机制，不使用 WithoutAcl、首账号特例
或整体放宽接口。发布顺序仍是宿主、插件、根仓正式组合；本表不是待修漏洞清单。

采用当前修订范围：不改变首账号授权逻辑，不拉平未知端点状态码；`company` 及其
子空间是共同业务测试输入。先复现，再修复，不能以手工 API 代替浏览器实际请求。

主控在正式镜像 `7bc1f7f7…a5a7cc`、正式 jar `e0539edf…ed8bd28` 的保留部署中，
通过 Ego 原生编辑器保存并执行 `company.consistency/consistency_repro_01`，
执行 `6Okvt87vgB8dJiLhq2r3DK` 后实际出现右下错误通知，已保存截图及 DOM 观察。
普通 execution GET200、数据库 SUCCESS；服务端 follow 等待十秒后报告取不到执行。
刷新同一执行后甘特图正常，但出现“连接中断”。这些是独立实测，不是猜测 URL 的结果。

因此本文件后续“仅前端提示、全部200即可排除数据读取路径”的判断只能作为测试方
环境的结论，不能排除主控复现出的 SSE 读取问题。SSE 可以先返回200与 start事件，
随后流内部失败；需核对终止事件、授权上下文及服务端日志。候选修复必须分别处理
follow 正文订阅的 ACL 评估生命周期和前端提示语义/生命周期，保留拒绝、撤权与未知操作失败关闭。
定向红绿、正式发布及真实组合未完成前，不标记该项已交付。

---

## 一、结论（先给判断）

**未发现由「首装用户内置权限授予」导致的使用表现差异。**两模式首装 admin 在相同的干净库环境下，逐项操作结果一致（证据见第四节）。因此本次没有对 `InitialApplicationGroupPlan` 或授权策略做任何改动。

真正需要登记的问题只有三类，且均**不属于「赋予的权限值不对」**：

- 执行详情页错误提示把“首屏没取到数据（含 403）”渲染成“资源不存在”（缺陷 1，提示层问题，页面与数据正常）；
- 文档把测试口径写成权限上限（需求 3，已裁决按方案 A 修正文档，不收紧代码）；
- 两模式“预期差异”需要固定成文档（需求 4）。

另有一类**不算缺陷**的差异：模式 B 在“未携带身份”或“身份缺少对应权限”时返回 403。这是 RBAC 开启后的必然结果，属于确定知晓且必要的模式差异，不作为两模式的比较项，也不修复（详见第五节）。

需要说明的比较口径：**`company` 及其子空间是测试用例的选择**（模式 B 已授权该空间，便于两模式同条件对照），**不是模式 B 首装用户的权限上限**。凡是为使两模式首装用户运行行为对齐而多给的命名空间或权限，都属于必要，不按越权处理。

按约定，除“已裁决可自行修改且能本地验证”的项之外，其余不在本文件之外自行修复，只登记需求，交由统一修复方处理。

---

## 二、问题清单（缺陷 / 需求 / 已知差异）

### 缺陷 1：执行详情页弹出“你正在寻找的流程或执行不存在”错误提示（页面内容正常）

| 项 | 内容 |
|---|---|
| 严重级 | P2（提示语义错误 + 常驻不消失，会把“加载失败/无权限”误导成“资源不存在”） |
| 归属 | 前端（kestra UI 执行详情页：SSE 流错误回调） |
| 是否权限问题 | **否**。但**权限被拒会复用这条文案**：403 与“真不存在”在界面上无法区分（见下） |
| 复现情况 | 已定位到唯一代码调用点，并可按需稳定复现两种分支 |

**现象（已现场核实）**
执行详情页打开后，界面会弹出一条**错误通知（toast）**：“错误 / 你正在寻找的流程或执行不存在。”它出现在页面顶部通知区，带关闭按钮，**不会自动消失**；页面主体（甘特图、任务、日志）本身正常。

**关键证据（2026-11-11，内置浏览器实机）**

| 取证 | 结果 |
|---|---|
| 该文案的 DOM 形态 | `div.kel-notification` → `h2.kel-notification__title`“错误” + `.kel-notification__content`“……不存在”，带 `kel-notification__closeBtn`。**是通知组件，不是页面错误态** |
| 该页面文档内全部 `/api/` 请求 | 全 200：`/executions/irrpMtdbTtzp13Aq6N2de`、`/executions/{id}/follow`、`/executions/flows/company.team/flow_aha_probe_3`、`/average-duration` 等 |
| 直接读执行记录 | 200，`id=irrpMtdbTtzp13Aq6N2de`、`namespace=company.team`、`flowId=flow_aha_probe_3`、`state=SUCCESS`，与 URL 三段参数完全一致 |
| console | `console_messages()` 返回空，无 JS 报错 |
| 关闭该 toast 后 | 12 秒内不重现，页面文本不再包含“不存在” |
| ego-browser 注入 `MutationObserver` 后直接加载同一 URL | 3 次，`toasts: []`，无 4xx、无 console error |
| ego-browser 注入监控后“新建→保存→立即执行” | 3 次，只出现 `Successfully saved` / `Execution has started!`，**无错误 toast**，无 4xx |
| **因果复现**（ego，打开一个不存在的执行 `NOTEXIST000000000000AA`） | `GET /api/v1/main/executions/NOTEXIST000000000000AA` → **403**（授权层先于资源判定，不是 404）；随后弹出两条 toast：`Access denied` 与 `The flow or execution you are looking for does not exist.` |
| **残留复现**（同一文档内 SPA 切到 `/ui/main/executions` 列表页） | 该“不存在”toast **仍然存在**（`kel-notification` 未消失），而列表页正文本身不含该文案、内容正常 |
| **代码调用点**（在已加载 UI 包 `app-*.js` 中检索，全文只有一处使用该 key） | `errors.404.flow or execution` 只出现在执行 follow 流的错误回调里：`onError: () => { u.message = t.value ? {title:\`connection_lost.title\`, content:\`connection_lost.message\`} : {title:\`error\`, content:\`errors.404.flow or execution\`} }`。即该文案绑定在 **SSE /executions/{id}/follow 的 onError**，与“资源是否存在”无关 |
| **分支 A 复现**（只屏蔽 SSE `*/executions/*/follow*`） | 页面显示 **`Connection interrupted`**，不显示“不存在”（此时已拿到执行数据，走 `t.value` 真分支） |
| **分支 B 复现**（屏蔽 `*/api/v1/main/executions/*`，即首屏数据取不回来） | 稳定弹出 **`Error / The flow or execution you are looking for does not exist.`**，与用户截图完全一致（走 `t.value` 假分支） |
| **服务端日志交叉验证**（`docker logs --since 12h`） | 与执行相关的 401/403/404 只有 2 条，都是我构造的 `NOTEXIST000000000000AA` 探测；**没有任何一次真实执行请求被拒** |

**根本缺陷（一句话）**
执行详情页把“首屏没取到执行数据”这一**结果**（无论原因是 401/403/404、网络失败还是 SSE 首连失败）统一渲染成 i18n 的 `errors.404.flow or execution`（“流程或执行不存在”），且该错误通知没有自动关闭与路由清理。前者让三类不同故障在界面上互相冒充，后者让一次失败长期停留在无关页面。

**结论**
- 这条文案的真实语义不是“资源不存在”，而是**“执行页首屏没取到执行数据（REST 或 SSE 任一失败）”**。它由 SSE `onError` 回调触发，只在“首屏尚未拿到数据”的分支显示；若已拿到数据再断流，显示的是 `Connection interrupted`。
- 因此 403 会被同样渲染成“不存在”：无权限拒绝与真不存在走同一个分支，用户无法区分。这正是本项容易被误判成“权限缺失”的原因。
- 提示本身**不自动消失、跨路由不清除**，所以一次失败会长期停留在后续的正常页面上——看起来像“正常页面却报不存在”。
- 排除项：资源存在（200 且字段与 URL 逐字一致）、权限足够（正常路径全 200）、服务端无拒绝记录。缺陷在前端提示层。

**建议修复方向（前端提示层，按实现给）**
1. `onError` 不要一律映射成 `errors.404.flow or execution`：先判 `EventSource.readyState` 与“是否已收到首条事件”，区分“首次连接失败（加载失败/无权限）”与“中途断流（连接中断）”。
2. 首屏 REST 失败时按真实状态码出文案：401/403 → “无权限或登录失效”；404 → “不存在”；超时/网络 → “加载失败，重试中”。不要统一成“不存在”。
3. 错误通知给自动关闭时长、去重，并在路由切换时清理，避免一次失败长期残留。

**复现方法（可编程，供回归用）**
- 分支 A：CDP `Network.setBlockedURLs({urls:["*/executions/*/follow*"]})` → 期望 `Connection interrupted`。
- 分支 B：CDP `Network.setBlockedURLs({urls:["*/api/v1/main/executions/*"]})` → 期望“不存在”（当前实现下的错误文案）。
- 修复完成后：分支 B 应显示“加载失败/无权限”而非“不存在”，且提示能自动消失。

**再现时的取证步骤**
1. 先看 UX 形态：是 toast（`.kel-notification`）还是页面主体错误（这决定是不是资源问题）。
2. 读 `performance.getEntriesByType('resource')` 中 `/api/` 的 `responseStatus`，确认是否有非 200。
3. 若全部 200，则问题在提示触发逻辑，不在数据层；需要 `MutationObserver` 在触发瞬间记录当时的 URL 与最近请求。

**若后续确认，验收标准**
连续 10 次“新建 flow → 执行 → 立即查看详情”，0 次出现“不存在”；断网/断流场景显示“连接中断/加载失败”，且提示能自动消失。

---

### 已知差异（非缺陷）：未携带身份 / 身份无对应权限时返回 403

| 项 | 内容 |
|---|---|
| 性质 | **预期行为**，不是缺陷，不列入两模式的一致性比较项 |
| 归属 | RBAC 开启后的必然结果（授权层先于路由判定） |
| 是否权限问题 | 是，但属于“没有身份或没有该权限”，与被授予的权限值是否正确无关 |

**现象（仅作事实记录）**
同一批 URL 在两模式下状态码不同：

| URL（GET） | 模式 A | 模式 B |
|---|---|---|
| `/api/v1/main/executions/{id}/gantt` | 405 | 403 |
| `/api/v1/main/executions/{id}/logs` | 405 | 403 |
| `/api/v1/main/executions/{id}/metrics` | 405 | 403 |
| `/api/v1/main/executions/{id}/tasks` | 405 | 403 |
| `/api/v1/main/executions/{id}/state` | 405 | 403 |
| `/api/v1/main/flows?draft=false` | 405 | 403 |
| `/api/v1/main/namespaces` | 404 | 403 |
| `/api/v1/main/executions/{id}/follow`（`Accept: application/json`） | 406 | 403 |

**判定**
- 模式 B 在没有身份、或身份未被授予该端点所需权限时返回 403，这是开启访问控制的定义性行为：先判定授权，再进入路由。模式 A 没有授权层，请求会一路走到路由，才得到 405/404/406。
- 因此这**不是**“实现写错了”，也不是两模式需要拉平的点。之前把它当作缺陷登记，属于把“预期差异”误判成“问题”，本次修正。
- 这些端点在两模式下都不是 UI 实际使用的读取路径（gantt/logs/metrics 数据由 `GET /executions/{id}` 提供，`follow` 走 SSE），用户可完成的操作不受影响。

**处置**
- 不修复，不进入一致性比较。
- 只保留一条排障提示：**看到 403 先判断是“缺身份/缺权限”还是“端点不存在”，UI 会把 403 渲染成“不存在”，不要据 UI 文案判断资源是否存在。**

---

### 需求 3：文档把“测试口径”写成了“权限上限”（已裁决按方案 A 修正）

| 项 | 内容 |
|---|---|
| 严重级 | P2（文档口径与对齐目标冲突；行为本身符合目标） |
| 归属 | 文档：`kestra-plugin-rbac/README.md`、`docs/rbac-onboarding-experience.md` |
| 是否权限问题 | 相关，但**不是“授予的权限值写错”**，而是“文档把测试口径写成了权限上限” |
| 裁决状态 | **已裁决：方案 A**。`company` 及子空间只是测试用例的选择，不是模式 B 首装用户的权限上限；为使两模式首装用户行为对齐，额外的命名空间与权限是必要的 |

**契约原文**
- `kestra-plugin-rbac/README.md:227-228`：FLOW、EXECUTION、TRIGGER、NAMESPACE、KVSTORE、SECRET、NAMESPACE_FILE、LOG、METRIC、DASHBOARD、BLUEPRINT、AI **仅命名空间 `company` 及子空间**，并声明“范围外业务仍拒绝”。
- 源码 `InitialApplicationGroupPlan.java:28`：为这些资源生成 `Grant("NAMESPACE","main","company",descendants=true, …)`。

**实测（模式 B 首装 admin）**
- 在 `default` 创建 `flow_default_b` 成功，`GET /api/v1/main/flows/default/flow_default_b` → 200（`revision 1`）。
- 在 `outside.ns` 创建 `flow_outside_b` 成功，`GET` → 200（`revision 1`）。
- 在 `default` 执行 `flow_default_b` 成功（产生执行记录）。
- 流程列表页同时显示 `default` 与 `company.team` 的 flow，命名空间列表包含 `default`。

**结论（按已裁决口径）**
- 实测行为——首装 admin 在 `company` 之外同样能建/跑 flow——**符合对齐目标**：模式 A 没有任何限制，模式 B 要给到同等能力，两模式首装用户才不会出现“B 做不成 A 能做成”的差异。
- 问题只在文档：把“测试只选 `company` 空间”写成了“模式 B 只授权 `company` 空间”，并写了“范围外业务仍拒绝”。这会让人误以为跨命名空间能力是漏洞，进而被“修复”成收紧权限，反而制造两模式不一致。
- 因此本项不再按“策略未生效的实现缺口”处理，也不需要改 authorizer 去收紧范围。

**处理方向**
1. 文档：把 README 第 227–228 行及 `docs/rbac-onboarding-experience.md` 中“仅 `company` 及子空间 / 范围外拒绝”改写为“首装 admin 具备与模式 A 对齐的完整业务权限（含跨命名空间）；`company` 只是默认示例与测试口径”。
2. 源码：`InitialApplicationGroupPlan` 的 grant 注释按同一口径说明，注释不再暗示“范围外会被拒绝”。
3. 不改授权判定逻辑：收紧会让模式 B 与模式 A 在 `company` 之外表现不同，与目标冲突。

**验收标准**
- 文档中不再出现“仅 company”“范围外拒绝”这类与对齐目标冲突的表述。
- 两模式首装 admin 在 `company.*`、`default`、`outside.ns` 建/跑/查 flow 的行为与状态码一致。

---

### 需求 4：把两模式的“预期差异”写成文档，避免复测误判

| 项 | 内容 |
|---|---|
| 严重级 | P3（文档） |
| 归属 | monorepo `README.md` / `docs/rbac-onboarding-experience.md` |

**建议补充一张固定表格**（已实测确认的预期差异）：

| 项目 | 模式 A | 模式 B | 性质 |
|---|---|---|---|
| 首装页文案 | 仅表单 | 多一行“已启用细粒度访问控制…” | 预期 |
| 侧边栏 | 无「扩展」 | 有「扩展 → 访问控制」 | 预期 |
| OIDC authorize scope | `openid profile email` | 追加 `kestra:application-group-scopes` | 预期 |
| `GET /oidc/setup` 首装后 | 404 | 404 | 一致 |

同时补一句排障提示：**UI 会把 403 渲染成“不存在”，判断资源是否存在请以 API 状态码为准**。

---

## 三、权限实现层面的核查（不只是“有没有权限声明”）

判断“是不是权限问题”，除了看声明，还要看实现会不会自己制造异常。这里把授权实现的关键路径逐条核对了一遍。

| # | 实现事实 | 代码位置 | 对用户可能的影响 |
|---|---|---|---|
| 1 | 每次授权都校验“身份里的 authorizationVersion”与“目录里当前组版本”是否相等，不等即 `INVALID_IDENTITY`，整条 evaluation 直接失败 | `ApplicationGroupRuntimePolicies.java:98-110`（`:108` 是版本比对） | 一旦版本不一致，不是单个端点 403，而是**整个会话全站被拒**；UI 会把 403 渲染成“不存在”，表现上很像资源丢了 |
| 2 | 版本只在“授权相关内容”变化时 +1：组的 active、application 集合、`supportedScopeKeys`、audiences、userGrants 的 scopeKeys | `ApplicationGroupDirectoryStore.java:144`、`authorizationChanged():157-177` | 只改显示名/描述不会使会话失效；改权限、改组启用状态、增删应用会 |
| 3 | 增量用 invalidation 表与状态表双写，读取时若两者不一致会抛 `Inconsistent application group versions` | `ApplicationGroupDirectoryStore.java:256-266`、`invalidate():296-301` | 双写若不在同一提交内，读侧直接报错 |
| 4 | 授权取身份走 `currentForAuthorization()`：每个请求都从当前 Authentication 重新解析，并加锁读安全状态，不是登录时冻结的版本 | `kestra-overlay/patches/webserver/0383-oidc-resource-audience-v2.patch:132-152` | 设计上会话不应长期停留在旧版本，版本不一致只可能出现在极窄的更新窗口内 |
| 5 | 授权层先于路由判定，缺身份/缺权限的请求先得到 403（含端点本身不存在的路径） | 已知差异（非缺陷）一节 | 看到 403 不能直接读成“没权限”，更不能读成“资源不存在” |

**实测（本环境，模式 B）**

| 探测 | 结果 |
|---|---|
| `GET /api/v1/main/extensions/rbac/application-groups/main` | 200，`revision 1`、`authorizationVersion 1`（与首装契约一致） |
| `GET /api/v1/main/flows?namespace=company.team`（非 UI 路径） | 403（属已知差异：授权先于路由；UI 实际用 `/flows/search?namespace=…`） |
| `GET /api/v1/main/executions/{id}` | 200 |
| `POST /api/v1/main/extensions/rbac/application-groups/main/applications`（想触发版本 +1） | 403，未能构造“版本递增”场景，该项留作待验证 |

**结论**
- 实现里确实**存在**一条“版本不一致 → 全站拒绝 → UI 显示不存在”的路径（事实 1），这是本轮新增的、此前只查声明时看不到的风险点。
- 但它需要“目录版本已变、请求侧版本仍旧”同时成立；事实 4 表明请求侧每请求重算，正常不会出现，且 11 轮现场抓取与本次探测都没有出现 `INVALID_IDENTITY` 拒绝。
- 因此它不足以解释“执行详情首屏显示不存在”，但足以形成一条运维注意点：**模式 B 下改动权限会让已登录会话整体失效，改完需要重新登录**，建议写进排障文档。

---

## 四、已验证一致的操作基线（回归用）

环境：`docker compose down -v` 后干净首装，账号 `admin` / `admin123`，两模式各独立执行一遍。

| # | 操作 | 模式 A | 模式 B |
|---|---|---|---|
| 1 | `company` 子空间创建 flow | 成功 | 成功 |
| 2 | 执行 flow | SUCCESS | SUCCESS |
| 3 | 执行详情（甘特图/概览） | 正常 `1 Succeeded` | 正常 `1 Succeeded` |
| 4 | 日志页查看执行日志 | 正常 | 正常 |
| 5 | `GET /executions/{id}` | 200 | 200 |
| 6 | `GET /executions/flows/{ns}/{fid}` | 200 | 200 |
| 7 | `GET /outputs/tasks/{id}` | 200 | 200 |
| 8 | `GET /flows/{ns}/{fid}` | 200 | 200 |
| 9 | `GET /flows/search` | 200 | 200 |
| 10 | `GET /executions/{id}/follow`（SSE） | 200 | 200 |
| 11 | `GET /namespaces/{ns}` | 200 | 200 |
| 12 | 流程列表页 | 正常显示 | 正常显示 |
| 13 | 执行列表页 | 正常 | 正常 |
| 14 | 命名空间列表页 | 正常 | 正常 |
| 15 | 键值存储页 | 正常（空） | 正常（空） |
| 16 | 系统概览页 | 正常 | 正常 |
| 17 | 审计日志页 | 页面未找到（上游无） | 页面未找到（上游无） |
| 18 | `company` 外（`default`）创建 flow | 成功 | 成功 |
| 19 | `company` 外执行 flow | 成功 | 成功 |

---

## 五、优先级建议

1. **P2 需求 3**：只改文档口径，不收紧授权逻辑（收紧会让模式 B 在 `company` 之外落后于模式 A）。
2. **P2 缺陷 1**：提示语义错——首屏取不到执行数据（含 403）时一律说“不存在”，且提示不自动消失。改 SSE 错误回调的文案映射与提示生命周期，不改数据层。
3. **P3 需求 4**：文档补充，随手可做。
4. **不处理**：缺身份/缺权限返回 403 的已知差异（预期行为，不进比较、不修复）。

---

## 六、复现步骤（供修复方核对）

```bash
# 前置：确认 jar 为正式产物
sha256sum deployment/libs/kestra-rbac-authorizer.jar
# 应为 e0539edf4383ef0ee39317ccc6847a480ca50a7b9f60de71affa5d066ed8bd28

# 模式 B
# .env: KESTRA_RBAC_ENABLED=true
docker compose down -v && docker compose up -d
# 访问 http://localhost:8080/ui/ → 首装 admin/admin123 → 登录
# 新建 flow：编辑器中把 namespace 改为 default 或 outside.ns → 保存 → 应能成功（需求 3：跨命名空间能力须与模式 A 对齐）
# 执行 flow → 立即查看详情页 → 观察是否偶发“不存在”（缺陷 1）

# 模式 A
# .env: KESTRA_RBAC_ENABLED=false
docker compose down -v && docker compose up -d
# 同样首装、建 flow、执行；状态码仅用于记录已知差异，不作为比较项
```

状态码核对（登录态下浏览器的同步 XHR 即可）：

```
GET /api/v1/main/executions/{id}/gantt
GET /api/v1/main/executions/{id}/logs
GET /api/v1/main/executions/{id}/metrics
GET /api/v1/main/executions/{id}/tasks
GET /api/v1/main/executions/{id}/state
GET /api/v1/main/flows?draft=false
GET /api/v1/main/namespaces
```

---

## 七、处置清单（可直接分派）

| # | 事项 | 归属 | 具体动作 | 验收标准 | 我是否已改 |
|---|---|---|---|---|---|
| 1 | 执行详情“不存在”提示（缺陷 1） | 前端提示层（SSE 错误回调） | ① `onError` 不再一律映射成 `errors.404.flow or execution`，按 readyState/是否已收到首条事件区分“首连失败”与“中途断流”；② 首屏 REST 失败按真实码出文案（401/403→无权限、404→不存在、超时→加载失败）；③ 错误通知自动关闭、去重，路由切换时清理 | 断流显示“连接中断”；403 显示“无权限/登录失效”；提示自动消失且不跨路由残留 | 否（非权限问题，按约定只登记） |
| 2 | 文档把测试口径写成权限上限（需求 3） | 文档 | 改写 `kestra-plugin-rbac/README.md:227-228` 与 `docs/rbac-onboarding-experience.md`：`company` 为默认示例与测试口径，首装 admin 具备与模式 A 对齐的业务能力 | 文档中不再有“仅 company / 范围外拒绝”这类与对齐目标冲突的表述 | 待确认后再动产品文案 |
| 3 | 两模式预期差异表（需求 4） | 文档 | 在 onboarding 文档补固定表格（首装页文案、侧边栏扩展、OIDC scope、`/oidc/setup`、403 语义） | 复测人员据表即可区分“预期差异”与“缺陷” | 可随时执行 |
| — | 首装权限是否缺失 | 不改 | 已实测：执行详情链路 10 个端点全部 200（execution detail/graph、executions of flow、flow detail/revisions/dependencies/graph、namespace detail、flows search、avg duration） | — | 无缺失，无需改动 |
| — | 403 与 405/404 的语义差异 | 不改 | 已裁决为“确定知晓且必要”的模式差异 | — | 不修复，仅排障说明 |
| — | 授权层版本校验（authorizationVersion） | 不改 | 已核查：每次请求重算版本，权限变更会使旧会话整体失效，属设计；改权限后重新登录即可 | — | 仅写运维提示 |

---

## 八、定位过程复盘：这一项前几轮为什么判断错了

| 阶段 | 当时的结论 | 错在哪 | 为什么会这么错 |
|---|---|---|---|
| 1 | “页面主体进入错误态，数秒后自动恢复” | 把顶部 `kel-notification` 当成了页面错误态 | 只读了文案、没看 DOM 形态；先形成叙事，再去找支持它的证据 |
| 2 | “UI 首屏时序竞态” | 纯推断，没有任何现场请求支撑 | 用独立 API 探测代替浏览器现场，且探测请求与 UI 真实请求并不相同 |
| 3 | “未稳定复现的偶发现象” | 把“没看到”当成“没发生” | 采样只取页面正文尾部，而提示在顶部通知区；11 轮又全跑在不会触发的成功分支上 |
| 4 | 把跨命名空间 200 记为“策略实现缺口” | 把测试口径当成了权限上限 | 没区分“测试用例的选择”与“产品契约”，后由裁决纠正（降级为需求 3） |
| 5 | 把 403 记为缺陷 | 把预期差异当成了缺陷 | 没先判断“授权层先于路由判定”的语义，后由裁决移出（改为已知差异） |

**方法论教训（本项目通用）**
1. 先确认 UX 形态：是通知（`.kel-notification`）、页面错误态，还是真的 404 页面，再谈原因。
2. 抓现场用浏览器自己的记录：`performance` 里的 `responseStatus`、console、DOM 通知，不要用独立 API 结论代替现场。
3. “没复现”不等于“不存在”：先确认采样位置与路径是否覆盖了触发条件，再下结论。
4. 先找到文案/报错的代码出处，再按它的触发条件构造现场（如 CDP `Network.setBlockedURLs`），一次就能复现；在正常路径上反复重试是浪费时间。
