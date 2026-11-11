# 模式 A / 模式 B 首装用户「使用表现一致」缺陷与需求清单

- 提出日期：2026-11-11
- 适用仓库：`ai-specs/kestra-monorepo`、`ai-specs/kestra-overlay`、`ai-specs/kestra-plugin-rbac`
- 本文件由测试方提出，用于后续统一修复；**除文末标注“已本地验证”的方案外，均未改动代码**
- 目标：模式 A（`KESTRA_RBAC_ENABLED=false`）与模式 B（`KESTRA_RBAC_ENABLED=true`）的首装首个账号，在用户可感知的操作上表现一致

---

## 一、结论（先给判断）

**未发现由「首装用户内置权限授予」导致的使用表现差异。**两模式首装 admin 在相同的干净库环境下，逐项操作结果一致（证据见第四节）。因此本次没有对 `InitialApplicationGroupPlan` 或授权策略做任何改动。

真正需要登记的问题只有三类，且均**不属于「赋予的权限值不对」**：

- 执行详情页错误提示误报（缺陷 1，提示层问题，页面与数据正常）；
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
| 严重级 | P3（提示误报；页面内容与数据均正常，不影响操作） |
| 归属 | 前端（kestra UI 执行详情页 / 错误提示） |
| 是否权限问题 | **否**（同名请求全部 200，执行记录字段与 URL 完全一致） |
| 复现情况 | 已在现场抓到一次实例并定位其 UI 形态；但触发该提示的具体请求尚未定位 |

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

**结论**
- 此前把它写成“页面主体进入错误态、数秒后自动恢复”，是**误读**：它是可关闭、常驻、且**会跨路由残留**的错误通知，页面内容是正常的。
- 触发路径已复现：访问一个不存在（或无权限）的执行时，`GET /executions/{id}` 返回 **403**（授权层先于资源判定），UI 同时弹出 `Access denied` 和“流程或执行不存在”；这条提示既不自动关闭，也不随路由切换清除，于是用户在一个正常页面上仍然看到“不存在”。
- 因此“资源不存在”“权限缺失”“首屏时序竞态”三个说法都不成立：资源存在（200 且字段与 URL 匹配），权限足够（同一页面其它请求全 200），也没有竞态；问题在**提示的触发依据、文案映射与生命周期**。

**建议修复方向（前端提示层）**
1. 403 不应被渲染成“资源不存在”；先区分“无权限”“资源确实不存在”“暂不可用”，再决定文案。
2. 展示“不存在”前以 `GET /api/v1/main/executions/{id}` 的真实结果为准；该请求成功且字段与 URL 匹配时不提示。
3. 错误通知给出自动关闭时长并去重；路由切换时清理上一条错误提示，避免残留在无关页面。

**再现时的取证步骤**
1. 先看 UX 形态：是 toast（`.kel-notification`）还是页面主体错误（这决定是不是资源问题）。
2. 读 `performance.getEntriesByType('resource')` 中 `/api/` 的 `responseStatus`，确认是否有非 200。
3. 若全部 200，则问题在提示触发逻辑，不在数据层；需要 `MutationObserver` 在触发瞬间记录当时的 URL 与最近请求。

**若后续确认，验收标准**
连续 10 次“新建 flow → 执行 → 立即查看详情”，0 次出现“不存在”。

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
2. **P3 缺陷 1**：提示层的误报——请求全 200 却弹出“不存在”，且提示不自动消失。改提示判定与自动关闭，不改数据层。
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
</content>
