# 已有安装的上游升级与一致恢复验收

本入口归根仓部署组合验收。它使用正式旧、新镜像与对应插件，在显式指定的已有
PostgreSQL 内创建独立安装，执行真实 HTTP 升级与一致恢复。它补充 `new-install`，
不代替根仓生产浏览器门。离线测试通过不能作为真实升级或恢复通过的证据。

主控已使用正式 v2.0.5 与 v2.0.11 镜像，在已有 PostgreSQL 的独立数据库完成模式 A 真实升级与一致恢复。模式 B 同样使用正式插件完成过真实升级与恢复；最终冻结脚本的模式 A、B 由根仓 CI 串行复核。
辅助 `docs/upstream-upgrade-review-log.md` 提供升级风险线索，不作为产物发布或测试通过的证据。
README 与 CI 的最终集成状态以本次根仓交付记录为准。

## 运行条件与输入

当前 runner 在 macOS/Linux 执行，使用 POSIX 文件权限及 `/dev/null`；Windows 可在 WSL/Linux 环境执行，未验证原生 Windows。
需要 Node.js、Docker Compose、已登录的 GHCR 与 GitHub CLI，以及有管理权限的**已有**
PostgreSQL。脚本不会创建 PostgreSQL 或 network，不停止已有服务，不使用子仓源码或构建工具。
已有 PG 必须运行并加入指定 network。container 必须是实际容器名称，且是该 network 中的
DNS 别名，供 JDBC 连接容器内 5432。SQL、pg_dump 和 pg_restore 均通过 `docker exec` 执行，
不要求 PG 发布主机端口，不使用已有端口转发，也不会修改 PG 的端口或网络配置。PG 容器必须提供 psql、pg_dump、pg_restore；
管理员通过容器内本地连接认证，必要时使用已有 `POSTGRES_PASSWORD`。不得在 CLI 中传入密码。

应用端口必须空闲且大于 1024。应用仅监听 loopback。镜像必须提供 `/bin/sh`、tar、find、
sha256sum、sort 和 sleep；find 必须支持 `-printf`，tar 必须支持 `--numeric-owner` 与
`--same-owner`。这些用于本次 storage 卷备份和观察，不下载额外工具镜像。
脚本以 root 用户运行独占验收应用，以读取 0600 的插件证据和卷；这不是生产用户部署配置建议。

```sh
node scripts/upstream-upgrade-rehearsal.mjs --run \
  --config /absolute/upgrade-input.json \
  --evidence /absolute/existing-parent/new-evidence-directory
```

必须显式 `--run`。证据目录必须不存在，父目录必须存在。目录权限为 0700，文件为 0600；
目录需要遍历权限，故不能设为 0600。目录内包含测试账号、数据库凭据、快照和正式 jar，
必须保留在不跟踪的本地位置。脚本拒绝覆盖已有目录。报告路径为 `report.json`。
成功退出码为 0；任何失败退出码为 1。后续阶段逐项保留 `notRun`，不会伪装为通过。

输入示例（替换全部占位值，计数从所选正式 artifact 的实际报告取得）：

```json
{
  "mode": "B",
  "ownerLabel": "upgrade-20261124-example",
  "appPort": 18199,
  "postgres": {
    "container": "existing-postgres",
    "network": "existing-network",
    "admin": "existing-admin"
  },
  "old": {
    "image": "ghcr.io/ai-specs/kestra-overlay@sha256:<64 hex>",
    "overlay": {"repository":"ai-specs/kestra-overlay", "runId":123, "commit":"<40 hex>"},
    "jar": {"path":"/absolute/old.jar", "sha256":"<64 hex>"},
    "plugin": {
      "repository":"ai-specs/kestra-plugin-rbac", "runId":124, "commit":"<40 hex>",
      "xmlGates":[
        {"path":".evidence/unit/results", "tests":332},
        {"path":".evidence/postgres/results", "tests":115},
        {"path":".evidence/lifecycle/results", "tests":30}
      ]
    }
  },
  "new": {
    "image": "ghcr.io/ai-specs/kestra-overlay@sha256:<different 64 hex>",
    "overlay": {"repository":"ai-specs/kestra-overlay", "runId":125, "commit":"<40 hex>"},
    "jar": {"path":"/absolute/new.jar", "sha256":"<64 hex>"},
    "plugin": {
      "repository":"ai-specs/kestra-plugin-rbac", "runId":126, "commit":"<40 hex>",
      "xmlGates":[
        {"path":".evidence/unit/results", "tests":332},
        {"path":".evidence/postgres/results", "tests":115},
        {"path":".evidence/lifecycle/results", "tests":30}
      ]
    }
  }
}
```

模式 A 必须省略两侧 jar/plugin。模式 B 必须给出两侧 jar/plugin。旧、新镜像必须为不同
完整 digest。测试计数是显式输入，不固定为上例数字；脚本下载正式报告并逐文件核对。
ownerLabel 必须本次独占；脚本另以随机名称隔离 DB、role、volume、应用和观察容器。

## 正式输入门

两侧分别验证完整 commit、精确 repository/runId、push/main、成功完成及对应 workflow。
宿主所有 job 必须成功，必须存在成功 `build-push` 与 `promote`，且精确推广步骤成功，
没有跳过推广。构建日志的 `Candidate image` 必须精确对应指定 digest。随后实际拉取镜像，
核对 RepoDigests 并记录 image ID。

模式 B 实际下载唯一未过期的正式 `kestra-rbac-authorizer` artifact；核对本地与下载 jar
SHA 一致、host-provenance 的 image 对应本侧宿主且包含合法 host SHA。三组 JUnit 报告
必须存在，计数精确匹配，失败、错误、跳过均为零，文件 hash 写入证据。
不能把未发布候选、仅本地 jar 或自报 CI 成功作为正式通过。

此脚本只消费发布产物，不运行子仓报告检查 helper。完整具名 UI 矩阵、宿主 SDK 门及
生产浏览器仍由现有根仓正式产物审计和完整组合门负责；本脚本不宣称覆盖它们。

## 真实流程与判定

1. 核对已有 PG 的实际容器 ID、运行状态、network、名称与 DNS 别名。只在此实例
   创建随机独立数据库和登录 role。role 使用 NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION，
   本次 DB 撤销 PUBLIC 权限，owner 为本次 role。DB 与 role comment 保存 ownerLabel。
   不修改已有数据库 ACL；管理员须选择隔离验收实例，已有 DB 不得依赖 PUBLIC CONNECT
   提供安全隔离。Docker 卷和容器使用 `io.kestra.upgrade.owner` label。创建前必须成功读取完整的容器
   inventory（包含已停止容器）或卷 inventory，并确认精确名称不存在。网络、权限或解析错误
   均停止流程，不将 `inspect` 失败视为不存在。
2. 复用根 `docker-compose.yml` 的应用配置。移除 postgres service 和 depends_on，接已有
   network、本次 DB 与本次 storage 卷，保留认证、静态资源和禁用自动插件下载配置。
   不继承用户 `.env` 或本地部署目录。模式 A 不挂载 jar；模式 B 只挂载对应正式 jar。
3. 旧镜像使用一次生产 bootstrap，setup 禁止开放。通过根 `ProductionOAuthClient` 真实登录，
   核验签名、issuer、subject、audience 与有效期。模式 B 自动首装内置组为 `main`；不支持该
   公开合同的旧版本会失败，不自动转成 legacy-migration。
4. 模式 B 通过公开 HTTP 管理 API 创建测试账号、scope 和 typed permission，赋予
   `company.*` 的 Flow/KV/NAMESPACE 读写能力；完成真实临时密码修改和生产重新登录。
   以该账号在 `company.sub` 创建、读取 Flow/KV，核对具体 description/value。模式 A
   使用 bootstrap 账号执行相同资源操作。
5. 模式 B 用同一有限账号对 `outside.denied` 写 Flow 和 KV，必须均为 403。请求前后比较
   flows、kv_metadata、executions、triggers、execution_outputs、logs、metrics 以及所有名字含
   queue 的 public 表完整行 hash，并比较整个 storage 文件内容清单 hash，持续观察至少
   5 秒。认证与引擎存活表不在业务副作用 hash 中。queues 中仅排除经源码核实的四类 scheduler_event/VNODES_ASSIGNMENT_* 分配协调事件，且不得带 namespace、flowId、executionId 或 tenantId；未知、缺失类型及其他队列事件均保留。完整快照和恢复比较仍包含这四类行。遇到后台业务变化会保守失败，不放宽断言。
   模式 A 不具有细粒度授权，阶段证据标 `notApplicable`，不把范围拒绝计为通过。
6. 停止且确认本次 app 已停止。通过已有 PG 容器内 pg_dump 生成 custom dump，在同一静止
   窗口以数字 UID/GID 归档整个 storage，并记录所有路径（包括卷根目录）的类型、mode、
   数字 UID/GID、符号链接目标与文件内容 hash；归档前后核对无变化。保存旧配置、正式 jar、两侧 digest 与 SHA manifest。快照任何一步
   失败即不启动新版本。日志经根 `redactOwnedServiceLog` 脱敏。
7. 新镜像使用同一 DB/卷及对应 jar，关闭 bootstrap，重新生产登录。核对账号和 setup 状态、
   持久化权限文档以及 setup 访问行为不变；读取旧资源，写入并读回新资源，重复拒绝和副作用
   检查。配置必须禁用自动插件下载，应用日志发现自动下载标志即失败。
8. 升级检查无论成功或失败，停止新 app 后尝试一致恢复。先核验 manifest 与所有快照文件，
   再清本次 DB 的 public schema 并 pg_restore，对数据库比较保留所有持久化输入和业务/队列字段；上游 `fulltext_replace` 使用无序 DISTINCT，
   因而 pg_dump 未保存的生成列 fulltext 在恢复时可能改变词位置。仅对此经数据库元数据确认的
   stored generated tsvector 比较 strip 后完整词项，原始逐表 hash 仍保留。拒绝副作用门仍比较
   完整行，不使用此恢复归一化。再清本次 storage 内容并以 `--numeric-owner --same-owner -p` 解包；逐项核对恢复后的
   mode、UID/GID、路径类型、链接目标和文件内容 hash 全部符合快照，再恢复旧配置
   和对应 jar/digest，最后启动旧 app。任何前置恢复步骤失败都不会启动旧 app。旧版本必须
   读回旧资源、新资源返回 404、账号权限不变，并再次通过范围拒绝。不得直接用旧镜像连接
   新版迁移后的数据库。
9. 全部通过才清理 DB、role、volume。每项必须在本次成功创建账本内，并即时核对 owner；
   DB 另核对 owner role。不会停用户服务，不删除已有 PG/network。失败保留资源与备份，
   尽力停止自有 app，报告保留资源 ID。部分创建后尚未写 owner comment 的资源也保留，
   不凭随机名字清理。清理中途失败也记录尚未删除的资源；最终仍有保留资源或未通过阶段时，
   不得返回成功。主控核对账本与实际状态后处理失败资源。

## 报告与验证边界

`report.json` 保存每阶段状态、正式输入、业务表范围和 hash、资源创建与清理结果。
`publication.json` 保存实际发布关联；两侧 artifact、jar、脱敏应用日志、数据库/storage
备份及 manifest 均保留。错误文本默认不含外部命令原始输出，避免泄漏凭据。

脚本只有所有阶段执行成功才返回 passed；模式 A 的细粒度拒绝以阶段 evidence 内
`notApplicable` 说明。脚本不检查真实 UI、主题、语言、执行重放/暂停/终止矩阵、所有旧版本
迁移兼容，也不对真实用户安装原地升级。它在既有 PG 的本次独立安装上复现已有安装升级。

离线测试：

```sh
node --test scripts/upstream-upgrade-rehearsal.test.mjs
```

测试验证 CLI、输入、正式 CI、发布拒绝条件、证据权限、失败报告、清理归属判定及恢复顺序，
并覆盖 inventory 失败关闭、无需 PG 主机端口、storage 权限/属主不匹配，以及部分创建/清理失败报告。
测试传入的内存命令结果只验证发布拒绝分支，不计真实发布或升级通过。真实门必须在最终
提交对应正式产物上另行执行，并保留报告；未运行时必须明确写为未验证。

## 持续集成与下次升级

根仓 CI 在生产组合验收清理后串行执行模式 A、B。它单独创建带 owner label 的 PostgreSQL，
前一阶段 PostgreSQL 必须已清理；本地执行仍复用现有 PostgreSQL。CI 不上传数据库、storage
备份、配置或凭据，只将逐阶段 report.json 复制到正式报告目录，清理自有临时服务和卷。

`deployment/upstream-upgrade-baseline.json` 是真实升级门的旧版本正式输入，由
`scripts/prepare-upstream-upgrade-config.mjs` 消费。下次升级前将它更新为升级前已发布部署
组合的镜像、两仓提交与 CI、插件 SHA 和精确 XML 数量。不得把候选版本填成旧正式基线。
新版本由根仓 gitlink、`.env.example` 和实际下载的 `release-evidence.json` 取得；配置生成器
下载旧正式 artifact 并核对 jar，真实 runner 再独立检查两侧发布、产物及报告，不信任摘要。

本地也可在完成正式 release selection 后运行配置生成器。设置非敏感的
`UPGRADE_PG_CONTAINER`、`UPGRADE_PG_NETWORK`、`UPGRADE_PG_ADMIN`，运行：

```sh
node scripts/prepare-upstream-upgrade-config.mjs /absolute/release-directory /absolute/new-config-directory
```

输出 mode-a.json 与 mode-b.json 后，按前述 runner 命令串行执行。所有文件保留在被忽略目录。

正式报告检查器为 `scripts/check-upstream-upgrade-report.mjs`。它要求19阶段全部通过、
模式与新镜像匹配、9项真实PG队列判定证明存在、范围外Flow/KV均403、持续副作用观察、
数据库一致恢复及全部自有资源清理。模式A的精细拒绝明确为不适用，不冒称权限通过。
CI上传 mode-a-report.json、mode-b-report.json 及各自 publication.json；不得只看步骤退出码。

旧、新版本还使用生产登录的账号在 `company.upgradeactions` 执行创建、重启、重放、暂停、恢复、
终止六项控制对照。模式 A 要求实际引擎状态：创建/重启/重放 FAILED、暂停 PAUSED、恢复
SUCCESS、终止 KILLED；重启必须增加历史，重放必须生成新执行。

模式 B 的现有正式 REST 适配器只登记执行创建、读取、删除，未登记上述五类控制动作。
独立生产复现确认旧正式 2.0.5 重启也返回403；不得将新版本相同拒绝误报为升级回归，
也不得靠首装身份直接放行。模式 B 两侧都实际创建执行并等待 FAILED，再请求五类控制，
逐项要求403、执行记录不变，并在稳定窗口比较业务/队列/存储无副作用。该结果证明
失败关闭行为保持，不证明模式 B 支持这些 REST 控制。AI 工具的独立授权不是这组 REST
路由的替代能力。需要新增这些业务能力时，先按宿主公开契约提案单独实施。

这些操作只发生在本次独立安装，新执行随一致恢复消失。此门检查 v2.0.11 的异步 tenant
传递变化及既有授权边界，不表示所有批量执行接口或每个异常分支已穷举。它不改变生产 UI。

## 推送根仓前的正式输入复核

上游改变原生组件时，还必须审查根仓 `scripts/native-flow-published-inputs.json` 与
`scripts/native-flow-detail-published-inputs.json`。从最终补丁重放源码独立计算预期输入，
再核对所属仓正式CI下载报告及可用源码包；不得只替换提交号或抄报告hash。列表21项与
详情37项的具名矩阵和诊断要求保持完整；若契约确实变化，先裁决再实施。

根仓提供只读发布门 `scripts/blackbox-application-projects.mjs --publication-check`：
使用与正式 `--run` 相同的 image/jar/sha256/root/overlay/plugin/release-evidence 参数，
核对真实GitHub发布、独立报告、源码锁与产物后，在创建应用或PostgreSQL前停止。
输出 `mode:publication-check`、`publicationOnly:true`，不表示组合验收通过。修改中的根仓
可显式加 `--allow-dirty-root`，仍不放宽独立仓与正式产物要求。该模式不替代完整根仓CI。

正式宿主启动早期同时对复制出的实际 executable 执行 JDK `javap`，读取 ListFlowsTool、
RestartExecutionTool 的真实 `@Tool` 名称。名称必须与根仓受控模型场景一致，且每类只有
一个注解；原始注解元数据与 hash 保存在正式报告，最终检查器再次核对。此门不执行
宿主构建或插件编译。v2.0.11 使用 `list_flows`、`restart_execution`，不兼容旧连字符名。
真实AI调用、确认/拒绝、撤权和副作用仍在末尾生产门执行，元数据不能代替它们。

根仓 job 预算为150分钟；生产组合保留全部检查，升级恢复阶段单独限制20分钟。预算
覆盖历史长业务矩阵、升级门及诊断清理，不保证固定完成时间，也不把提高时限当成提速。

CI实时日志通过 `scripts/ci-acceptance-progress.mjs` 只显示严格白名单整数计数（已通过
阶段、集成检查、REST、UI以及失败和未运行数量）；不回显任意驱动消息或字段。原始日志
写入 artifact 文件并沿用最终脱敏。shell保持pipefail，过滤器成功不能覆盖驱动失败。
计数是运行进度，不是最终验收；必须继续下载和复核完整报告。CLI的shebang必须在首行，
本地推送前执行CI同一语法检查，不能只靠不加载CLI入口的单元测试。
