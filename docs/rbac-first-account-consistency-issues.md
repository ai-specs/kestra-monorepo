# 模式 A / 模式 B 首装用户「使用表现一致」缺陷与需求清单

- 提出日期：2026-11-11
- 适用仓库：`ai-specs/kestra-monorepo`、`ai-specs/kestra-overlay`、`ai-specs/kestra-plugin-rbac`
- 本文件由测试方提出，用于后续统一修复；**除文末标注“已本地验证”的方案外，均未改动代码**
- 目标：模式 A（`KESTRA_RBAC_ENABLED=false`）与模式 B（`KESTRA_RBAC_ENABLED=true`）的首装首个账号，在用户可感知的操作上表现一致

---

## 一、结论（先给判断）

**未发现由「首装用户内置权限授予」导致的使用表现差异。**两模式首装 admin 在相同的干净库环境下，逐项操作结果一致（证据见第四节）。因此本次没有对 `InitialApplicationGroupPlan` 或授权策略做任何改动。

真正存在的不一致只有两类，且均**不属于「赋予的权限值不对」**：

- 一类是尚未复现的偶发渲染（缺陷 1，已降级为观察项）；
- 一类是授权层实现细节（缺陷 2、3）——它改变的是错误语义和契约符合性，不改变用户能完成的操作。

按约定，这两类不在本文件之外自行修复，只登记需求，交由统一修复方处理。

---

## 二、缺陷清单

### 缺陷 1：执行详情首屏偶发显示“你正在寻找的流程或执行不存在”

| 项 | 内容 |
|---|---|
| 严重级 | P3（当前无法稳定复现，降级观察） |
| 归属 | 前端（overlay / kestra UI 执行详情页） |
| 是否权限问题 | **否** |
| 复现模式 | 早期在模式 B 页面上观察到 2 次，但未保留当时的网络/控制台原始记录；随后按浏览器现场抓取重测 11 轮，0 次复现 |

**现象（历史观察）**
点击「执行」后页面跳到 `/ui/main/executions/{ns}/{flowId}/{execId}/gantt?filters[...]`，页面主体显示“错误 / 你正在寻找的流程或执行不存在。”；数秒后同一 URL 显示甘特图与 `1 Succeeded`。

**现场抓取（本轮直接读浏览器，不使用独立 API 推断）**

抓取方式：在页面内打开 CDP 的 `Network`、`Runtime.consoleAPICalled`、`Log.entryAdded`，直接读浏览器自己记录的真实结果——`performance.getEntriesByType('resource')` 中每个 `/api/` 请求的 `responseStatus`、`Network.loadingFailed`、console error/warning。

| 场景 | 轮次 | 结果 |
|---|---|---|
| ego-browser：编辑器内点执行 | 5 | 全部 200，无 4xx/5xx、无 `loadingFailed`、无 console error |
| ego-browser：新建 flow → 保存 → 立即执行 | 3 | 同上 |
| 内置浏览器：新建 flow → 保存 → 立即执行，按 300/800/2000ms 采样 | 3 | 同上，页面文本始终不含“不存在” |

UI 实际请求在跳转后均为 200：`GET /api/v1/main/executions/{id}`、`GET /api/v1/main/executions/{id}/follow`、`GET .../average-duration`、`GET /api/v1/main/executions/flows/{ns}/{fid}`。

**结论（修正此前的推断）**
原文写的“UI 首屏时序竞态”是推断，现场数据不支持：正常路径上没有失败请求、没有错误渲染、没有恢复过程。此项应记为“未稳定复现的偶发现象”，不按已确认缺陷安排修复；也不作为模式 A/B 的差异项——两模式在相同脚手架下均未复现。

**再现时的取证步骤（先取证，再谈修复）**
1. 出现“不存在”时，先在同一页面读 `/api/` 请求的 `responseStatus`，确认是哪一个请求失败、失败码是什么。
2. 导出该请求的响应体与 console error（`Runtime.consoleAPICalled`）。
3. 只有抓到具体的非 200 请求，才讨论是否需要前端加重试或 loading 态；在此之前不改代码。

**若后续确认，验收标准**
连续 10 次“新建 flow → 执行 → 立即查看详情”，0 次出现“不存在”。

---

### 缺陷 2：授权层在路由解析前拦截，使“不存在的端点”返回 403 而不是 405/404

| 项 | 内容 |
|---|---|
| 严重级 | P3（不影响功能，影响排障判断） |
| 归属 | kestra-plugin-rbac（authorizer 覆盖面 / 过滤器顺序） |
| 是否权限问题 | 部分相关（属授权层实现，不是“授予的权限值”错误） |

**现象**
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

**影响**
- 这些端点 UI 实际不用于数据读取（gantt/logs/metrics 数据由 `GET /executions/{id}` 提供；`follow` 用 SSE），所以功能无缺失。
- 但排障时会把“端点不存在”误判成“没有权限”，也让两模式的错误码无法直接对齐，属于一致性噪音。
- 风险：一旦后续 UI 改为调用上述任一端点，模式 B 会直接失败而模式 A 只是 405（同样失败），但报错语义不同，难以定位。

**建议修复方向**
- 授权判断应在路由匹配成功之后执行；对未注册路由直接交给上游返回 405/404，不产生 403。
- 或在 authorizer 中维护“受保护端点清单”，仅对清单内路径做策略评估，其余放行到后续过滤器。
- 回归用例：对上述 8 个 URL，两模式状态码必须一致（405/404/406）。

---

### 缺陷 3：初始策略声明的 `company` 命名空间范围没有约束住 flow 读写

| 项 | 内容 |
|---|---|
| 严重级 | P1（契约与行为不符；若按文档作为隔离依据会失效） |
| 归属 | kestra-plugin-rbac（策略执行覆盖面） |
| 是否权限问题 | 相关，但**不是“授予的权限值写错”**，而是“策略未在上述端点生效” |

**契约原文**
- `kestra-plugin-rbac/README.md:227-228`：FLOW、EXECUTION、TRIGGER、NAMESPACE、KVSTORE、SECRET、NAMESPACE_FILE、LOG、METRIC、DASHBOARD、BLUEPRINT、AI **仅命名空间 `company` 及子空间**，动作 `READ/LIST/CREATE/UPDATE/DELETE/EXECUTE/ACCESS_OUTPUTS`。
- 源码 `kestra-plugin-rbac/src/main/java/io/kestra/extensions/rbac/applicationgroup/InitialApplicationGroupPlan.java:28`：为这些资源生成 `Grant("NAMESPACE","main","company",descendants=true, …)`。

**实测（模式 B 首装 admin）**
- 在 `default` 创建 `flow_default_b` 成功（UI 显示“成功保存”），`GET /api/v1/main/flows/default/flow_default_b` → 200，`revision 1`。
- 在 `outside.ns` 创建 `flow_outside_b` 成功，`GET` → 200，`revision 1`。
- 在 `default` 执行 `flow_default_b` 成功（执行已开始，产生执行记录）。
- 流程列表页同时显示 `default` 与 `company.team` 两条 flow，命名空间列表包含 `default`。

**结论**
初始 `company` 范围对 FLOW / EXECUTION 的写入与读取端点均未生效，用户实际拥有跨命名空间能力，与文档声明的隔离不一致。

**建议修复方向（二选一，需产品裁决）**
- **方案 A（推荐，符合当前目标）**：既然目标是两模式“表现一致”，则明确把首装 admin 定义为“全命名空间管理员”，同步修改 README 与策略生成（把 NAMESPACE 级 grant 改为 TENANT 级），并删除“范围外拒绝”的表述。这样文档与行为一致，且与模式 A 完全等价。
- **方案 B（保持安全设计）**：修 authorizer，使 FLOW/EXECUTION 等端点真正按 `namespace` 判定；同时修正文档，明确“首装 admin 仅 company 及子空间”。但此方案会让模式 B 与模式 A 在 `company` 之外表现不同，与本次目标冲突，需用户确认。

**验收标准（方案 A）**
- 两模式首装 admin：`default`、`outside.ns`、`company.*` 均可创建/执行/查看 flow，行为与状态码一致。
- README、`InitialApplicationGroupPlan.java` 注释、`docs/rbac-onboarding-experience.md` 三处口径一致，无“仅 company”残留。

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
| 5 | 授权层先于路由判定，端点不存在也先给 403 | 缺陷 2 | 非 UI 路径的 403 不能当作“没权限”读 |

**实测（本环境，模式 B）**

| 探测 | 结果 |
|---|---|
| `GET /api/v1/main/extensions/rbac/application-groups/main` | 200，`revision 1`、`authorizationVersion 1`（与首装契约一致） |
| `GET /api/v1/main/flows?namespace=company.team`（非 UI 路径） | 403（属缺陷 2 的错误语义，UI 实际用 `/flows/search?namespace=…`） |
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

1. **P1 缺陷 3**：先做产品裁决（方案 A 还是 B），再动代码；否则修完会造成新的不一致。
2. **P3 缺陷 1**：当前无法复现，先保留浏览器抓取脚本；再现时按“取证步骤”定位到具体非 200 请求后再谈修复。
3. **P3 缺陷 2**：与缺陷 3 一起在 authorizer 层统一处理更合适。
4. **P3 需求 4**：文档补充，随手可做。

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
# 新建 flow：编辑器中把 namespace 改为 default 或 outside.ns → 保存 → 应能成功（缺陷 3）
# 执行 flow → 立即查看详情页 → 观察是否偶发“不存在”（缺陷 1）

# 模式 A
# .env: KESTRA_RBAC_ENABLED=false
docker compose down -v && docker compose up -d
# 同样首装、建 flow、执行，记录状态码用于与 B 对比（缺陷 2）
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
</content>
