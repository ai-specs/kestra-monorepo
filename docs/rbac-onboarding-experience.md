# RBAC 首次安装体验改造提案

> **状态：目标设计（未实现）**
>
> 本文档描述用户期望的 RBAC 首次安装体验改造方案。当前实现仍需手动执行
> `ApplicationGroupDirectoryCommand` 并重启容器；目标是让 `/oidc/setup` 页面
> 自动完成检查和初始化。

## 1. 问题

当前启用 RBAC 的流程：

1. 手动从插件 CI 下载 `kestra-rbac-authorizer.jar` 到 `deployment/libs/`
2. 修改 `.env`：`KESTRA_RBAC_ENABLED=true` + 修改 OIDC scopes
3. 停止 kestra JVM
4. 手动执行 `ApplicationGroupDirectoryCommand preview/apply`
5. 手动执行 `ApplicationGroupPolicyCommand initialize`
6. 重启容器
7. 才能访问 `/oidc/setup` 创建账号

如果跳过第 4-5 步直接启用 RBAC，页面无法登录（fail-closed）。

## 2. 目标体验

### 模式 A：不使用 RBAC（当前默认）

```
docker compose up -d
  → /oidc/setup 正常显示
  → 创建管理员账号
  → /oidc/login 登录
  → /ui/main/dashboards 正常使用
```

无需任何额外操作。

### 模式 B：使用 RBAC（目标）

```
.env 设置 KESTRA_RBAC_ENABLED=true
docker compose up -d（不报错，正常启动）
  → /oidc/setup 页面渲染时：
     ① 检查 deployment/libs/ 有无 rbac jar
     ② 如果没有：阻止初始化，显示提示
        "检测到 KESTRA_RBAC_ENABLED=true，但未找到 rbac jar。
         请从插件 CI 下载 kestra-rbac-authorizer.jar 到 deployment/libs/，
         然后刷新此页面。"
     ③ 用户补充 jar 后刷新 → 通过检查
  → /oidc/setup 页面明确提示：
     "⚠️ 已启用 Kestra RBAC（细粒度授权）
      创建管理员账号后，将自动初始化应用组目录和策略。"
  → 用户填写账号信息，点击 Create account
  → 后端自动完成：
     - ApplicationGroupDirectoryCommand preview/apply
     - ApplicationGroupPolicyCommand initialize
     - 不中断应用，不重启容器
  → /oidc/login 登录
  → /ui/main/dashboards + /ui/main/extensions/rbac 管理页面
```

## 3. 三个项目的改造面

### 3.1 kestra-overlay（宿主镜像）— 主要改造

| 改造点 | 说明 |
|---|---|
| `/oidc/setup` 页面渲染 | 读取 `KESTRA_RBAC_ENABLED` 环境变量，决定是否显示 RBAC 提示 |
| jar 存在性检查 | setup 页面加载时调用后端 API，检查 `/app/libs/` 下是否有 `kestra-rbac-authorizer*.jar` |
| jar 缺失时阻断 | 如果 RBAC 开启但 jar 不存在，setup 页面不显示表单，显示下载指引 |
| 初始化钩子 | setup 提交（POST /oidc/setup）成功后，如果 RBAC 开启且 jar 存在，自动调用插件的初始化服务 |
| 初始化状态反馈 | 初始化过程在 setup 页面显示进度，完成后自动跳转登录页 |

### 3.2 kestra-plugin-rbac（插件）— 次要改造

| 改造点 | 说明 |
|---|---|
| 暴露初始化 API | 将 `ApplicationGroupDirectoryCommand` 和 `ApplicationGroupPolicyCommand` 的逻辑封装为可在运行时调用的服务/API，而非只能通过 CLI 执行 |
| **一次性初始化（安全设计）** | 初始化接口只允许调用一次。前置检查：已初始化时拒绝执行（返回明确错误）。初始化成功后，初始化 API **下线**（返回 404），不提供重复调用入口。这不是幂等设计，而是安全设计——初始化操作不允许被重复触发 |
| 状态查询接口 | 提供 `GET /api/rbac/directory/status` 供 setup 页面查询初始化状态（`not_initialized` / `initialized`）。该接口长期可用，不随初始化 API 下线 |
| 不依赖 JVM 重启 | 初始化逻辑在应用运行时可执行，不要求停 JVM 或重启容器 |

### 3.3 kestra-monorepo（根仓）— 最小改造

| 改造点 | 说明 |
|---|---|
| README | 新增"选择是否启用 RBAC"章节，描述两种模式 |
| .env.example | 保持 `KESTRA_RBAC_ENABLED=false` 为默认 |
| docker-compose.yml | 无需改动（环境变量已透传） |
| 文档链接 | 在 README 中链接本文档作为详细提案 |

## 4. 关键技术决策点

### 4.1 jar 检查机制

宿主如何判断 `deployment/libs/` 下的 jar 是 rbac 插件？

**方案 A**：按文件名匹配 `kestra-rbac-authorizer*.jar`（简单，但可能误匹配）
**方案 B**：宿主扫描 jar 中的 `META-INF/MANIFEST.MF`，检查特定属性（更可靠）
**方案 C**：约定文件名 `deployment/libs/kestra-rbac-authorizer.jar`（最简单，文档约束）

建议：方案 C（约定文件名），文档明确要求。

### 4.2 初始化执行时机

在 `/oidc/setup` 提交时同步执行，还是异步？

**同步**：用户看到进度条，完成后跳转登录页。体验好但 setup 接口可能超时。
**异步**：setup 提交后立即跳转，后台初始化，登录时检查初始化状态。

建议：同步执行 + 超时保护（初始化通常 < 10 秒）。

### 4.3 初始化失败处理

如果初始化失败（数据库错误、jar 版本不兼容等）：

- setup 页面显示错误信息
- 账号创建是否回滚？
- 初始化**未成功**时，初始化 API 保持可用，用户可修正问题后重试
- 初始化**成功**后，API 立即下线（返回 404），不可重试
- 建议：账号已创建但 RBAC 目录未初始化时，状态为 `not_initialized`，setup 页面可重新触发初始化

### 4.4 初始化 API 的生命周期

```
not_initialized          →  POST /api/rbac/directory/initialize 可用
initialized (成功)       →  POST /api/rbac/directory/initialize 返回 404（已下线）
initialized (成功)       →  GET  /api/rbac/directory/status 长期可用，返回 initialized
```

设计原则：初始化是一次性操作，成功后不再提供触发入口。状态查询接口长期可用，供 setup 页面和管理页面判断当前状态。

> **设计一致性**：这与宿主自身的 `/oidc/setup` 页面行为完全一致——
> 首次安装时 `/oidc/setup` 可访问，创建管理员账号后再次访问 `/oidc/setup` 返回 404
> （或重定向到登录页）。RBAC 初始化 API 应遵循同样的生命周期模式：
> 只在未初始化时可用，成功后自动消失。

## 5. 不在本次改造范围

- RBAC 启用后切换为关闭模式（当前文档说明如何在 .env 中关闭）
- 多 issuer 支持
- 历史 schema1 迁移
- 自动下载 jar（仍需用户手动从 CI 下载）

## 6. 参考

- 当前启用流程：根仓 README "启用 RBAC（可选）"章节
- 插件初始化 CLI：`ApplicationGroupDirectoryCommand` / `ApplicationGroupPolicyCommand`
- Fail-closed 行为：未初始化时 RBAC 拒绝所有请求
