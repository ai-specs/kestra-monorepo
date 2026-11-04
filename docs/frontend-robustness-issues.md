# 迭代需求：前端健壮性优化

## 背景

在验证 kestra-monorepo 模式 B（RBAC 部署）的过程中，发现两个前端 UX 问题。这两个问题在生产环境中也可能出现，需要修复。

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

### 预期行为

- 路由切换时只有一次渲染
- 没有闪烁感

### 验收条件

- [ ] tab 切换时只有一次渲染
- [ ] 没有明显的闪烁

### 修复位置

- 项目：`ai-specs/kestra-overlay`
- 文件：`ui/src/components/extensions/ExtensionPage.vue`（0384 patch 已在处理扩展导航）
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

