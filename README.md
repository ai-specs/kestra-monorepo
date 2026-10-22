# Kestra monorepo

## 应用组重构状态（2026-10-22）

当前实施规范见 `docs/application-group-target-model.md`，差异与验收门见
`implementation-gap-report.md`。应用组、scope、应用支持、用户授予、应用权限声明、
管理 UI/API 与业务存储全部属于插件。overlay 只保留标准 OIDC 与只读协议输入机制。
当前是单一 issuer、共享协议端点及经过签名校验的应用组 claim，不提供多 issuer 模式。

宿主 `c2390ff` 的 CI `39712369397` 全部通过并发布，`.env.example` 固定其镜像 digest。
插件 `6f23eeb` 的 CI `39715045248` 通过，实际下载产物与独立克隆构建的 jar hash 一致。
插件 Java 218 项、PostgreSQL 76 项与前端逻辑 39 项通过，薄 jar 与公开契约门通过。
根仓本地空库 `new-install` 通过 REST 56、安全 15、MCP 11 和 UI 99 项，失败与未运行
均为零，资源已清理。开发报告为 nonFinal，最终根提交 CI 尚须取得。历史结果不能
替代当前提交的真实 REST、安全、MCP 和 UI 报告。

根仓要求实际 jar 含插件自有目录、服务、安装 CLI 与新模型类型，数据库包含七个插件
业务表且没有旧宿主组表或 schema1 策略表。安装计划与 scope 使用新字段，不保留旧 API、
首方成员类别、完整恢复、应用组级配置状态或权限声明驱动资源授权的旧路径。

以下旧“应用项目”发布记录仅说明指定版本的历史验收，不是当前应用组的启用说明。

## 应用项目授权交付状态（2026-10-19）

以下记录针对 2026-10-19 的旧项目模型，不对应当前应用组目标。该根提交 `85eb764c5656ccc4056c235072dfb83e830f9964` 的 CI `39263232685` 通过，其指定版本报告为 `completed=true`，失败、跳过和未运行均为零；不得用它证明当前候选已交付。

- 宿主提交：`e10448596ca7fc4564be4621dd60757d6adcc31d`
- 宿主镜像：`ghcr.io/ai-specs/kestra-overlay@sha256:a20b950733fb85216d2155107c9c3423ffce1b5041faa5d4e475836c7e037ae8`
- 插件提交：`fa18839a4f0ecbf41a68a198c6a927963113637`
- 插件 CI：`39246508084`；正式 artifact jar SHA-256：`c5c5acebd6d22e3b8c76ec9a5366cde8e55ff82995a204802899fb75c89a2b7b`
- 验收覆盖 REST `56/56`、MCP `11/11`、安全 `14/14`、迁移 `14/14`、主题语言 `52/52`、组合 UI `98/98` 和目标管理清理。

本节描述开发环境交付，不要求恢复已经不存在的旧开发卷，也不执行生产流量切换。旧数据恢复与迁移脚本保留在 `.work/application-projects/deployment-cutover-final/`，仅供需要时按新生成的预览和批准 hash 执行；复制演练批准不能直接作为新的迁移批准。

本仓组织 Kestra 部署及独立扩展项目，提供统一的 Docker Compose 配置。

| 项目 | 职责 |
|---|---|
| [kestra-overlay](https://github.com/ai-specs/kestra-overlay) | Kestra OSS 增强镜像、内置 OIDC 与 MCP、外部扩展承载 |
| [kestra-plugin-rbac](https://github.com/ai-specs/kestra-plugin-rbac) | 外部细粒度授权 jar、应用组管理、应用声明元数据与 Kestra 实际策略 |

项目使用 git submodule 固定版本。克隆时运行：

```bash
git clone --recurse-submodules git@github.com:ai-specs/kestra-monorepo.git
cd kestra-monorepo
```

已有工作树使用 `git submodule update --init --recursive` 恢复本仓记录的版本。
独立扩展项目使用 `kestra-plugin-*` 名称，各自构建和发布。

复制 `.env.example` 为 `.env`，设置数据库密码、OIDC UI client secret，以及已通过
CI 的镜像 commit hash 标签或 OCI digest（`KESTRA_IMAGE`），运行：

```bash
docker compose up -d
```

访问 `http://localhost:8080/ui/` 完成首次安装。也可以在 `.env` 设置初始用户名与密码，
通过环境变量初始化；首次安装完成后变更初始化变量不会覆盖已有账号。
镜像来自私有 GHCR 包，拉取前需要使用具有 `read:packages` 权限的 GitHub 凭据登录。

数据库和安装凭据分别保存在 `postgres-data` 与 `kestra-data` 持久卷中。
任务插件放在 `deployment/plugins`，应用 classpath 扩展放在 `deployment/libs`。
jar 与配置变更需要重启。授权扩展的文件名和镜像兼容版本以插件项目说明为准。
`KESTRA_RBAC_ENABLED` 默认关闭，启用前需部署完整授权组件和权限配置。


应用组模型与管理使用方法由插件 README 和公开契约定义。管理页面位于
`/ui/main/extensions/rbac`。应用组 scope 对应角色；用户在应用获得的 scope 是应用支持
与用户授予的交集。scope 的名称与说明不授予资源权限。应用权限声明是供查看及 OAuth2
授权页展示的元数据镜像，Kestra 运行时授权由插件自己的实际策略决定。

每个 scope 必须完整提供操作所需的资源、命名空间、资源 ID 和动作，不跨 scope 拼接。
READ 与 MANAGE 分开校验。旧 roles、subjects、role-mapping、instance-admin-roles 和
management-admin-subjects 不能作为新模式配置；协议 scope 不授予资源或管理权限。

启用前必须选择通过正式发布门的固定宿主镜像，并下载匹配插件提交的成功 CI 产物。
插件构建输入见 `kestra-plugin-rbac/host-contract.properties`；不得用本地旧标签缓存或
未发布候选镜像替代。jar 放在被忽略的 `deployment/libs/kestra-rbac-authorizer.jar`。

```bash
gh run download -R ai-specs/kestra-plugin-rbac <成功构建的run-id> \
  --name kestra-rbac-authorizer --dir /tmp/kestra-rbac-artifact
cp /tmp/kestra-rbac-artifact/build/libs/kestra-rbac-authorizer.jar deployment/libs/
```

下载目录必须包含 jar、`.integration/host-provenance.json`、`.evidence/unit`、
`.evidence/postgres` 和测试报告。必须核对实际下载的 jar SHA-256、编译宿主 digest
及该 run 的提交。构建成功、容器启动或页面返回 200 均不能代替授权验收。

默认验收配置是 `new-install`。首次空库先通过宿主标准流程创建初始账号和 UI client，
再停止业务 JVM，在同一安装的数据库与持久卷中按插件 README 执行
`ApplicationGroupDirectoryCommand preview/apply`、`ApplicationGroupPolicyCommand initialize`
及可选声明初始化。组计划、安装前置、审查 hash 和字段由插件公开契约定义；宿主不提供
组初始化 CLI。初始化不能覆盖已有目录，UI client 是第一个内置组的普通应用成员。

历史 schema1 数据只在显式 `legacy-migration` 配置执行迁移与物理回滚验收，不是默认
新安装的交付门。该流程仍须独立审批与真实撤权证据；未执行不能计为通过。

完成插件初始化并核对管理员可达性后，在 `.env` 设置 `KESTRA_RBAC_ENABLED=true` 与
`KESTRA_OIDC_UI_SCOPES=openid,profile,email,kestra:application-group-scopes`，再执行
`docker compose up -d` 更新容器配置。Compose 同时启用 typed、完整评估及
`application-groups`。UI selector 是宿主登录协议机制，不授予普通成员额外身份或权限。
关闭 RBAC 时必须同时将 UI scopes 恢复为 `openid,profile,email`。首次安装的默认
关闭配置只请求这三个标准项，不能提前请求未激活的 selector。普通实际策略变更保存到数据库后对新请求生效，无需重启。
只替换 jar 时运行 `docker compose restart kestra`，重启 JVM 后才装载新 jar。
这些命令使用已发布镜像，不编译插件 jar，也不构建 overlay 镜像。

真实组合验收使用新建的独立 Compose 项目、测试账号和测试数据，不使用用户部署卷。
需要 Docker Compose 2.24.4+、JDK 25、Node.js 24、Python 3、GitHub CLI、私有包读取权限，以及
本地 ego-browser 或 CI Playwright。`scripts/blackbox-application-projects.sh` 的正式入口
核对三个仓库的干净提交、宿主成功发布门和插件实际下载产物。发布证据 JSON 的字段为
`overlayRunId`、`pluginRunId`、`pluginArtifactId`，值必须来自对应提交的真实成功 run。

```bash
./scripts/blackbox-application-projects.sh --run --browser ci \
  --image "$KESTRA_IMAGE" \
  --jar deployment/libs/kestra-rbac-authorizer.jar --sha256 <实际jar-sha256> \
  --root "$PWD" --overlay "$PWD/kestra-overlay" --plugin "$PWD/kestra-plugin-rbac" \
  --release-evidence <已核对的发布证据.json>
```

本地浏览器调用 `application-project-ui-fixture.mjs` 的
`runRootApplicationProjectWithEgo`，传入本次已有任务空间的 Page；不得创建重复空间。
本地与 CI 共用 56 个 REST 探针、MCP 业务断言及 4 主题 × 13 语言 UI 矩阵。
默认只运行一个 PostgreSQL 服务。错误 issuer 与缺插件用例需要辅助 JVM 时，在该 PostgreSQL
创建独立测试数据库，并保留 owner 校验；MCP 阶段结束后立即清理辅助实例。
默认使用 `new-install` 配置，从空库初始化新模型，必须通过身份边界、撤权、故障、
副作用和完整 UI 检查。历史 schema1 的 14 项迁移检查明确列入范围外，不计为通过或跳过。
只有确实需要验证已有 schema1 数据时，额外传入
`--migration-releases deployment/application-project-migration-source.json`，选择
`legacy-migration` 配置并执行全部历史迁移和物理回滚检查。开发需求迭代不要求反复迁移旧测试数据。
`--static` 仅检查入口和模块，`--config-check` 仅检查 Compose 配置。
`--allow-dirty-root` 只用于开发，始终输出 `nonFinal=true`、`completed=false`，不得用于交付。
失败和未执行项保留在报告中，不计为通过。
隔离测试将 pending client 的保留时间设为协议允许的 120 分钟，并通过真实 owner 同意和
S256 换码激活需要编辑的测试 client；该设置不改变生产 Compose 的注册默认值。
分页验收逐页比较实际授权 ID 和非空页总数。当前宿主在超出末页时返回空结果与
`total=0`；该空页不用于计算授权总数。删除和输出读取分别包含资源 READ 子操作，
测试 scope 显式授予 FLOW 的 READ+DELETE，或 EXECUTION 的 READ+LIST+ACCESS_OUTPUTS，
以满足执行仓库的查询范围检查；二者均不授予 UPDATE。
`deployment/application-project-migration-source.json` 是隔离迁移演练的旧正式产物输入，
由迁移驱动实际消费；它不锁定用户部署，也不代表当前运行版本。驱动再次下载并核对
旧成功 CI artifact、host provenance 与发布门；失效或不可获取时必须失败，不能用缓存替代。

回退检查停止 JVM 和 PostgreSQL 后备份本次测试的数据卷，并保留逻辑 dump 供诊断。
物理恢复必须核对归档、全部业务字段、策略、身份目录、队列、存储和安装凭据，不能
忽略恢复时重算的全文索引。迁移前已经注册的 client，其旧 code/refresh 必须返回
`400 invalid_grant`。回退后新建 client 已不存在时，只在备份集合、签发基线、恢复后
数据库查询共同证明这一事实，且没有签发新凭据或产生副作用时，接受 `401 invalid_client`。

缺 jar 的隔离环境仍必须开启完整授权门。REST 和工具列表拒绝之外，MCP 调用可以返回
宿主固定的组件失败结果；只有实际镜像、缺失挂载、启用配置和完整无副作用观测均已
核对时，才计为组件缺失时失败关闭。普通授权拒绝不接受通用执行失败作为通过证据。

根仓 CI 下载独立插件 CI 的 jar，执行同一组合入口；不以根仓临时编译的 jar 代替独立
插件发布。私有发布仓的 Actions run 和 artifact 需要额外的跨仓只读访问；根仓 Actions
secret `APPLICATION_PROJECT_RELEASE_READ_TOKEN` 必须具有 overlay 与插件仓 Actions read
权限。源码 deploy key 与 GHCR packages read 不替代该权限；不得在文档或聊天中提交凭据。
最终必须实际下载根仓 CI 报告，核对提交、镜像 digest、jar hash、失败和跳过。
当前实现与历史结果必须分开判断：
[RBAC 验收记录](docs/rbac-acceptance.md) 的“应用项目完整 scope 验收”节记录本次已通过的
组合；其他历史章节只证明其指定版本和检查范围。后续版本必须重新核对自己的成功 CI。
目标模型与当前实现状态见 [应用项目授权模型](kestra-plugin-rbac/docs/application-projects.md)，
公开宿主机制见 [镜像说明](kestra-overlay/README.md)，插件维护和迁移见
[插件说明](kestra-plugin-rbac/README.md)。
