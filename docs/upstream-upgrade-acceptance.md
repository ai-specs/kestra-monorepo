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

根仓 CI 使用独立的 compose 和 upgrade job，两者均必须通过。upgrade job 内串行执行模式 A、B，
在独立 hosted runner 创建唯一带 owner label 的 PostgreSQL；不与生产组合 job 共享服务或验证树。本地执行仍复用现有 PostgreSQL。CI 不上传数据库、storage
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

v2.0.11 的 `list_flows` 还新增 `total`。生产受控模型门要求精确授权Flow身份集合和
总数同时匹配，模式A三条测试Flow总数3、受限模式B一条总数1；缺失、非整数或范围外
总数失败。该断言读取真实工具原始function response，不由页面可见行数推导总数。

## 本次正式验收记录

2026-11-25 下载审计：根仓 `681ab00` 的 CI `45477269982` 两个 job 成功；生产组合22阶段、
REST56、集成检查147、生产UI88，失败/跳过/未运行均0。独立升级job用时4分31秒，
模式A/B各19阶段全部通过、零保留资源。该记录绑定指定提交；后续文档更正不改变运行产物，
后续代码或配置变化仍须对应检查，不从本记录推断通过。

宿主 `1d50c01` / CI `45407070627`、插件 `feb8230` / CI `45420684400` 已正式发布并
实际下载审计。正式镜像由 `.env.example` 固定，jar SHA和下载命令见根README。
宿主双架构provenance的 completeness=false 限制保留。默认new-install明确排除14项
legacy-migration，不把它们计为通过；schema2 declaration-upgrade9项在正式插件PG门通过。
本次未新增Playground补丁。后续正式 v2.0.11 模式A/B真实浏览器复测均复现未保存流程
运行确认后卡灰、同会话跨流程仍灰及刷新恢复，详见
`docs/playground-run-task-stuck-disabled.md`；不将此既有缺陷计为升级修复成果。
模式B未登记的五类REST执行控制保持403，详见前述范围说明。

## 交付前文档时效性检查

每次升级完成后、最终交付前，主控必须逐项审查三仓 README、部署命令、manifest、
机制文档及验收结论。核对当前版本、正式提交、成功 CI、digest 与 jar hash；检索旧版本、
候选、未发布、移植开发中及待验证。旧版本可以作为明确标识的历史输入保留，不得继续
作为当前部署命令或当前发布状态。行为缺陷以目标版本真实复现判定，不以修复代码形态
代替测试。此门属于升级任务提示词的停止条件，具体模板见
`kestra-overlay/docs/upstream-upgrade-agent.md`。

## 升级实施与停止条件

1. 先完成宿主的补丁适配、公开说明及 manifest 收敛，再冻结发布提交。冻结后执行原有
   完整 CI 与升级新增门；不得为提前更新文档先把未发布 gitlink 推给部署仓。
2. 更新部署 gitlink 前，运行 `scripts/select-application-project-release.py` 的正式输入
   选择流程（先准备独占输出目录及其 `image` 文件），要求该精确提交存在成功的 push/main CI。文档路径过滤跳过的提交没有
   自动取得发布资格；不得以父提交成功代替，也不得移除 selector 的检查。
3. 只要新的宿主发布改变镜像 digest，插件就必须从该正式 digest 独立提取编译输入、
   编译插件 jar、运行自身完整 CI 并发布。源码或 jar 恰好相同不能代替新的输入 provenance。
4. 根仓再固定正式镜像、插件 hash、gitlink 和原生组件输入锁。实际下载并审计独立仓
   的最终报告后，先运行本地相关检查与只读 publication-check，再运行根仓完整 CI。
5. 所有已有必需门保留，不能靠删断言、缩矩阵、把失败变 skip 或增加泛错误豁免使升级
   通过。新增诊断规则必须限定文档代次、请求和错误来源，并保留真实失败回放及负例。
6. 原生组件输入锁必须由最终重放源码独立计算，并与正式报告交叉核对；不能只改提交号。
   异步工具名称和公开注解从正式 executable 检查，真实工具行为仍由生产组合验证。
7. 真实恢复比较区分持久化输入与数据库重新生成的字段：授权拒绝仍比较精确副作用，
   恢复时只对已证明非确定的生成字段作受控语义比较，不扩大忽略范围。
8. 私密证据权限检查使用目标操作系统可验证的方法；Linux CI 与本机分别运行对应门。
   本机通过不能替代 CI，最终必须下载包含隐藏目录的 artifact 并核对内容。
9. 模式 A 不装载插件，模式 B 装载正式插件并执行普通资源授权。既有功能缺口应以
   旧、新正式版本对照定性；保持拒绝不等于支持，不能因首装账号而直接放行。
10. 停止前核对三仓最终提交及远端、所有适用 CI、实际下载报告和产物、模式 A/B 升级
    恢复、生产组合和文档时效性。记录未验证缺陷与合法排除项，不把旧结果挪为新结果。
11. 本地复用唯一 PostgreSQL 时，每个测试使用独占数据库与受限角色，并写入可核对的
    owner。需要主机端口转发时使用单独带 owner label 的辅助容器，不在共享 PostgreSQL
    容器内安装或启动转发进程。清理前复查真实 owner，只删除本次资源，保护用户服务。
12. 升级测试框架或 reporter 后，为 JSON、JUnit 等输出分别指定文件，实际解析最终报告，
    核对精确具名矩阵及失败、跳过和未运行数量。不得只看测试进程退出码；不得让另一
    reporter 覆盖机器读取报告，也不得把不同轮次结果拼接为一次成功。

上述规则也是后续升级任务提示词的必需输入。当前脚本已能拒绝缺少精确发布 CI、
编译宿主镜像不匹配、原生输入锁不匹配及报告矩阵不完整；其余语义裁决仍由主控负责，
不得把影响评估脚本退出零解释为升级可以交付。
