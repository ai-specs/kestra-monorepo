# RBAC 首次安装体验

> **状态：自动首装已实现；正式组合在根仓 d66d324 / CI41669412885 通过，报告已下载核对。**
>
> 本文定义零背景用户的首次使用流程及部署验收条件。2026-11-03 重新调查后，
> 原提案中的实现细节按下文裁决修订；不能把原提案、源码或旧绿色 CI 当作已交付。
> 宿主公开契约归 overlay，实际目录、初始权限与存储设计归 plugin。

## 1. 改造前的问题（历史手动流程）

以下是改造前流程，不再作为新空库网页首装步骤：

1. 手动从插件 CI 下载 `kestra-rbac-authorizer.jar` 到 `deployment/libs/`
2. 手工修改 RBAC 与 OAuth scopes 配置（新宿主会自动补充 UI selector）
3. 停止 kestra JVM
4. 在宿主已创建真实账号和 UI client 后，手动准备计划并执行 `ApplicationGroupDirectoryCommand preview/apply`
5. 当前统一目录命令已经一次保存全部权限；旧提案中的额外策略初始化命令不再适用
6. 重启容器
7. 重新登录，才有应用组授权

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
     ③ 用户补充 jar 后，若当前 JVM 未装载插件：
        页面显示 docker compose restart kestra 的操作指引，自动等待服务恢复
     ④ 重启恢复后页面自动重新检查，只有参与者实际唯一装载才通过
  → /oidc/setup 页面明确提示：
     "⚠️ 已启用 Kestra RBAC（细粒度授权）
      创建管理员账号后，将自动初始化应用组目录和策略。"
  → 用户填写账号信息，点击 Create account
  → 后端自动完成：
     - 在同一数据库事务中创建账号、UI client、安装记录和插件初始目录及权限
     - 无需用户准备 JSON、执行 Java CLI 或学习 OAuth scopes
     - 正常带 jar 首装不需要重启；仅补放/更换尚未装载的 jar 时允许重启 JVM
  → /oidc/login 登录
  → /ui/main/dashboards + /ui/main/extensions/rbac 管理页面
```

## 3. 三个项目的改造面

### 3.1 kestra-overlay（宿主镜像）— 主要改造

| 改造点 | 说明 |
|---|---|
| `/oidc/setup` 页面渲染 | 使用实际 `kestra.rbac` 配置决定提示，不依赖环境变量是否直接透传 |
| 装载检查 | 必须确认唯一公开首账号事务参与者已装载；约定 jar 路径只用于诊断 |
| jar 缺失时阻断 | 保持服务启动和诊断页可用，阻止账号与安装记录写入，提供具体下载/放置指引 |
| 初始化钩子 | 通过最小通用 SPI 借用 setup 同一事务连接，参与者失败使账号与目录一起回滚 |
| 初始化状态反馈 | 提交时防重复；缺插件恢复时延迟检查，重取 CSRF，不保存密码或自动重放 POST |
| UI 登录 scopes | 仅应用组模式的配置 UI client 自动补充 selector，保留其他 scopes 和模式 A 行为 |

### 3.2 kestra-plugin-rbac（插件）— 次要改造

| 改造点 | 说明 |
|---|---|
| 实现事务参与者 | 消费已发布宿主 SPI，在借用连接上初始化自身目录、统一权限及首用户授予 |
| **一次性初始化** | 仅真正空安装执行，目录已存在或上下文不匹配必须拒绝；无管理员名称旁路 |
| 不增加匿名业务写入口 | 复用宿主 CSRF 保护的 setup，不实现旧提案的独立匿名 initialize API |
| 实际初始策略 | 默认业务范围和完整管理权限在插件 README 公开，可在管理页面复核和修改 |
| 正常首装不重启 | 已在启动时装载的参与者直接初始化，不通过命令行进程或重新装载 JVM 实现 |

### 3.3 kestra-monorepo（根仓）— 最小改造

| 改造点 | 说明 |
|---|---|
| README | 新增"选择是否启用 RBAC"章节，描述两种模式 |
| .env.example | 保持 `KESTRA_RBAC_ENABLED=false` 为默认，新用户不必手工设置额外 scopes |
| docker-compose.yml | 核对实际配置入口、唯一公开 jar 路径和持久卷，不以源码配置代替运行结果 |
| 文档链接 | 在 README 中链接本文档作为详细提案 |
| 真实验收 | 从默认模板、正式镜像与 jar、空数据库走完整首装/首登/保存与权限过程 |

## 4. 关键技术决策点

### 4.1 jar 检查机制

宿主如何判断 `deployment/libs/` 下的 jar 是 rbac 插件？

**方案 A**：按文件名匹配 `kestra-rbac-authorizer*.jar`（简单，但可能误匹配）
**方案 B**：宿主扫描 jar 中的 `META-INF/MANIFEST.MF`，检查特定属性（更可靠）
**方案 C**：约定文件名 `deployment/libs/kestra-rbac-authorizer.jar`（最简单，文档约束）

裁决：文件名约定仍为 `kestra-rbac-authorizer.jar`，但文件存在不能证明已装载。
初始化必须检查公开 SPI 的真实参与者；缺失、重复、版本不兼容或异常都不能继续创建账号。

### 4.2 初始化执行时机

在 `/oidc/setup` 提交时同步执行，还是异步？

**同步**：用户看到进度条，完成后跳转登录页。体验好但 setup 接口可能超时。
**异步**：setup 提交后立即跳转，后台初始化，登录时检查初始化状态。

裁决：同步执行，事务锁与数据库等待有界；不承诺未经测量的十秒总耗时。
不能先返回成功再后台补授权，不能由网页直接执行 Java 命令。

### 4.3 初始化失败处理

如果初始化失败（数据库错误、jar 版本不兼容等）：

- 参与者失败或后续宿主写失败时，账号、client、安装记录、目录、权限及授予一起回滚。
- 独立安装凭据创建前，只有确认事务已经回滚的普通失败才能重新提交。
- 独立凭据损坏、写入中断或提交结果未知仍失败关闭；不得自动删除凭据来重新开放首装。
- 初始化成功但响应丢失时，刷新识别已安装并进入登录，不再调用参与者。
- 既有账号或安装不自动补授管理员；旧安装问题通过显式维护流程处理，不伪装为空安装。

### 4.4 初始化 API 的生命周期

```
真正空安装 + 唯一参与者就绪 → 同源、CSRF 校验后的 POST /oidc/setup 可提交
缺/多参与者或配置异常      → 提示并阻断，无账号或授权残留
initialized（成功）      → GET/POST /oidc/setup 返回404，不再执行初始化
```

设计原则：初始化是一次性事务，不是可以反复恢复管理员权限的幂等接口。
原提案中的 `/api/rbac/directory/initialize` 和 `/api/rbac/directory/status` 未实现，
本次不作为承诺端点。页面就绪查询若需新增，只返回最小状态且不得执行初始化写入。

### 4.5 验收是新用户使用过程

- 测试配置从当前 `.env.example` 开始，除部署凭据、正式产物和 RBAC 开关外不要求隐藏配置。
- 用真实浏览器完成首次访问、提示、创建账号、生产登录、规范路径及 RBAC 管理页面访问。
- 允许保存必须修改明确字段并读回；拒绝写必须比较存储状态，不能只看 HTTP 状态。
- 单一 PostgreSQL 实例内按用例隔离数据库；不读取或重置用户已有账号、目录或数据卷。
- 缺 jar、放置但未装载、重启恢复、普通失败重试、并发首装及完成后入口关闭都有独立断言。
- 宿主负责 setup 组件、语言与主题；插件负责自身页面；root 负责正式组合与生产流程，
  不重复独立仓完整视觉矩阵。独立报告必须对应最终正式输入并实际下载核对。

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

- 当前启用流程：根仓 README "选择是否启用 RBAC"章节
- 插件初始化 CLI：`ApplicationGroupDirectoryCommand` / `ApplicationGroupPolicyCommand`
- Fail-closed 行为：未初始化时 RBAC 拒绝所有请求
