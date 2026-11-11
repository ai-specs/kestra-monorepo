# 模式 A / 模式 B 首装用户权限一致性对照报告

- 测试日期：2026-11-11
- 仓库：`D:\kestra-monorepo`（monorepo `8bee572`，overlay 子模块 `a7598d5`，rbac 子模块 `ae81aa1`）
- 镜像：`ghcr.io/ai-specs/kestra-overlay@sha256:7bc1f7f7b0f110e76c074b026d42fb8cb5d75d562902b6a319e08739d2a5a7cc`
- 插件 jar：`deployment/libs/kestra-rbac-authorizer.jar`，SHA-256 `e0539edf4383ef0ee39317ccc6847a480ca50a7b9f60de71affa5d066ed8bd28`（CI run `42021082952` 正式产物）
- 比较口径（用户约定）：首装首个账号，在 `company` 命名空间下新建 flow，以及相关的执行与查看操作；上游未实现的占位菜单（如 `/ui/main/apps`）不比较。

## 一、结论摘要

1. **在用户约定的 `company` 空间口径下，两模式首装用户的权限一致。**创建 flow、执行 flow、查看执行详情/任务输出/执行列表/流程列表，两种模式全部可用，无差异。
2. **`company` 之外同样一致（都允许），且这是必要的。**实测两模式均可在 `default` 与 `outside.ns` 创建并执行 flow。`company` 只是测试用例选择的对照空间，不是模式 B 首装用户的权限上限；为使两模式首装用户行为对齐，多授的命名空间与权限属必要。需要修的是文档：`kestra-plugin-rbac/README.md:227-228` 与 `InitialApplicationGroupPlan.java:28` 的“仅 company / 范围外拒绝”表述，按对齐目标改写（详见发现 1）。
3. **模式 B 对“未携带身份 / 无对应权限”的请求返回 403**，而模式 A 对同一 URL 返回 405/404/406。这是 RBAC 的预期行为（先判授权、再进路由），属于确定知晓且必要的模式差异，不作为比较项（详见第四节与发现 2）。
4. **执行详情页的“你正在寻找的流程或执行不存在”已现场核实为错误提示 toast，页面与数据均正常。**DOM 证据为 `div.kel-notification`（带关闭按钮、不自动消失）；同一文档内 `/executions/{id}`、`follow`、`/executions/flows/...` 等请求全部 200；直接读执行记录得到 `id/namespace/flowId` 与 URL 完全一致、`state=SUCCESS`；关闭提示后 12 秒不重现；ego 注入 `MutationObserver` 后直接加载同一 URL 3 次、新建执行 3 轮均无该提示。原“首屏时序竞态”作废（详见发现 3）。

## 二、模式 A / B 的配置差异（预期差异，非权限缺陷）

| 项目 | 模式 A | 模式 B | 说明 |
|---|---|---|---|
| `.env` `KESTRA_RBAC_ENABLED` | `false` | `true` | 唯一开关 |
| 首装页文案 | 仅“设置 Kestra”表单 | 额外一行“已启用细粒度访问控制。创建此账号时，将自动初始化应用组及权限。” | 模式 B 首装会建应用组目录 |
| 侧边栏 | 无「扩展」分组 | 有「扩展 → 访问控制」 | 模式 A 不加载 RBAC 扩展页 |
| OIDC authorize scope | `openid profile email` | `openid profile email kestra:application-group-scopes` | 模式 B 需要组 scope 声明 |
| 首装后 `GET /oidc/setup` | 404 | 404 | 一致：初始化均为一次性 |

## 三、逐项对照（用户约定口径：`company` 空间）

| # | 操作/能力 | 模式 A 实测 | 模式 B 实测 | 是否一致 |
|---|---|---|---|---|
| 1 | 在 `company` 子空间创建 flow（UI 新建 → 保存） | 成功，`company.team/flow_4631813` | 成功，`company.team/flow_3715705` | 一致 |
| 2 | 执行该 flow（UI 执行对话框 → 执行） | 成功，状态 SUCCESS | 成功，状态 SUCCESS | 一致 |
| 3 | 执行详情页（甘特图/概览） | 正常渲染：`1 Succeeded`、耗时 1.6s | 正常渲染：`1 Succeeded`、耗时 1.14s | 一致 |
| 4 | 任务日志查看 | 正常（日志含 Success 行） | 正常（日志含 Success 行） | 一致 |
| 5 | 执行对象读取 `GET /api/v1/main/executions/{id}` | 200 | 200 | 一致 |
| 6 | 按 flow 查执行列表 `GET /api/v1/main/executions/flows/{ns}/{fid}` | 200 | 200 | 一致 |
| 7 | 任务输出 `GET /api/v1/main/outputs/tasks/{id}` | 200 | 200 | 一致 |
| 8 | 流程详情 `GET /api/v1/main/flows/{ns}/{fid}` | 200 | 200 | 一致 |
| 9 | 流程搜索 `GET /api/v1/main/flows/search?namespace=...` | 200 | 200 | 一致 |
| 10 | 流程列表页可见已建 flow | 正常 | 正常（显示 `flow_3715705`，最后执行 Success） | 一致 |
| 11 | 执行列表页 | 正常 | 正常（`Total Executions 1`，Success） | 一致 |
| 12 | 命名空间详情 `GET /api/v1/main/namespaces/{ns}` | 200 | 200 | 一致 |
| 13 | 实时订阅 `GET /executions/{id}/follow`（`Accept: text/event-stream`） | 200 | 200 | 一致 |
| 14 | 执行图 `GET /executions/{id}/graph` | 200 | 200 | 一致 |
| 15 | 在 `company` 之外（`default`）创建 flow | 成功 `default/flow_default_a` | 成功 `default/flow_default_b` | 一致（但均超出 RBAC 契约声明范围） |
| 16 | 在 `company` 之外（`outside.ns`）创建 flow | 未单独测（模式 A 无授权层，`default` 已证同解） | 成功 `outside.ns/flow_outside_b`，`GET` 返回 200（revision 1） | 一致（同上） |
| 17 | 在 `default` 执行 flow | 成功，`1 Succeeded` | 成功（执行已开始） | 一致 |

> 两种模式各自都是 `docker compose down -v` 清库后的干净首装，账号均为 `admin` / `admin123`，因此上表是同起点对照。

## 四、模式 B 的 403 端点清单（与模式 A 逐项比对）

| 端点（GET） | 模式 A | 模式 B | UI 是否使用 | 影响 |
|---|---|---|---|---|
| `/api/v1/main/executions/{id}/gantt` | 405 | 403 | 否（gantt 数据由 `/executions/{id}` 提供） | 无 |
| `/api/v1/main/executions/{id}/logs` | 405 | 403 | 否 | 无 |
| `/api/v1/main/executions/{id}/metrics` | 405 | 403 | 否 | 无 |
| `/api/v1/main/executions/{id}/tasks` | 405 | 403 | 否 | 无 |
| `/api/v1/main/executions/{id}/state` | 405 | 403 | 否 | 无 |
| `/api/v1/main/flows?draft=false` | 405 | 403 | UI 会请求，但页面仍正常出列表 | 无可见影响 |
| `/api/v1/main/namespaces` | 404 | 403 | 否（命名空间页走 `/namespaces/{ns}`） | 无 |
| `/api/v1/main/executions/{id}/follow`（`Accept: application/json`） | 406 | 403 | 否（UI 用 SSE） | 无 |

模式 A 的 405/404/406 证明这些 URL 本身不提供受支持的 GET；模式 B 的 403 是 RBAC 在路由解析之前先行拒绝，因此**不能据此判定为“权限缺失”**。真实 UI 使用的端点（第三节 5–14 行）在模式 B 全部 200。

## 五、发现（缺陷 / 已知预期差异）

### 发现 1：`company` 是测试口径，不是权限上限（文档需按对齐目标修正）

- 对照结果：两模式首装 `admin` 在 `company.*`、`default`、`outside.ns` 都能建/跑/查 flow，行为一致。
- 这个结果**符合本次目标**：模式 A 本身不限命名空间，模式 B 必须给出同等能力，两模式首装用户才不会出现“B 做不成 A 能做成”的差异；为使对齐而多授的命名空间与权限都是必要的。
- 需要修的是文档：`kestra-plugin-rbac/README.md:227-228` 与 `docs/rbac-onboarding-experience.md` 把“测试只选 `company`”写成了“仅 `company` 及子空间、范围外拒绝”，容易被误读成“跨命名空间是漏洞”，进而被收紧成两模式不一致。
- 处置（已裁决方案 A）：只改文档与注释口径，不改授权判定逻辑。

### 发现 2：模式 B 对“未携带身份 / 无对应权限”的请求返回 403（预期行为，非缺陷）

同一 URL 在模式 A 返回 405/404/406，在模式 B 返回 403（见第四节）。这是 RBAC 开启后的必然结果：先判授权，再进路由。属于确定知晓且必要的模式差异，不作为两模式的比较项，也不修复。仅保留一条排障提示：看到 403 要区分“缺身份/缺权限”与“端点不存在”，且 UI 会把 403 渲染成“不存在”，不能据 UI 文案判断资源是否存在。

### 发现 3：执行详情页的“不存在”是错误提示 toast 误报（非权限、非数据缺失）

- 形态（2026-11-11 实机取证）：该文案来自 `div.kel-notification` —— 页面顶部错误通知，带关闭按钮，**不会自动消失**；页面主体（甘特图/任务/日志）正常。此前把它当成“页面主体错误态 + 数秒后恢复”是误读。
- 数据面：同一文档内 `/api/v1/main/executions/{id}`、`/executions/{id}/follow`、`/executions/flows/company.team/flow_aha_probe_3`、`/average-duration` 等全部 200；直接读执行记录返回 `id=irrpMtdbTtzp13Aq6N2de`、`namespace=company.team`、`flowId=flow_aha_probe_3`、`state=SUCCESS`，与 URL 三段参数完全一致；`console_messages()` 为空。
- 行为：手动关闭该 toast 后 12 秒内不重现；ego 用 `MutationObserver` 监控后直接加载同一 URL 3 次（`toasts: []`）、新建→保存→执行 3 次（只有 Success 提示），均无该错误提示，也无 4xx。
- 判定：不是“资源不存在”，不是权限问题，也不是“首屏时序竞态”；属**错误提示误报 + 跨路由残留**。因果已复现：访问不存在的执行 `NOTEXIST000000000000AA` 时，`GET /api/v1/main/executions/{id}` 返回 **403**（授权层先于资源判定），UI 同时弹出 `Access denied` 与“流程或执行不存在”；同一文档内 SPA 切到 `/ui/main/executions` 列表页后，该提示**依然存在**，而列表页内容正常。
- 建议：403 不要渲染成“不存在”（先分“无权限/确实不存在/暂不可用”）；展示“不存在”前以 `GET /executions/{id}` 的真实结果为准；错误通知给自动关闭时长、去重，并在路由切换时清理。

## 六、复现步骤

模式 A：
```bash
# .env: KESTRA_RBAC_ENABLED=false
docker compose down -v && docker compose up -d
# /ping 返回 pong 后访问 http://localhost:8080/ui/ → 首装 admin/admin123 → 登录
# 流程 → 创建 → 保存到 company.team → 执行 → 查看甘特图/日志
```

模式 B：
```bash
# .env: KESTRA_RBAC_ENABLED=true
docker compose down -v && docker compose up -d
# /ping 返回 pong 后访问 http://localhost:8080/ui/ → 首装（页面应出现“已启用细粒度访问控制”）
# 同上创建/执行；另可在编辑器中把 namespace 改为 default 或 outside.ns 复现发现 1
```

排障提示：UI 把 403 渲染成“不存在”，判断资源是否存在请以 API 状态码 + `docker compose logs kestra | grep "status: 403"` 为准。

## 七、环境保留

当前环境已重建为**模式 B**（`.env` `KESTRA_RBAC_ENABLED=true`，干净库首装），可供二次验证。首装与后续操作请按第六节模式 B 步骤执行。
