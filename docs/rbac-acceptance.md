# RBAC 组合验收（2026-10-13）

## UI、统计与跨域角色修复（2026-10-14）

运行镜像来自 overlay `c520ab3011f3545df833a40e7b87b7e355315949`，宿主 CI
`38520344869` 通过；部署 digest 为
`sha256:94674d1211e50c7ad6fa67cee95418c73c852746cf853fb912c81fad715d8354`。
插件 `77e56dd28d2cd064e5a2115a89cfd8c6c31a71d3` 的独立 CI `38522290883` 通过。
实际下载 jar SHA-256 为 `914e655b1c8e0d3e25db5ece7981391532711cd381f248e03407438f2cef2748`，
与本地独立编译及部署 jar 一致。本节为指定版本的验收记录，不作为版本锁。

根仓实现提交 `14945b8f4fb8f619722d776faba9a588715d6a55` 的 CI `38522564378` 通过。
下载报告位于 `.work/role-ui-root-artifact/compose-acceptance-38522564378-1/`。
主控核对普通/未知角色浏览器 199/199、启用阶段 API 150 项、管理员 seed/enabled/disabled
各 11 操作和 67 页面，零失败。生产 OIDC 夹具在组合验收中实际执行，未跳过。

检查覆盖：登录规范到 `/ui/main/dashboards`；Flow/Execution usage 按角色域统计；
MCP server 只读查看、受限角色保存和开关拒绝且配置不变；tool-flows 实际表格按 namespace
过滤；未知角色 API 拒绝、独立 403 页面及点击返回登录后换号成功。跨域 multi 为 A 域
读写和 B 域只读，验证 A 写、B 读、B 创建/更新/执行拒绝及域外拒绝，并核对拒绝副作用。
缺 jar 与关闭 RBAC 回归通过。本地正式组合报告位于
`.work/namespace/namespace-bb-20261014062737-60646/`。

本机通过 Compose 更新到上述正式 digest，保留原数据库与存储卷。MCP 编辑页的表单控件
可见性仍由宿主 UI 决定，配置写权限由服务端强制执行。后续仅宿主文档与保存探针变化
不改变此运行镜像；保存探针必须实际修改描述并核对持久化，不能只点击未修改表单。
宿主最终源码 `fa349a1` 的 CI `38524640702` 全部通过，包含修正后的真实保存探针。

## Typed 普通角色本地验收（2026-10-13 18:54 UTC）

本节记录实际检查版本，不作为部署版本锁。宿主 `253e4bab7b6d552b65034aa7c0e88a28abcb6573`
通过 [overlay CI 38445443619](https://github.com/ai-specs/kestra-overlay/actions/runs/38445443619)，
发布镜像 `ghcr.io/ai-specs/kestra-overlay@sha256:211746d77e747cc0f4303fa9a5bd3676e419344eafd520c5b7c59877432da9bd`。
插件 `d08276d01ee1da9b34d57832283f548f204d32ae` 通过
[插件 CI 38448117403](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38448117403)。
实际下载的插件 artifact SHA-256 为
`20642bc0ca05c0cbc56a3d6ef61bcd118b51bc8a63cf638377599743fdf2dc0f`。

本地 `scripts/blackbox-namespace.sh` 使用上述镜像和 jar 执行隔离 Compose 验收。
真实 ego Chromium 浏览器报告包含 170 个检查，全部通过：reader 41、writer 44、
multi 44、exact 41。每个用户检查生产密码登录、7 个菜单、29 个页面、Flow/Namespace
数据范围和列表到详情导航。writer/multi 使用真实 UI 按钮创建、更新、执行和删除 Flow，
并核对持久化结果。reader/exact 使用保存按钮验证拒绝和无持久化变更。

API 检查包括 exact/child/前缀碰撞、分页与 total、KV 范围、Dashboard aggregate 与
global filter 交集、越权创建/执行无数据库和队列副作用、未知 datasource 拒绝。
missing jar 失败关闭和关闭 RBAC 后的正常读取/写入回归通过。
本地日志终止标志为 `NAMESPACE COMPOSE BLACKBOX ALL GREEN`。报告保留在忽略目录
`.work/namespace/namespace-bb-20261013185232-12262/ui.json`，日志为
`.work/namespace-output-local-5.log`。

同一组合的管理员本地验收随后通过：seed、enabled、disabled 各执行 11 个真实 UI 操作
和 67 个页面检查，无失败。操作包含 Flow 创建/更新/执行/删除、KV 写入/更新/删除、
namespace file 上传/读取/删除及 MCP 保存；核对持久化结果。missing jar 和 CSRF 拒绝
通过。日志 `.work/output-admin-local-2.log` 终止标志为 `ADMIN COMPOSE BLACKBOX ALL GREEN`，
报告保留在 `.work/admin-ui/{seed,enabled,disabled}.json`。
插件在独立克隆 `.work/output-independent` 执行 README 构建命令通过；生成 jar hash
与实际下载 CI artifact 一致。此结果不证明当前根仓 CI 已通过。

根仓 workflow 已固定同一浏览器用例与矩阵报告断言。根仓 CI 最终结果仍须核对，
不得将本节本地结果替代 CI 通过证据。

### 后续版本与检查（2026-10-13 21:00 UTC）

角色动作并集修复 `f5070a3` 的插件 CI `38454918085` 通过。READ 与 LIST 可以由不同
角色授予，查询域为两种动作各自 namespace 并集的交集；专属测试验证无共同域不泄漏。
宿主 `253e4ba` 与该插件组合的根仓 CI
[38460010430](https://github.com/ai-specs/kestra-monorepo/actions/runs/38460010430) 通过。
实际下载的根仓报告包含普通角色 170/170 项及管理员三阶段各 11 操作、67 页面，无失败。

随后宿主 `d36ef97f22587343b0c7b37f6525eaa8f9dba2c2` 增加每次 Dashboard repository
查询前的独立 operation，百分比 KPI 分子与分母分别授权。宿主 CI
[38461699215](https://github.com/ai-specs/kestra-overlay/actions/runs/38461699215) 通过并发布
`ghcr.io/ai-specs/kestra-overlay@sha256:1eb1b97210a84e2f6b6bd06e03fec6062736db4c649b12130e974126cb67fb98`。
插件 `d95aae5a4206c28ebc1118a7837c899143659bda` 从该发布镜像编译，插件 CI
[38465592966](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38465592966) 通过。
下载 jar、独立克隆 README 构建 jar 和部署保留 jar 的 SHA-256 均为
`914e655b1c8e0d3e25db5ece7981391532711cd381f248e03407438f2cef2748`。

新组合本地普通角色矩阵 170/170 通过，报告为
`.work/namespace/namespace-bb-20261013204723-53995/ui.json`，日志为
`.work/namespace-query-local.log`。新组合管理员 seed/enabled/disabled 各 11 操作、67 页面
通过，日志为 `.work/query-admin-local.log`。独立构建日志为
`.work/query-independent-check.log`。新组合根仓
[CI 38466093813](https://github.com/ai-specs/kestra-monorepo/actions/runs/38466093813)
已通过，检查根仓 commit `0bfa61b841ea4eeb10c65e9e41c236839220bf59`。
实际下载的 artifact 位于 `.work/green-38466093813/compose-acceptance-38466093813-1/`。
已核对普通角色矩阵 170/170，管理员 seed/enabled/disabled 各 11 操作、67 页面，全部无失败。
生产用户夹具 XML 为 1 个测试、0 失败、0 错误、0 跳过。组合输入报告的部署与插件宿主
digest 相同，CI jar hash 与下载插件 artifact、本地独立编译和保留部署 jar 一致。
CI 的资源清理和脱敏 artifact 上传通过。本次遗留的隔离测试容器、网络与卷已清理；
验证树、依赖缓存、jar 和报告保留。

新组合本地 `scripts/blackbox-rbac.sh` 完整复测通过，日志
`.work/query-rbac-local.log` 终止标志为 `RBAC COMPOSE BLACKBOX ALL GREEN`，覆盖
合法 execution 输出下载及全部路径拒绝、危险 revision/表达式、CSRF、REST/MCP 同主体
允许与拒绝、OAuth scope 与 RBAC 双层拒绝无副作用、missing jar 和关闭 RBAC 回归。

### 最终上下文与跨资源检查（2026-10-13）

最终宿主 `3ed8bad9cf70f978eeed3be985fb9595a2615778` 包含请求上下文缺失失败关闭、
宿主内部调用显式标记、授权来源线程传播及 Execution graph 实际 subflow owner 检查。
HTTP 上下文丢失不得推断为内部全域；异步任务仅传播授权来源，不复制 JDBC 连接或事务。
queue subscriber 使用显式内部来源。宿主定向探针验证 bare thread 拒绝、请求传播后的
exact 范围、内部与HTTP分离，以及展开目标越权时 repository 未读取。
宿主 [CI 38477016533](https://github.com/ai-specs/kestra-overlay/actions/runs/38477016533)
通过，实际发布镜像为
`ghcr.io/ai-specs/kestra-overlay@sha256:f4a9549cd13596b1252475c10d43745f595fe81d1b28066eae41d23b86b81102`。

插件 `826bcbb4be8b6246f0179769e9e6f51fa3e4630e` 从该发布镜像独立编译，
[插件 CI 38479588415](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38479588415)
通过。下载 artifact 位于 `.work/final-plugin-artifact/`；独立克隆 README 构建位于
`.work/final-independent/`。jar SHA-256 与部署保留 jar 均为
`914e655b1c8e0d3e25db5ece7981391532711cd381f248e03407438f2cef2748`。

最终组合的本地普通角色矩阵 170/170 通过，报告为
`.work/namespace/namespace-bb-20261013224418-1396/ui.json`，日志为
`.work/final-namespace-local.log`。本地管理员 seed/enabled/disabled 各 11 个真实操作与
67 个页面检查通过，日志为 `.work/final-admin-local.log`。
本地完整 RBAC/MCP 验收通过，日志为 `.work/final-rbac-local.log`；跨 namespace subflow
runtime 执行正常，授权父 execution 图可读，越权展开返回 403 且无数据库或队列副作用。

最终根仓 commit `07bc9385e8fa010a3fb0eebcc33ad277e63db1f3` 的
[CI 38480112062](https://github.com/ai-specs/kestra-monorepo/actions/runs/38480112062)
通过。实际下载 artifact 为 `.work/final-green-38480112062/compose-acceptance-38480112062-1/`。
主控核对普通角色矩阵 170/170、管理员三阶段各 11 操作/67 页面、生产夹具无跳过、
镜像组合 digest 一致、jar hash 一致、expanded owner 拒绝无副作用，以及清理和脱敏上传。
测试容器已清理。所有验证树、依赖缓存、jar 和报告继续保留，不包含于 Git。

## 历史基础授权验收

本次组合严格按 overlay 镜像 CI 通过、插件独立 jar 构建、monorepo Compose 集成的顺序交付。
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

## 交付流程修正复验（2026-10-13）

插件构建已改为消费已发布镜像，`prepare-host.sh` 不再需要 overlay 源码或重编译宿主。
独立克隆插件仓后执行 README 的镜像提取与 `clean check` 成功；
[插件 CI 38361438281](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38361438281)
使用本仓 GITHUB_TOKEN 读取私有镜像并构建成功。该独立 checkout 产出的 jar 与原 hash 一致，
已复制到本地 `deployment/libs/` 保留，并再次完整通过四阶段 Compose 黑盒。
原 `.work` 工作目录和 overlay checkout 均不作为插件构建依赖。
正常部署使用已发布镜像；替换 jar 后只重启容器 JVM，不构建或发布 overlay 镜像。

最终插件构建流程与产物上传由
[CI 38361859429](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38361859429)
验证通过。已实际下载该 run 的 artifact，确认包含 jar 与宿主镜像 provenance，
jar hash 与上述测试产物一致；本地部署目录保留下载后的 jar。

## 独立项目边界检查

独立仓之间没有源码编译或构建任务依赖。插件需要宿主公开 Java SPI 类型，
该编译依赖从已发布镜像获取，不要求宿主源码、宿主编译或相邻 checkout。
overlay 构建只声明运行时挂载文件名，不读取插件源码或 jar。
跨仓构建顺序、产物选择、部署配置和真实组合测试属于本 monorepo。

已核对交付顺序：宿主镜像 CI 38353758690 于 2026-10-13 06:09:18 UTC
完成；插件最终镜像消费 CI 38361859429 于 07:18:42 UTC 开始、07:20:38 UTC
完成。插件使用的是前者已推广的固定 digest。

边界修正提交 `f020541` 删除 overlay 从环境变量或扩展目录读取 jar 的旧路径，
并拒绝构建目录中的外部插件 jar。6 项脚本测试及结构检查通过；
[overlay CI 38362772725](https://github.com/ai-specs/kestra-overlay/actions/runs/38362772725)
的 patch、镜像构建、bean 探针、MCP、OIDC、浏览器及推广检查全部通过。
插件独立边界规则提交 `242921e` 的
[CI 38362803243](https://github.com/ai-specs/kestra-plugin-rbac/actions/runs/38362803243)
通过。本轮未改变 monorepo 已通过组合验收的部署 digest。
