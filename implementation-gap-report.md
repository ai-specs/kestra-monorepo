# 应用组目标模型实施差异报告

状态：调查记录，2026-10-20。目标以 `docs/application-group-target-model.md` 和维护者本次裁决为准。下表中的源码是当前 Git 工作树事实，不是新模型依据；发布输入和历史验收不能证明新模型已实现。

## 当前组合检查（2026-10-21）

- overlay `6a7184554bb9dde0b6f4c5ffb128e075025ee948` 的 CI `39481985700` 通过；镜像 digest 为 `sha256:3db0323ec0b949b13be33f3dacb504a4881d0316ad14d11d95da98724647cd8d`。
- plugin `ead09d675b4a1ea7423a5e55d143709fa203b974` 的 CI `39497274115` 通过；下载的 jar SHA-256 为 `dadebf3499a8b2027a4af3211bf677b4fe167498853b748cbe5dfc3289cc37dd`，provenance 指向上述宿主镜像。独立克隆按 README 运行构建命令，通过并产生同一 jar hash。
- 根仓隔离 `new-install` 使用上述正式输入，在本地开发模式下实际执行 REST `56/56`、MCP `11/11`、安全 `15/15`、UI `98/98`；失败、跳过和未运行均为零，历史迁移 14 项明确排除。故障注入后重启隔离宿主 JVM，核对仍可读；资源已按 Compose 项目清理。报告入口为 `.work/application-group-acceptance/local-run.log` 最后一轮首行指向的 `report.json`。该报告的 `nonFinal=true`、`completed=false`，不能替代根仓最终提交 CI。
- 当前组合仍是过渡模型。旧 `projects` API、应用组级 `resourceIntents/managementIntents`、全组 `reconciliation`、`applicationProjects` 策略字段和用户可见旧文案仍存在。现有矩阵保留了部分历史模型用例；全绿只证明该发布组合的已执行断言，不能宣称新目标模型全量交付。下一阶段必须先按 overlay 的“应用组管理授权边界提案”删除共享意图和全组恢复，发布宿主后再更新插件与本仓矩阵。

## 2026-10-21 阶段证据

> 后续组合诊断：正式旧镜像和 `860a12b` 插件产物的隔离 `new-install` 已通过首装、目录激活、声明初始化和 REST `56/56`。缺插件用例在生产登录流程出现循环；overlay 源码缺口已按宿主公开机制归因，`dd5f6c3` 修复候选在本地 CI 全链通过，正式 CI `39475687713` 尚在运行。之前 `0361458` 镜像不得充当该修复的验收输入。报告路径由 `.work/application-group-acceptance/local-run.log` 的首行指向，失败用例与已通过 REST 检查均保留。

> 修复发布更新：overlay `dd5f6c3a69e9081c7d0d60ebf4c8c67955d2de60` 的 CI `39475687713` 全部通过，镜像 digest 为 `sha256:b40482b44fb1af5902dd57985770411fe0be27ab567fc66a8de8419461becce5`。插件已将编译输入改为该正式镜像；提交 `7833ed6` 的独立本地检查通过、CI `39478808913` 运行中。根仓仍须用这对最终正式输入重测缺插件及其后续片段。

> 第二次组合诊断：使用上述正式输入再次通过 REST `56/56`，缺插件用例的 UI 登录回调后文档返回 401。失败已定位到 overlay 的 `OidcTrustedIdentity.validate`，它在零 scope 情况也要求声明提供者。宿主 `0362` 补丁已追加零 scope 验证分支和拒绝非空 scope 的定向测试；新 CI 与发布仍待执行，旧镜像不得作为修复证据。

> 第二次修复发布：overlay `6a7184554bb9dde0b6f4c5ffb128e075025ee948` 的 CI `39481985700` 全部通过，镜像 digest 为 `sha256:3db0323ec0b949b13be33f3dacb504a4881d0316ad14d11d95da98724647cd8d`；插件已将正式输入固定到该 digest，提交 `a792f1a` 的独立克隆构建通过，CI `39484521574` 运行中。缺插件回调与后续 UI/MCP 组合仍须复测。

> 第三次组合诊断：`a792f1a` 的 CI `39484521574` 已通过。隔离 `new-install` 的 REST `56/56`、MCP `11/11`、缺插件登录与无副作用拒绝、UI 测试数据准备均通过；本地 CI 浏览器首次因 `NODE_PATH` 未指向已安装 Playwright 停止。修正工具环境后，浏览器发现插件入口已改为卡片而旧断言仍定位表格。卡片筛选/分页已归插件仓修正，插件提交 `b220f86` 的独立克隆检查通过，CI `39491647145` 运行中；根仓共用浏览器断言已改用真实卡片 DOM，尚未完成真实浏览器重测。此阶段仍未证明新目标模型全量交付。

- 宿主 `036145814a0abf9eed6c43953bc75e213b879585` 的 CI `39453574911` 全部通过；已发布镜像为 `ghcr.io/ai-specs/kestra-overlay@sha256:f42f4bc98b419e59f165287ea460f0f9900a33ae76562784e9bbe2d5d6e11881`。已下载 `host-scoped-tests` 报告至 `.work/application-group-host-ci-0361458` 并执行报告数量检查。该版本只交付 scope 名称、受限删除、声明只读 SPI、新签名 claim 与部分复查，仍保留旧项目对象、应用组级意图和完整恢复机制。
- 插件 `09d1dfb47ab3761a9dcc250647eaa6ac4564b447` 的 CI `39466995207` 通过，产物 jar SHA-256 为 `a2a6d5c0b3d71d51984d3a1c6220139a22b5616b80ed43009d7397526a84cd9c`。已下载 `.work/application-group-plugin-ci-09d1`，核对宿主 provenance 与单元 `150/150`、PostgreSQL `37/37`；该提交漏跑新增声明表的 PostgreSQL 用例。修复门的插件提交 `4232bda` 已推送，其最终 CI 与产物仍须重新核对。根仓尚未运行新模型 Compose。UI 构建与 40 项旧逻辑测试通过，不作为新模型 UI 验收。
- 本地按上述正式镜像 digest 校验 OCI index、manifest 与全部层 SHA，并导入 Docker；标准 `prepare-host.sh` 从该 digest 拉取镜像和提取 jar 成功。独立克隆 `.work/application-group-plugin-independent` 从 `09d1dfb` 执行 README 构建入口，jar hash 与 CI 一致。新增声明表的 PostgreSQL `2/2` 已通过，单个带 owner label 的临时容器已清理。下文“核对基线”记录调查启动时状态，不是此刻的 HEAD。

## 核对基线

- 实际环境为 Darwin；根仓 `f269468`，领先 `origin/main` 三个提交；根仓仅有未跟踪的用户文件 `.env.bak-round-ap`，本次未读取其内容。
- overlay 为 `e10448596ca7fc4564be4621dd60757d6adcc31d`，与本地 `origin/main` 一致，工作树干净。
- plugin 为 `5607a17e4a37ae97224fd28fc29c02c67fa6568f`，领先本地 `origin/main` 一个文档提交，工作树干净。根仓 submodule 指向该提交；用户提供的 jar 对应旧提交 `7b163d5a6dd5121920ed2a2b18d9d9c243700f96`，不能视为新模型产物。
- 根仓最近可见成功 Compose CI 为 `39388109303`，对应 `fe59082`，不是当前 HEAD。`3360530` 对应 CI `39381943065` 失败。当前 HEAD 没有可用的最终成功 CI 证据；本报告未运行 Compose。
- `docs/application-group-target-model.md` 已存在，状态为当前实施规范。`docs/application-project-ui-terminology-optimization.md` 保留裁决和调查线索；plugin 的 `docs/application-projects.md` 与 `docs/application-project-implementation.md` 已标记为历史设计，不作为新目标。

## 目标、现状和所属仓

| 目标或检查项 | 当前源码证据与差异 | 所属仓、公开契约及验收门 |
|---|---|---|
| 全栈“应用组”名称 | overlay `patches/webserver/0360-application-project.patch` 的 `Project`、`projectId`，`0363-application-project.patch` 的 `oidc_project_state`；plugin `src/main/java/io/kestra/extensions/rbac/project/ProjectPolicy.java` 的 `applicationProjects`；root `docker-compose.yml` 与 `scripts/application-project-*.mjs` 均沿用 project。 | overlay 改公开身份契约、claim、持久化与配置；plugin 改策略/API/UI；root 改部署和测试。先冻结英文标识，再按宿主发布、插件发布、Compose 验收顺序实施；禁止旧别名。 |
| scope `key/name/description` | overlay `0360` 的 `ScopeDefinition` 只有 `scope`、`description`，没有独立 `name`；plugin `ProjectPolicy.ScopeDefinition` 只有 `description`、`enabled` 和 grants；UI `App.vue` 以 `scope` 原值编辑。稳定 key 已有近似字段，但目标三字段不存在。 | scope 业务语义与管理 UI 归 plugin；跨应用共享登记及签发所需公开目录字段归 overlay 最小契约。测试创建、读取、唯一性、key 不可改、name/description 的已裁决修改规则、token 只使用 key。 |
| 应用支持 scope 登记 | overlay `0360` 的 `ClientMembership.allowedProjectScopes` 和 `0363` 的写入/验证已经记录 client 范围；`0362` 签发检查与用户授予交集。它仍与当前旧目录和 first-party 规则耦合，不能直接等同目标的应用主动声明。 | plugin 负责应用页业务和登记接口；overlay 负责签发端消费已发布的支持范围。测试应用新增/移除支持、申请范围、撤权与 refresh；正式镜像先发布。 |
| 应用权限声明元数据 | 现有 `allowedProjectScopes` 只是字符串集合；overlay `ScopeDefinition.resourceIntents/managementIntents` 和 plugin 完整 grants 是旧授权/上界模型。未发现按应用、scope、权限 `key/name` 的独立 CRUD 模型。 | plugin 负责元数据模型、存储、API、应用页 CRUD 与展示；若签发和授权页需跨进程读取，overlay 只新增最小公开消费机制。测试 CRUD、授权页可读名称、支持范围变化；证明元数据不驱动应用运行时资源授权。 |
| 用户 scope 授予 | overlay `0360` 的 `SubjectAssignment.projectScopes`、`0363` 的 replace/revoke 与 `0362` 的交集逻辑已存在，但仍使用 project 字段。plugin `ui/src/App.vue` 的 assignments 页代理共享目录。 | overlay 维护可信身份与签发/撤权公开机制；plugin 管理应用组内授予 UI/API。测试真实账号登录、`应用支持 ∩ 用户授予 ∩ 请求`、撤权、refresh、零授权及拒绝无副作用。 |
| 运行时权限事实来源 | plugin `ProjectTypedPolicy.java` 读取 `ProjectPolicy` 中完整 grants 并调用 `ProjectAuthorization`；overlay `0362` 校验目录 scope/意图。当前资源授权依赖插件策略，不依赖尚不存在的应用权限声明副本。旧 shared intent 上界、目录版本联锁与新元数据定位冲突。 | 当前 Kestra 应用运行时事实来源尚待维护者裁决。plugin 必须明确内部策略与声明副本的分界；overlay 只保留实际需要的可信身份机制。测试更改声明元数据不会悄悄更改资源权限；资源允许/拒绝仍按已裁决事实来源。 |
| issuer、应用组 claim、audience | overlay `0362` 的签名身份 claim 为 `kestra_project_v1`，内有 `project_id`、`project_scopes`、`client_id`；校验 `configuration.getIssuer()` 与 `project.issuer()`。`0363` 使用单一 OIDC 配置 issuer 并保存项目 issuer。plugin `ProjectTypedPolicy.java` 消费可信 `identity.issuer()`、`projectId()`、audiences。共享端点和精确 issuer 方向有基础，但 claim 和模型仍是 project，项目自身 issuer 字段需收敛。 | overlay 改签发和验证的应用组 claim，保持共享 discovery/authorization/token 与标准 `iss` 精确校验；plugin 只消费发布的可信契约。安全测试签名、错 issuer/audience/client/应用组、旧 claim 拒绝、refresh；root 用正式组合复测。多 issuer 不在本轮。 |
| scope 删除约束 | overlay `0363` 提供 create/update scope，公开接口未见 deleteScope；`ClientMembership.allowedProjectScopes` 可表达使用关系，但没有“全部应用登记不再使用才可删除”的端点与冲突检查。 | overlay 的共享目录持久化/公开操作须实现原子删除检查；plugin 管理 UI/API 暴露受限删除。测试有任一应用登记时拒绝且状态不变、全部登记退出后允许、并发和旧 token 撤权。用户授予的处理仍待裁决。 |
| 首个内置应用组不可删除 | 目前未见项目删除 API；这是功能缺省，未见明确的内置识别与服务端不可删除约束。`firstPartyUi` 是 client 标记，不等同内置应用组。 | overlay 的共享目录约束，plugin 显示内置状态；测试首个组删除始终被拒且数据库不变，其他组行为按已裁决需求。内置识别方法待裁决。 |
| 卡片、只读详情、显式编辑 | plugin `ui/src/ProjectList.vue` 是表格，固定“操作”列和编辑按钮；`ui/src/App.vue` 的 overview 直接展示可编辑表单，未区分进入详情与点击编辑。 | plugin UI/API 区分 READ/MANAGE；root 真实浏览器覆盖卡片点击、键盘、只读、编辑/取消/保存、只读账号、主题/语言/窄屏和存储结果。 |
| 旧术语与流程 | plugin `ui/src/App.vue` 的 `independentSaves` 横幅、`localStatus` 列、`identityDirectory`、`localPolicy` 与 reconciliation 页仍可达；`ui/src/translations/*.json` 包含旧文案。plugin 管理路由仍有 `/projects/{id}/reconciliation`。root UI 测试仍执行完整恢复。 | plugin 删除目标用户概念并调整 API/UI；overlay 检查旧全组 revision/意图上界机制的必要性；root 替换测试行为。保留并发和撤权安全，不把旧恢复改个名称继续提供。 |
| 默认验收 profile | root `scripts/application-project-integration-cases.mjs` 与 `check-application-project-report.mjs` 已区分 `new-install` 和 `legacy-migration`，后者 14 项不计入默认结果。当前矩阵仅证明旧模型。 | root 改成目标模型测试并保持 profile 隔离；正式发布输入下运行 REST、MCP、安全、撤权、refresh、无副作用、UI、缺插件、关闭功能；只在显式 `legacy-migration` 运行旧 schema1/物理回滚。 |

## 实施方案与风险顺序

1. **已裁决阻塞项。** 维护者授权主控裁决；英文目标标识、Kestra 运行时权限事实来源、范围外 scope 整体拒绝，以及内置识别、first-party 标记与字段规则已写入 `docs/application-group-target-model.md`。实施须以这些冻结规则为准。
2. **先冻结公开宿主边界。** 对照现有 OIDC 和目录机制，明确共享身份/签发端所需的最小公开契约及实际失败路径；若需 overlay 修改，先在所属能力文档提出未发布扩展点并完成宿主独立测试和正式镜像发布。最高风险是签发、撤权、issuer/audience 与旧 claim 混用。
3. **再重构插件模型与管理面。** 将应用组 scope、用户授予、应用支持登记、应用权限声明副本和 Kestra 实际资源策略分开；实现独立 API/UI 和受限删除。高风险是把声明副本误当授权事实、跨 scope 拼接、旧目录修订恢复流程残留。
4. **最后更新根仓组合。** 选正式镜像与独立发布 jar，先本地 `new-install` 全矩阵，再触发最终提交 CI 并下载报告；旧迁移只在显式 profile 运行。UI 与实际请求结果、拒绝副作用、缺插件和关闭功能均须核对。

本报告只完成差异调查和实施排序。目标模型的大规模修改、发布和新模型验收尚未开始。
