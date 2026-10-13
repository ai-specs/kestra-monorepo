# RBAC 组合验收（2026-10-13）

本次组合严格按 overlay 独立镜像就绪、插件独立 jar 构建、monorepo Compose 集成的顺序交付。
以下版本与结果记录本次测试，不作为后续部署的版本锁。

| 交付物 | 固定版本 / 证据 |
|---|---|
| overlay | `92745d02f05fac77ebb94ecdaf7cf7e998543cca`；[CI 38353758690](https://github.com/ai-specs/kestra-overlay/actions/runs/38353758690) 全绿 |
| 镜像 | `ghcr.io/ai-specs/kestra-overlay@sha256:10788da0c2e470561921177f183f8f3ea290f4a261603f69957c34fb97ff2a00`；commit 标签 `92745d0` |
| 插件 | `41aac28c60c9e9820982b6a5492fc3b7f4f11ce9`；[CI 38355208652](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38355208652) 全绿 |
| jar | 41,551 bytes；SHA-256 `3e364257b17f7a2ee6ded20554350d18b0b216fb5c1a4457f8ecd13998148856` |

验收使用 `scripts/blackbox-rbac.sh` 复用本仓 `docker-compose.yml`，临时 override 和独立
项目名隔离网络、数据库与持久卷。实际挂载独立 jar，核对源文件与挂载副本 hash；从同一
镜像提取真实 host jar，通过插件自有生产 OidcUserService fixture 创建测试用户，明确断言
fixture 未跳过。全部阶段结束后执行 down -v，未启动主部署项目。

完整通过的四阶段为 fixture 准备、真实 jar 启用、缺 jar、授权关闭回归。覆盖：

- 真实 OIDC 密码登录、UI callback/CSRF、DCR、PKCE、consent 与 resource-bound MCP token。
- 无认证 REST 401；reader 写入 403 problem+json；授权域 search 200、跨域和无界查询拒绝。
- writer chunked YAML 创建、实际 runtime flow 执行成功、execution ID 与合法文件输出读取。
- 跨 namespace、路径别名、编码、未知路由、批量、危险表达式和未支持 revision 请求拒绝。
- execution 文件接口拒绝 namespace/global/state/其他 execution 文件、路径遍历及 URI 歧义。
- 同主体 REST/MCP 拒绝一致；scope 拒绝且 RBAC 允许、scope 允许且 RBAC 拒绝均无业务副作用。
- writer 完整 scope 与 RBAC 允许时，真实 MCP 执行成功并恰好持久化一次。
- 缺 jar 时 REST 全局失败关闭、MCP 隐藏工具且拒绝执行；关闭 RBAC 后保留认证并恢复默认业务行为。

拒绝检查比较 flow、execution、pending execution 和队列记录，并检查延迟执行副作用。
验收日志终止标志为 `RBAC COMPOSE BLACKBOX ALL GREEN`；本地完整日志在被忽略的
`.work/rbac-compose.log`。该日志包含早期测试 harness 失败与最终完整成功，不能把中间失败
运行当作完成证据。未通过减少权限断言来获得成功。

复现：

```bash
./scripts/blackbox-rbac.sh \
  ghcr.io/ai-specs/kestra-overlay@sha256:10788da0c2e470561921177f183f8f3ea290f4a261603f69957c34fb97ff2a00 \
  deployment/libs/kestra-rbac-authorizer.jar \
  3e364257b17f7a2ee6ded20554350d18b0b216fb5c1a4457f8ecd13998148856
```

插件的支持路径是明确有限的；其他 REST 路由失败关闭，不代表已实现全部 Kestra API 的
可授权正向操作。列表只支持完整授权域的精确 namespace 查询，批量/导入导出等未解析路径
拒绝。输入、变量、checks、labels 为 literal，输出支持受限 task output 引用；复杂额外资源
读取表达式拒绝。任务内部引擎权限不属于本请求授权沙箱。具体范围见插件 README。
