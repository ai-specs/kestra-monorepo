# Kestra monorepo

## 应用项目授权交付状态（2026-10-19）

当前新模型已在本地开发环境完成最终组合验收。根提交 `85eb764c5656ccc4056c235072dfb83e830f9964` 的 CI `39263232685` 通过，最终报告为 `completed=true`，失败、跳过和未运行均为零。

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
| [kestra-plugin-rbac](https://github.com/ai-specs/kestra-plugin-rbac) | 外部细粒度授权 jar、应用项目与完整 scope grants |

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


RBAC 新模式以应用项目的 OAuth2 scope 绑定完整本地 grants。数据库是唯一运行时策略
来源。每个 scope 独立限定资源、命名空间、资源 ID 和动作；多个 scope 不得拼接授权。
列表先在单个 scope 内求 READ 与 LIST 范围交集，再合并各 scope 的有效范围。
旧 roles、subjects、role-mapping、instance-admin-roles 和 management-admin-subjects
不能作为新模式的运行配置。协议 scope 和旧 roles claim 不授予本地业务权限。

共享身份项目、scope 上界、client 成员和 subject 授予归宿主身份目录；完整本地 grants
和本地绑定归插件。IDENTITY、LOCAL_POLICY、BUSINESS_INSTANCE 管理域互不包含，
READ 与 MANAGE 不互含。管理页面在 `/ui/main/extensions/rbac`，账号创建不自动授予权限。
共享目录保存与本地绑定保存是独立动作。目录变化后必须重新登录并完整核对本地策略。

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

首次空库使用插件 README 的 schema2 `initialize`。已有 schema1 策略必须先备份数据库、
存储及安装凭据，执行显式 `preview-migration`，逐项审核旧角色到新 scope 的对应关系，
再用完整报告的批准 SHA-256 执行 `migrate`。身份目录通过宿主公开 CLI 审核和激活。
本地迁移批准不等于身份授予已经成功。迁移必须撤销旧会话、code、access/refresh token
和 MCP session，验证新管理员可登录、普通账号允许与拒绝范围，以及部分成功时失败关闭。
不得覆盖初始化已有策略，也不得仅换 jar 作为完整回退。

完成身份目录激活和本地迁移后，在 `.env` 设置 `KESTRA_RBAC_ENABLED=true` 与
`KESTRA_OIDC_UI_SCOPES=openid,profile,email,kestra:project-scopes`，再执行
`docker compose up -d` 更新容器配置。Compose 同时启用 typed、完整评估及
application-projects；UI 的 selector 只用于已批准的第一方成员。
关闭 RBAC 时必须同时将 UI scopes 恢复为 `openid,profile,email`。首次安装的默认
关闭配置只请求这三个标准项，不能提前请求未激活的 selector。普通本地策略变更保存到数据库后对新请求生效，无需重启。
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
