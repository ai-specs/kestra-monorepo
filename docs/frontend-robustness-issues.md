# 迭代需求：前端健壮性优化

## 主控核实与实施裁决（2026-11-04，优先于下方初始推断）

下方保留原始问题记录。现象、根因推断和修复建议不是同一级证据，不能直接据此指定
新增宿主 patch。当前输入为 root `5b50b16`、overlay `c4a1eb2`、plugin `6ec194a`。
实施与发布状态见根仓 `implementation-gap-report.md`，本节不声明修复已经发布。

| 标识 | 核实结果与目标 | 负责项目 |
| --- | --- | --- |
| FR1 | 全新隔离数据库及存储、保留旧自有 JWT 时，生产 UI 文档请求超时；相同请求仅去掉旧 JWT 则立即进入认证链。宿主独立真实 HTTP 回归亦复现未知 kid 请求超时。需修复本地认证回退链，并保留有效签名、claim、生命周期和公开 userinfo 检查 | overlay；root验证生产恢复 |
| FR2 | 插件默认详情加载后，规范路径回传会再次清空详情。目标是可见内容连续且最终规范路径正确，不要求 Vue 内部只 render 一次；仍须重读授权，不能跨身份保留敏感数据 | plugin；只有独立证据证明通用宿主缺陷时再改 overlay |
| FR3 | 原新增 `kestra.telemetry.enabled` 没有关闭当前产物的事件上报；运行时两个 usage flag 仍为 true，浏览器实际发出 events 请求。现有公开配置为 `kestra.anonymous-usage-report.enabled` 与 `kestra.ui-anonymous-usage-report.enabled`；两者关闭后已在本地观察到 flag=false 且无 events 请求 | root部署配置；不新增遥测服务 |

必须保留的边界与验收条件：

- FR1 覆盖未初始化与已初始化、文档与运行中 API、失效与撤销会话、并发失败去重；
  403、503及网络失败不得误触发首装，不得循环跳转或自动重放写请求。
- 只清数据库但保留安装凭据文件时，现有安装身份保护必须继续拒绝重新首装。
  测试只能重置本次 owner 的数据库和存储，不得对用户部署运行 `down -v`。
- FR2 覆盖默认应用与 scope、query、直接访问、快速导航、过时响应、权限拒绝及草稿保护；
  独立插件真实浏览器验证内容连续性，根仓验证生产规范路径和业务流程。
- FR3 验证运行时配置和实际请求，不以配置文本存在代替；遥测异常不得阻断业务。
  本地空实现与自建遥测服务不属于本轮必须交付范围。
- 中文英文验证真实交互，其他宿主语言验证 key、非空及插值；独立仓和 root 分层验收。
  最终必须对应正式产物和最终提交成功 CI，实际下载核对报告，不继承旧绿色结果。
- HTTP 客户端可以携带正确 Origin、CSRF token 与 cookie 验证安全正反条件；它与真实
  浏览器互补。“不能用 HTTP 客户端测试 CSRF 表单”不是正确的通用结论。

## 背景

在验证 kestra-monorepo 模式 B（RBAC 部署）的过程中，记录了下列三类问题。

---

## 问题 1：遗留 cookie 导致白屏，而非自动跳转登录

### 现象

当用户从旧版本部署切换到新版本（数据库被清空或重置）时，浏览器中遗留的旧 session cookie 会导致：
- 访问 `/ui/` 时白屏
- 而不是自动清除本地状态、跳转到登录页或 setup 页

### 复现路径（已验证）

1. 完成模式 B 部署，创建管理员账号并登录成功
2. **不退出登录**，执行 `docker compose down -v` 清空数据库
3. 重新启动服务（`docker compose up -d`）
4. 浏览器停留在原页面（`/ui/main/extensions/rbac/...`）
5. 观察：
   - 后端日志：前端请求 `/oidc/userinfo` 返回 401
   - 浏览器**没有跳转**，还停留在原 URL
   - 页面内容为空（白屏）

### 复现证据

后端日志：
```
GET /oidc/userinfo HTTP/1.1 | status: 401 | ip: 127.0.0.1 | length: 182
```

浏览器状态：
- URL 不变：`http://localhost:8080/ui/main/extensions/rbac/application-groups/main/applications/~a2VzdHJhLXVp`
- 标题不变：`访问控制 | Kestra`
- 页面内容为空

### 根因分析（代码证据）

**后端代码**（`OidcSetupController.java`，0133 patch）：
```java
// POST /oidc/setup 成功后，303 跳转到 /ui/
return HttpResponse.seeOther(URI.create("/ui/"))
    .header("Cache-Control", "no-store")
    .cookie(Cookie.of("oidc_setup_csrf", "").path("/oidc/setup").maxAge(0));
```

**问题流程**：
1. 用户提交 setup 表单成功
2. 后端 303 跳转到 `/ui/`
3. 前端路由加载 `/ui/`
4. 前端带着旧的 session cookie 去请求 API
5. API 返回 401（因为数据库已清空，用户不存在）
6. **前端没有正确拦截 401**，没有清除本地状态，没有跳转
7. 结果：页面停留在原 URL，白屏

**关键缺陷**：
- 前端缺少全局的 401 拦截器
- 或者路由守卫没有检测到认证状态已失效

### 预期行为

```
API 返回 401 → 前端拦截器捕获 → 清除本地 session/token → 自动跳转到：
  - 如果数据库未初始化：跳转到 /oidc/setup
  - 如果数据库已初始化：跳转到 /oidc/login
```

### 验收条件

- [ ] 数据库清空后，带旧 cookie 访问 /ui/ 不白屏
- [ ] 自动跳转到 setup 或登录页
- [ ] 用户可以正常重新初始化或登录

### 修复位置

- 项目：`ai-specs/kestra-overlay`
- 文件：前端 API 拦截器 / 路由守卫（待定位）
- 优先级：高

---

## 问题 2：RBAC 扩展页面 tab 切换两次前端渲染

### 现象

在 RBAC 扩展页面（`/ui/main/extensions/rbac/`）中：
- 应用 tab 和 scopes tab 切换时，前端有两次渲染闪烁
- URL 变化：从列表页 → 详情页，中间有两次前端渲染

示例：
- `/ui/main/extensions/rbac/application-groups/main/applications/`
  → `/ui/main/extensions/rbac/application-groups/main/applications/~a2VzdHJhLXVp`
- `/ui/main/extensions/rbac/application-groups/main/scopes/`
  → `/ui/main/extensions/rbac/application-groups/main/scopes/admin`

### 复现路径

1. 完成模式 B 部署，登录
2. 访问 `/ui/main/extensions/rbac/`
3. 点击 "应用" tab
4. 观察：页面有两次渲染闪烁
5. 点击 "scopes" tab
6. 观察：页面有两次渲染闪烁

### 根因分析（代码证据）

**当前流程**（`kestra-plugin-rbac/ui/src/App.vue` 第 243-250 行）：

```javascript
if (!selection.value && (scope || app)) {
  const key = scope ? encodeURIComponent(scope.key) : encodeKey(app.clientId)
  await navigateHost(groupBase.value + '/' + tab.value + '/' + key, {replace: true})
}
```

**问题流程**：
1. 用户点击 tab → 路由切换到列表页（如 `/applications`）
2. 前端组件挂载 → 加载列表数据
3. 自动选中第一个项
4. 路由再次切换到详情页（如 `/applications/~a2VzdHJhLXVp`）
5. 前端组件再次挂载 → 加载详情数据

**结果**：路由切换了两次，导致两次渲染闪烁。

### 优化方案

**借鉴传统 SSR 思路：先确定选中项，再一次性渲染最终页面**

**优化后流程**：
1. 用户点击 tab
2. **先在后台加载列表数据**（不切换路由）
3. 知道第一个项是什么
4. **一次性路由切换** → 直接跳转到详情页（如 `/applications/~a2VzdHJhLXVp`）
5. 前端组件挂载 → 加载详情数据

**好处**：路由只切换一次，没有中间的列表页闪烁。

**用户体验**：
- 点击 tab 后，页面保持当前状态，显示加载中
- 数据加载完，直接跳转到第一个详情页
- 没有闪烁感

### 预期行为

- 路由切换时只有一次渲染
- 没有闪烁感
- 用户体验流畅

### 验收条件

- [ ] tab 切换时只有一次路由跳转
- [ ] 没有明显的闪烁
- [ ] 最终 URL 正确（直接到详情页，不经过列表页）
- [ ] 数据加载正常，内容完整

### 修复位置

- 项目：`ai-specs/kestra-plugin-rbac`
- 文件：`ui/src/App.vue`（第 243-250 行附近的自动选中逻辑）
- 优先级：中

---

## 问题 3：遥测 API 500 错误（已临时关闭）

### 现象

RBAC 扩展页面 tab 切换时，前端会请求 `https://api.kestra.io/v1/reports/events`，返回 500 错误。

错误信息：
```json
{
  "message": "Internal server error: Failed to convert argument [events] for value [null]..."
}
```

### 临时解决方案

已在 `docker-compose.yml` 中添加 `telemetry.enabled: false` 关闭遥测。

### 后续优化方向

1. **短期**：保持遥测关闭
2. **中期**：实现本地空实现的遥测，避免前端报错
3. **长期**：实现本地遥测服务，替代 api.kestra.io

### 修复位置

- 项目：`ai-specs/kestra-overlay`
- 文件：遥测相关配置 / 前端事件上报代码
- 优先级：低

---

## 备注

- 问题 1 和问题 2 都需要在 `kestra-overlay` 项目中通过新增 patch 修复
- 修复后需要重新构建镜像并验证
- 问题 3 已有临时解决方案，后续优化

---

## 已排除的误判

### 误判：POST /oidc/setup 返回 403 "Access denied"

**现象**：用 PowerShell `Invoke-WebRequest` 测试 POST /oidc/setup 时，一直返回 403。

**根因**（代码证据）：
```java
// OidcSetupController.java 第 88-91 行
if (!sameOrigin(request.getHeaders().get("Origin")) || !validToken(token)
    || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), cookie.getBytes(StandardCharsets.UTF_8))) {
    return HttpResponse.status(HttpStatus.FORBIDDEN);
}
```

CSRF 验证有三个条件：
1. `sameOrigin(Origin)` - Origin header 必须和 issuer 一致
2. `validToken(token)` - token 必须有效
3. `token == cookie` - token 和 cookie 必须匹配

**我的测试失败原因**：
- PowerShell `Invoke-WebRequest` 没有自动带 `Origin` header
- `sameOrigin` 方法在 origin 为 null 时返回 false
- 导致 CSRF 验证失败，返回 403

**结论**：
- ❌ 不是系统有问题
- ✅ 是我的自动化测试方法不对
- ✅ 浏览器手动提交是正常的（浏览器会自动带 Origin header）

**教训**：
- 不要用简单的 HTTP 客户端测试带 CSRF 保护的表单提交
- 必须模拟浏览器的完整行为（Origin header、cookie 等）

