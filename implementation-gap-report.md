# 应用组目标模型实施差异报告

## 2026-10-22 当前交付验证

正式组合为宿主 `c2390ff` / CI `39712369397`，插件 `6f23eeb` / CI `39715045248`。
已实际下载插件 artifact `12398852521`，核对 Java 218 与 PostgreSQL 76 项零失败、零跳过，
provenance 与镜像 digest 一致，jar hash 与独立克隆构建一致。正式 jar 保留在忽略的
`deployment/libs/kestra-rbac-authorizer.jar`。

本地完整新安装验收通过：REST 56/56、安全 15/15、MCP 11/11、UI 99/99，52 个主题语言
组合及目标声明 CRUD、撤权、退出换号通过，失败和未运行为零，历史迁移 14 项明确排除。
缺插件旧凭据/新授权拒绝及无副作用、关闭功能、实际七表与产物门通过。默认一个 PostgreSQL，
辅助 JVM 与其独立数据库已阶段清理，最终 owner 容器、网络与卷已清理。证据为
`.work/application-group-final-acceptance/local-new-install-passed-nonfinal.json` 及第七轮日志。
该报告因开发期根仓未提交而保持 `nonFinal=true/completed=false`；最终提交 CI 和下载报告
仍是交付门，不能把本节写成最终 CI 已通过。下方记录是各阶段的历史调查。

## 2026-10-22 执行权限恢复

第四轮正式新组合实际通过 REST 56/56、安全 15/15、MCP 11/11 与聚合。缺插件专项核对
旧会话/refresh 拒绝、新授权 invalid_scope、code/token 无新增及辅助数据库清理。UI 已通过
声明 CRUD、用户撤权、退出换号、卡片只读详情及主要编辑；完整 UI 在 scope 标签的子串
匹配歧义处停止，root 已改用精确文案定位，正在第五轮完整重跑。第四轮所有 owner 资源
已清理，失败报告为 `.work/application-group-final-acceptance/ambiguous-tab-failure-report.json`。
仍没有最终根提交成功 CI，不将这些部分结果写成三仓交付完成。

宿主修复提交 `c2390ff22705135ba2773bce23aab27bb4e9472b` 的 CI `39712369397` 全部通过，
镜像 digest 为 `sha256:50315684e3826c4fafadac834ed1fc5438c3e2c77c394740634b59a1f6591024`。
实际下载后端与两种首装浏览器报告，全部规定数量门通过；CI 中缺投影专项也实际执行。
插件新候选 `6f23eeb` 已使用该正式输入，本地完整 Java 218、UI 逻辑 39、PostgreSQL 76
通过，独立克隆构建与 jar hash 一致，CI `39715045248` 已通过构建门，正在执行 PostgreSQL。
CI `39715045248` 现已全部通过，正在下载新 artifact `12398852521`，根仓仍未取得最终新组合成功证据。

正式产物组合第三轮实际通过 REST 56/56、安全 15/15 和 MCP 前 10 项。缺插件启动后的
标准登录失败归因于宿主会话过滤器，新宿主提交 `c2390ff` 已通过完整本地 CI 与镜像专项并
推送，CI `39712369397` 正在运行。UI 首轮暴露卡片仍按表格定位与不支持的 `:has` 选择器，
已在 root 修正；插件账号 guard 对实际策略的多 audience 错用了单个调用人 audience，
修复及新增回归通过本地 Java 218 项，最终发布输入仍须等待新宿主。没有把该轮未完成的
MCP/UI 记为通过。失败与清理报告保留在 `.work/application-group-final-acceptance/`。

宿主正式提交 `de8a0c05d9f9b9832a52a33fee02b841ec9af453` 已推送，CI `39702163788`
的 patch-verify、build-push、oidc-blackbox 和 promote 全部通过。已下载后端 artifact，
按当前数量门核对应用组与类型化授权 XML 通过。镜像 digest 与浏览器 artifact 正在核对；
插件已消费该正式输入，三仓最终验收尚未完成。

插件提交 `14b062a227332f73c3aab4c61b1c7f1fc953b561` 已推送，CI `39707713761`
正在运行。独立克隆使用 README 的正式产物入口完成 `clean check`，Java 217 项、前端逻辑
39 项与薄 jar 门通过，jar SHA-256 为 `4cd6f049c7d4c8aa98d10341f081f4d1fa036ad7ad78954eb79627e3ecdf693c`。
本地 PostgreSQL 发布门最终 75 项通过。插件当前包含自有业务目录、只读协议提供者、
生命周期 guard、事务内身份复查、受限删除与安装 CLI，不再依赖旧宿主业务 SPI。
正式插件产物下载和最终 Compose 仍待执行，不将本地 jar 当作发布产物。

插件自有存储已新增借用连接与事务安全锁回调，真实 PostgreSQL 26 项通过；新增安装计划
校验 8 项在 H2/纯模型检查通过，合计 34 项。根仓安装计划已对应新业务字段，移除首方成员
标志和旧目录快照字段。根仓辅助实例已改为复用主 PostgreSQL 的独立数据库，保留数据库
与容器 owner 校验；MCP 阶段后立即清理辅助实例。以上根仓新路径只通过语法检查，实际
组合须等待正式插件，不得作为通过证据。

当前会话权限已更新。直接执行 `docker ps` 与 `docker compose ls` 成功，均没有运行中的资源；GitHub API 查询也已成功。下文访问拒绝记录仅说明权限更新前的限制，不再是当前阻塞。主控已在新的独立宿主验证树运行完整本地 CI，日志为 `kestra-overlay/.work/application-group-unrestricted-ci.log`。正式宿主发布、插件消费和最终组合验收仍须按顺序取得新证据，不能沿用历史绿色结果。

实施顺序维持为：先完成宿主只读协议机制的完整构建、PostgreSQL 和镜像验收并正式发布；再完成插件业务接线与独立发布；最后更新 root 正式产物并运行完整 `new-install`。风险优先级为事务锁与撤权、单 issuer 和签名绑定、安装及最后管理员保护、插件业务持久化与 API、真实 UI 和最终提交证据。

## 2026-10-22 当前职责迁移进度

宿主签发、refresh、可信身份读取和 consent 描述已接入当前账号/client 的只读协议投影。这些运行路径不再读取宿主组表、完整组目录或 `firstPartyUi`，不使用权限声明副本限制资源授权或另设 scope 开关。scope 仍按应用支持与用户授予求交，并检查标准协议注册；零授权标准 UI 登录不产生组 claim，旧授权码和 refresh 不得因 provider 恢复而自动取得组身份。

宿主账号/client生命周期现已通过同连接guard接线；旧组CRUD、可写目录SPI、业务管理SPI、初始化CLI及组表迁移已经移除，不保留兼容转发。最终候选40补丁重放、57份相关主源码编译、25份源码逐字节核对和源码职责门通过。进程内检查为可信身份10项、授权12项、consent控制器5项、账号guard6项、client guard7项、MCP异步5项、协议契约/查询13项，共58项。PostgreSQL签发/集成13项与guard7项只通过源码编译，未执行；控制器方法探针不作为网络HTTP或浏览器证据。

发布构建新增实际executable的公开类型、旧业务类型/表与字节码依赖检查；本轮确实拒绝保留的旧executable，没有新产物通过证据。宿主32项错误归属或旧模型检查随实现退役，不计通过；业务行为的归属、已有覆盖与未完成门已记入插件设计。插件当前4项模型、7项变更、12项存储检查在H2通过，包含新增内置外键与删除/创建并发；没有消费未发布宿主产物。

普通pending client接入前置冲突已在宿主源码修复：新增标准pending登记只读查询，生产authorize和说明渲染使用只读consent预览；应用支持须先由插件登记，最终绑定、token和refresh仍只接受已完成确认的有效client。预览/批准之间撤销支持时返回OAuth错误，不绑定凭据。插件取得正式宿主输入后仍须实现pending登记接线，root生产OAuth helper现有“DCR→登记→重新登录→consent”顺序保留，未用模拟结果证明真实组合通过。

本轮重新核对环境：Docker socket访问仍被拒绝，GitHub API仍无法连接，不能执行数据库容器、镜像发布和CI核验。真实数据库、完整构建、HTTP/浏览器和最终产物门未通过之前不得发布；随后仍按正式宿主→正式插件→root完整new-install顺序交付。

进一步诊断覆盖40补丁影响的全部140份主Java源码和82份测试源码，均编译通过。主源码涵盖core24、jdbc7、queue1、webserver108；只启用Lombok，没有生成Micronaut bean/index或执行JUnit，不能扩大解释为完整宿主构建通过。再次尝试项目Gradle9.7.1的`:webserver:compileTestJava`，在创建`FileLockContentionHandler`时因socket权限被拒绝而终止，未进入任务。日志为同审查目录的`all-patched-main-compile.log`、`all-patched-test-compile.log`和`full-gradle-compile-attempt.log`。

本轮证据在 `.work/application-group-ownership-review/pending-consent-replay-tests.log`、`pending-protocol-replay-tests.log`、`pending-consent-source-audit.log`、`pending-consent-replay.log`、`current-docker-access.log` 和 `current-github-access.log`；原始树为 `kestra-overlay/.work/application-group-pending-consent-replay`。旧executable拒绝证据仍保留在同目录。三仓尚未收口，未执行项不计通过，不沿用旧CI或旧产物替代最终提交证据。

## 当前最高优先差异：业务归属纠正

维护者最新边界明确 plugin 负责应用组、scope、支持、用户授予、管理与存储，overlay 只提供公共机制和激活点。前序候选曾把 `JdbcApplicationDirectoryV1`、组 CRUD、内置/退役表和组初始化 CLI 放在 overlay，属于主控沿用旧实现的错误，现已从宿主候选移除。插件业务接线尚未完成；不能用源文件命名、宿主源码编译或纯探针通过替代最终业务验收。

纠正顺序与风险：P0 执行宿主pending consent阶段边界及生命周期的真实数据库/HTTP门，再完成正式宿主发布；P0 组CRUD、内置/退役、引用约束和初始化在plugin接线；P1 验证撤权、最后管理员、锁顺序、连接复用与回滚；P2 按正式输入完成独立插件发布和root组合验收。完整方案归所属仓文档：overlay `docs/r-oidc-server.md` 的职责纠正提案，plugin `docs/application-groups.md` 的职责迁移方案。禁止插件据未发布新 SPI 编译。

本轮已在插件新增纯业务 `ApplicationGroupDirectory` 模型，包含组、scope、应用支持、用户授予和不可变快照，未引入宿主 DTO、表或未发布 jar。仅使用 JDK 与现有 JUnit 编译并运行4项模型测试，通过稳定 key/元数据边界、支持与授予交集、重复/未定义引用拒绝及快照不可变检查。证据为 plugin `.integration/application-group-owned-model-compile.log` 和 `application-group-owned-model-tests.log`；不证明业务存储、初始化、最后管理员或真实协议适配已完成。

root 产物门现额外要求插件组业务模型、存储和初始化命令；新安装表门改为要求 `rbac_application_group_*`，并禁止宿主 `oidc_application_group_*` 业务表，防止再次接收错误归属组合。组存储已有内部候选，初始化命令和业务接线尚待实现，旧宿主组 CLI 调用也已改为插件目标入口；这些是待实现的新门，不是已有可运行产物。下方旧候选各阶段证据保留，但不代表最新职责和最终验收通过。

插件自有模型4项、业务变更7项、存储10项测试通过，未使用宿主 jar。覆盖稳定 key、应用支持与用户授予独立变更、所有应用释放后的受限删除、内置组固定、退役 ID 禁止复用、引用和 client 唯一性、并发、溢出回滚及撤权记录不一致失败关闭。存储测试已接入 PostgreSQL profile 和真实后端标记门；本轮实际执行 H2，不计 PostgreSQL 通过。原始日志复制到 `.work/application-group-ownership-review/plugin-owned-storage-compile.log` 和 `plugin-owned-storage-tests.log`。存储尚未接入管理 API、初始化 CLI、最后管理员和宿主协议投影；不证明完整插件构建通过。

宿主 `0370` 新增只读协议投影、事务内标准协议查询和身份生命周期 guard 契约，并实现不返回凭据的标准查询与统一安全锁。固定 BASE 的42补丁重放、65份相关主源码编译、投影5项纯契约与标准查询6项探针通过。新增职责边界门已接入宿主正式构建与本地 CI，并实际拒绝当前仍保留旧组业务和未迁移调用点的重放树；不能凭这些编译/探针通过发布。证据入口为 `.work/application-group-ownership-review/host-protocol-state-tests.log`、`host-protocol-state-replay.log` 和 `host-boundary-rejection.log`；设计和具体实现归宿主文档，不是 root 的业务实现。

本轮重新核对 Docker 与 GitHub 访问：Docker socket 连接被权限拒绝，`gh run list` 无法连接 `api.github.com`。当前会话仍受文件系统与网络限制，不能修改运行会话的启动参数，也不能自行提升权限。Git 元数据此前已确认不可写；三仓尚未提交或发布。禁止把旧 CI、离线定向测试或已有正式 jar 作为本轮最终提交证据。

状态：初始调查与持续实施记录。目标以 `docs/application-group-target-model.md` 和维护者本次裁决为准。下表保留首次调查时的源码差异；后续状态按日期记录，不得将初始差异当作当前发布事实。发布输入和历史验收不能证明新模型已实现。

## 当前未发布变更核对（2026-10-21）

- 实际环境为 Darwin，三仓 HEAD 分别为根仓 `3b51ebb`、overlay `d50199d`、plugin `d74488c`，均存在未提交修改。本次没有覆盖用户备份。
- overlay 候选已从 scope DTO 删除 `active/resourceIntents/managementIntents`，保留稳定标识、名称、说明和修订；`scripts/local-ci.sh` 的现存日志末尾为 `ALL GREEN`，本次补丁结构门重新运行结果为 `PASS=15 FAIL=0`。证据分别为 `kestra-overlay/.work/application-group-scope-local-ci.log` 与 `kestra-overlay/.work/application-group-scope-structure.log`。候选尚未提交、发布。
- plugin 候选新增独立 `ScopeCatalog/DirectoryScope` 目录投影，不再用空 grants 的实际策略对象表示目录角色。实际策略仍拒绝空权限；目录名称和说明不授予资源动作。相关独立 Java 测试实际执行 `38/38`，无失败；覆盖目录名称及修订变化、未声明的应用内部映射保持无授权、未知 scope 整体拒绝、实际策略的 namespace/动作限制和管理权限。另有存储管理测试 `7/7`，覆盖普通保存、并发修订冲突和最后管理员保护。证据为 `.work/application-group-scope-review/application-group-policy-tests.log` 与同目录 `application-group-policy-management-tests.log`。这些检查使用已发布宿主输入（`host-provenance.json` 与实际 jar hash 一致），不代表完整插件构建、插件 CI 或 Compose 验收。
- plugin 候选已删除恢复 HTTP 路由、专用授权方法、整组覆盖存储入口、UI 恢复组件、标签、跳转和 13 语言恢复文案。策略授权不再把插件保存的目录修订与当前目录锁死；宿主可信身份修订与撤权校验仍保留。scope API/UI 输入已收窄到标识、名称、说明。UI 逻辑 `36/36`、公开 SDK 翻译检查与 UI 构建通过；相关日志已保存到同一证据目录。5 项旧 UI 恢复组件/helper 测试随已移除行为删除，不计为跳过或通过；Java 目录旧意图测试由独立目录模型测试取代。真实管理 HTTP 与浏览器组合仍未验证。
- 前序曾用未发布候选宿主 jar 编译插件，该结果不作为交付证据。正式插件仍必须等待宿主 CI 及正式镜像，再从固定 digest 提取输入并完整编译和验证。
- 当前执行沙箱拒绝写入 `.git/modules/kestra-overlay/index.lock`，所以本次提交未形成；访问 GitHub 与本机代理连接被拒，Docker socket 也被拒。不得将这些未执行门标为通过，也不得重复触发旧提交 CI 代替新提交证据。本次未创建 Compose 资源，既有资源状态因 socket 权限无法重新核对。
- plugin 策略 schema 已删除旧 `directoryRevision` 字段，API 与解析器拒绝旧字段；身份新鲜度与目录分页仍保留其独立目录修订。应用组卡片不再合并策略记录，scope 表格只展示标识、角色名称、说明；已移除默认操作列及普通应用表单的首方 UI 标志。旧身份目录、本地绑定、分开保存翻译键已删除。
- Kestra 实际权限表单与 API 均已迁入配置所标识的具体应用：`application-groups/{id}/applications/{clientKey}/runtime-permissions`。API 对目标组、当前应用及 READ/MANAGE 分别校验；GET 只返回目标策略，写入只返回修订回执。旧全局 `/policy`、策略 `/projects`、`roles/bindings/role-mappings` 处理器已删除，无兼容入口；scope 策略体使用 `scopeKey`，旧 `name/id/directoryRevision` 输入拒绝。Java 控制器定向 `13/13`，UI 逻辑 `38/38` 与构建通过。包含无 READ 的合法写入且无策略泄露、只读拒绝全部写操作、错误应用/关闭功能/缺配置无副作用，以及精确响应目标与原型属性检查。证据为同一目录 `application-group-controller-tests.log`、`application-group-ui-logic.log`、`application-group-ui-build.log`；未访问真实 HTTP 或浏览器。
- 组目录 API/UI 路径已迁移至 `application-groups`，成员使用 `applications`，用户授予使用 `scope-grants`；旧 `/identity/projects` 注册已删除，旧 UI 页面路径不会自动转入新入口。scope 输入已使用 `key/name/description`，响应为插件 `ApplicationGroupScope` DTO 的 `applicationGroupId/key/name/description/revision`，拒绝旧字段、改 key 请求、错误组和错误 key 的宿主投影。宿主 SPI 中的 `projectId/scope` 仍未改名，当前适配并不证明宿主目标模型完成。
- UI 模块已改为 `application-group-model.js` 与 `ApplicationGroupList.vue`，无旧模块别名。修复声明新增仍要求 `scope.active` 的残留：当前定义、应用支持登记、尚无声明的合法 key 才可新增。最终本轮 Java 控制器定向 `14/14`、UI 逻辑 `39/39`、翻译检查和 UI 构建通过；其他定向仍为策略 `38/38`、存储 `7/7`。证据仍位于 `.work/application-group-scope-review/`，不是完整插件 CI 或真实 HTTP、浏览器验收。
- 成员和授予公开字段已移除 project 命名：应用使用 `supportedScopeKeys`，用户授予使用 `scopeKeys`，响应均使用 `applicationGroupId`。详情校验精确目标，用户授予额外校验 issuer。普通 API 不接受首方标志；新增成员使用 false，更新由目录适配器保留现有宿主标志。旧字段拒绝测试与投影测试已执行；适配器保留标志新增测试仅有源码，完整执行仍待匹配宿主正式发布，不计通过。
- 本轮控制器 Java 层定向 `16/16`、UI 逻辑 `39/39`、翻译检查和 UI 构建通过，策略及存储仍为 `38/38`、`7/7`；证据保存于同一 `.work` 目录。控制器模拟宿主目录，未验证真实 HTTP、签名身份、CSRF 或完整目录适配器，不替代最终发布门。
- overlay `0360/0363` 已加入显式 `builtInApplicationGroupId` 安装计划字段、审批 hash 绑定、安装记录非空外键、只读 ID 查询及受限组删除候选。内置删除拒绝；其他组须无 scope、应用和用户授予引用，且修订精确匹配。41 个补丁已从固定 BASE 顺序重放，结构 `15/15`、计划测试 `4/4`、相关源码和数据库测试源码编译通过。数据库持久化/删除/并发、完整本地 CI、正式 CI 和镜像尚未验证；旧 scope 候选的完整本地 CI 不能证明新候选。证据在 overlay `.work/application-group-builtin-*.log`，插件不得以该候选 jar 编译正式产物。
- 插件策略 JSON 集合已改为 `applicationGroups`、管理目标为 `applicationGroupIds`，旧字段严格拒绝；Java 值类型改为 `ProjectPolicy.ApplicationGroup`，未保留旧值类型。schemaVersion 暂为 2，不将此变更算作历史 schema1 迁移验收。删除普通组后的旧内部策略和管理引用不再阻塞其他组编辑，也不保留管理授权；仅原样保留或撤除旧引用，新无效目标拒绝。新增控制器测试验证真实策略存储结果，当前定向为控制器 `17/17`、策略 `38/38`、存储 `7/7`、UI 逻辑 `39/39` 与构建通过；Docker socket 复核仍被权限拒绝，数据库与真实删除组合尚未运行。
- 后续插件内部命名已改为 `applicationgroup` 包及 `ApplicationGroupPolicy/Parser/Authorization/PolicyBoundary/ManagementSafety` 等核心类型；服务、配置、存储、写入和 CLI 也改为 `ApplicationGroup*`，无旧类型转发。值类型现为 `ApplicationGroupPolicy.ApplicationGroup`，上一条记录的是该阶段的中间名称。验收脚本同步测试完整名称。新安装表已改为 `rbac_application_group_policy_head/snapshot`，空库新表创建和 JSON 持久化 H2 测试 `1/1` 通过；原定向策略 `38/38`、管理存储 `7/7`、控制器 `17/17` 仍通过。正式 clean 编译、旧类排除、完整插件 CI 和 PostgreSQL 仍待验证。
- overlay 当前命名候选已将公开 `Project/ProjectInput` 改为 `ApplicationGroup/ApplicationGroupInput`，身份字段为 `applicationGroupId/applicationGroupScopes`，成员支持为 `supportedScopeKeys`，scope 定义和输入为 `key/name/description`。快照、计划字段及 `oidc_application_group_state/bootstrap/invalidation` 表同步；内部包为 `oidc.applicationgroups`。从固定 BASE 顺序重放 41 补丁和结构门通过，60 份相关主源码编译、纯契约与计划测试 `16/16` 通过；数据库及登录集成测试源码编译通过但未运行。当前验证树是 overlay `.work/application-group-naming-replay-3`，旧 `.work/application-group-model-dev` 保留但命名已不匹配，不能覆盖最新补丁。证据为 overlay `.work/application-group-naming-*.log`。
- 此宿主候选尚未发布。插件仍固定旧正式宿主 digest，当前 Java 适配代码仍使用该发布 SPI 的旧访问器；以上插件定向结果不能证明新宿主兼容。必须先完成宿主完整测试、正式 CI 和镜像发布，再以其固定 digest 运行插件 `prepare-host.sh`、适配新 SPI、clean 编译和独立 CI，最后根仓验证新组合；不得用本地宿主候选 jar 编译插件交付。
- 删除安全复核发现组 ID 复用会重置版本，可能在后续操作中重新匹配旧凭据。主控裁决组 ID 按安装生命周期唯一，overlay 候选新增事务内 `oidc_application_group_retired` 记录，创建同时检查现存与退役 ID；被拒删除不写入，内置组始终拒绝。创建/更新公开方法补齐为 `createApplicationGroup/updateApplicationGroup`，无旧别名。本次验证树为 overlay `.work/application-group-retirement-replay`：41 补丁重放、60 份主源码编译、纯契约 `16/16` 与结构门通过；20 项目录 PostgreSQL 用例及登录集成仅源码编译，未运行，不能沿用 naming-replay-3 或旧数据库结果。Docker socket 复核仍被权限拒绝，证据在 `.work/application-group-retirement-*.log`。
- 已修正目标文档把“多应用组”误列为延期的冲突：当前新增组仍使用真正单一 issuer，仅多 issuer 单独延期。组 ID 退役及普通组受限删除的授权裁决同步到 `docs/application-group-target-model.md`；该裁决不是数据库验收通过声明。
- 插件实际策略入口复核后补上“当前应用确实登记为目标组成员”的检查。配置 client ID 不能单独证明成员关系；通过公开目录适配器在当前组快照修订读取精确成员，核对组、client 和成员版本。普通成员不需首方标志；缺登记或错误返回值拒绝且策略存储不变。允许的目录调用仅为成员 FIND，不授予目录写入权。控制器 Java 层定向现为 `18/18`，策略 `38/38`、管理存储 `7/7`、新表 H2 `1/1` 仍通过，未作为新宿主兼容、真实 HTTP 或并发验收证据。
- 宿主公开授权码绑定和 token/claim/audience 方法也已去除旧 Project 命名；发布检查器同步新类名。最新验证树为 overlay `.work/application-group-token-contract-replay`：重放41、主源码编译60、纯契约16项通过，额外身份/V2/MCP异步撤权13项实际通过。18个必需测试类的源码计数静态核对通过，但不代表数据库套件执行；相关证据按 `docs/r-oidc-server.md` 入口保存。完整 Gradle 编译尝试先遇用户目录锁权限，工作区缓存方案仍被本机锁协调 socket 权限拒绝，日志保留，未宣称全量构建通过。数据库、正式CI及镜像没有新增通过证据。
- 根仓验收输入开始同步目标模型：策略集合/目标字段改为 `applicationGroups/applicationGroupIds`，移除策略目录修订及组级权限意图；安装计划使用新组快照、scope key、应用支持字段与显式内置组 ID。默认驱动更新 CLI 包名和策略命令名，安全无副作用快照增加内置登记、退役 ID 和声明表，并使用新表名。输入形状检查生成19个scope、56个REST探针、13个测试账号且通过；仅检查数据生成，未连接应用或数据库。
- 新产物预检模块 `scripts/application-group-artifact-contract.mjs` 已接入真实 jar 的 artifact-inputs 阶段及最终报告检查器，并纳入执行源码 hash。要求12个新核心类、无旧核心类/包和重复类；以本地保留旧正式 jar（SHA-256 `e344b7e53dab54aa021596922a732cf336019178218570515c7bb91bcaaf5b92`）验证确实拒绝，混合模型/重复类拒绝检查也通过。尚无新正式 jar 的通过证据，不能用该检查推断运行兼容性。证据为 `.work/application-group-root-input-review/input-audit.log` 和 `artifact-preflight.log`。根仓旧恢复 helper、管理/UI调用和真实断言仍须全面替换，当前不能执行或宣称新模型矩阵通过；legacy-migration 仍单独保留，不记通过。
- 核心管理 helper 现为 `ApplicationGroupManagement`，删除 `reconcile/mutateIdentity` 和完整策略恢复回调，不提供旧 helper 别名。`mutateDirectory` 写入后只重新登录、读取实际组和核对签名身份 epoch；`saveRuntimeScope/updateRuntimeAudiences` 使用具体应用实际策略 API、强 If-Match、最小回执及独立读取验证，不因目录修订自动重存策略。OAuth 验证 helper 和报告身份字段改为 `applicationGroupId/applicationGroupScopes`，仍先验签和精确核对 issuer、client、audience，再读组 claim。新安装 MCP 撤权改为独立的应用实际策略、指定应用支持登记、用户授予撤销，禁止再停用组 scope。对应默认检查 ID 同步；数量仍为11项，不表示运行通过。
- 内存请求轨迹检查已验证目录写入不触发策略保存、实际策略精确改动且其他 scope 保留、旧路径/helper/恢复回调拒绝；结果为 `.work/application-group-root-input-review/management-helper-audit.log`。首次检查发现 `/policy` 旧路径未被本地防护拒绝，失败日志保留为 `management-helper-audit-failed.log`，修正后重跑通过。此检查模拟 OAuth 与 HTTP，不证明真实登录或授权。真实 UI 仍有旧恢复编辑器、暂存映射及旧路径，安全用例和历史迁移适配也未完成；legacy-migration 的旧恢复回调不再被默认 helper 接受，不能把未运行历史流程计为通过。
- UI 数据准备源码已移除恢复暂存 Map 和组级意图上界：scope 仅 `key/name/description`，实际策略单独通过应用 API 保存并核对；新建组前后检查全局策略修订及当前应用策略未变，避免目录创建暗中创建实际策略。成员、授予和声明调用已切换新路径/字段，不操作首方标志。筛选配置使用应用组 ID 和 scope key；26组、28scope、26应用、26用户及4组筛选计划的生成检查通过，未实际创建服务端数据。UI namespace 移至 `scope.acceptance.ui.*`，使业务拒绝写入纳入默认副作用观察域；此项修正不作为已经观察到真实无副作用的证据。日志为 `.work/application-group-root-input-review/ui-preparation-plan.log`。
- 根仓安全源码已替换 `reconciliation-complete-project-atomic`：新增元数据与实际策略独立检查，允许修改角色名称和说明，核对实际策略与修订不变、原有资源允许/拒绝不变，拒绝改 key、重复名称及仍有引用的 scope 删除。最后管理员用例改从实际策略读取管理 grant，不再从组元数据意图推断；旧用户授予字段改为 `scopeKeys`。新建空组不自动创建策略、未登记应用的组不能配置 Kestra 策略，清理要求真实空组删除，不保留旧“完整恢复/停用替代删除”流程。这些用例尚未运行，不能计为安全通过。
- 跨 scope 管理用例源码改为当前应用上下文：同一账号有当前应用策略 READ、A 业务范围 UPDATE、B 范围 READ 及另一组的管理 grant；核对 A 真实写入/保存、B 读取、实际列表及总数只覆盖精确 A/B，拒绝 B 业务写入、当前应用策略写入和未接入另一组的策略创建。使用已有范围外真实记录验证拒绝，拒绝前后检查完整安全/业务快照；临时策略、支持登记、声明、授予、scope 和普通组按独立 API 清理，不再为当前应用未加入的组建立旧式策略。此替换保留跨 scope 不得拼接动作和目标的拒绝门，不把旧模型的 B 组策略写入当作新能力。
- 跨租户拒绝用例不再读取旧 `projection.project` 或以无效空体发请求；先实际允许并恢复 scope 描述字段，再向错误租户发送有效策略体。账号资料及认证方式稳定字段已纳入安全快照，仅排除正常登录时间，凭据内容只在数据库内聚合哈希、不写入报告。旧角色/绑定/全局策略路径必须 403/404 且无副作用，不再接受 410 兼容处理器。
- 插件旧 schema1 建表 bean 新增 RBAC 开启、应用组关闭条件；Java 编译及原定向策略38、存储管理7、控制器18、新表H2一项仍通过，但未验证 Micronaut 条件元数据生成或实际建表行为。根仓新增 `new-install-storage-contract` 实际 SQL 表集合门并纳入最终报告，要求七个新模型表及零旧项目/schema1 策略表。合成表名集合的拒绝检查、15个安全计划 ID 与默认清单一致、14项历史排除未计通过的静态核对通过，证据为 `.work/application-group-root-input-review/storage-and-security-plan-audit.log`。第一次核对发现旧跨 scope 响应字段，失败日志保留为 `storage-and-security-plan-audit-unfinished.log`；源码重构后重跑通过。未观察真实数据库，未运行安全矩阵。
- 错误应用组用例源码已移除完整目录权限意图与旧 `/identity/projects` 依赖：先在当前组取得真实签名 token，保留工具可见、工具调用成功及数据库执行记录基线；再以同一 issuer、相同 audience、同名 scope，在另一组登记普通客户端和用户授予后取得另一合法 token。显式核对组 ID 与 client ID 不同、scope/protocol/audience 相同，另一组元数据不改变当前应用策略，并要求其 list/call 拒绝或空可见且无安全/业务副作用，当前组仍可见工具。临时声明、成员、授予、scope 和普通组通过独立 API 删除，不再停用保留旧“项目”。此真实 OAuth/MCP 用例尚未执行；默认检查 ID 已改为 `wrong-application-group`。
- 核心 helper 新增普通测试应用清理：先删声明，在移除最后一个已登记测试客户端前显式恢复本测试此前保存的 audience 设置，再删成员并重新登录。若其他测试应用仍在，则不重写 audience；不改 grants，也不得移除当前登录应用。该行为是验收数据清理，不是运行时从声明副本推导资源权限。两个内存场景均通过，使用非空资源 grants 检查保留，日志为 `.work/application-group-root-input-review/ordinary-client-cleanup-audit.log`；真实 API 和数据库未验证。
- 尚未创建的新安装测试角色 key、名称和说明已去除旧 local/project 用户术语，明确应用组管理员、Kestra 实际策略管理员及独立 MCP 撤权角色；没有执行已存在 scope 的改 key 或改名操作。当前输入与清单核对通过：19个scope、56个资源探针、15个安全计划、11个MCP计划、14个历史排除，均未记为运行通过。日志为 `.work/application-group-root-input-review/current-input-plan-audit.log`。真实浏览器、旧恢复编辑器用例、目标管理 UI、最终语言目录 hash、正式产物兼容和完整矩阵仍未收口。
- 公共浏览器用例源码已删除目录写入后的完整恢复分支和旧恢复页面专用诊断例外。写入前通过同 cookie 捕获实际策略，旧身份失效后真实重新登录，再核对策略内容与修订未变，并记录 `directory-mutation-no-policy-rewrite`；不得出现旧恢复 capability。实际策略目标为显式当前应用，读取校验组及 client；原组 scope 详情中的实际编辑改为当前应用详情选择 scope、先断言只读再显式编辑。定位来自候选源码属性，尚未核对真实 DOM，不能称作浏览器验证通过。
- 旧“未知本地绑定必须拒绝”UI 用例已替换为 `ui-scope-registration-no-runtime-grant`：真实表单新增元数据 scope，独立核对实际策略、应用支持和用户授予未变，再通过 UI 删除未使用 scope。成员及授予恢复体使用新字段且不含首方标志；诊断异常只对应具体新请求路径。目录保存成功以通知和重新登录入口为证据，不再要求已从产品删除的原始保存 JSON 面板。
- 13 语言目标文案改为应用、scope、scope 授予和通用保存；删除13个旧翻译源码 hash，不将过时 hash 写为新目录审核证据。运行绑定由父验收报告的正式 image/jar hash 和实际渲染断言提供，当前仅是目标文案清单。源码/输入核对保留13语言、4主题、52行计划，移除旧恢复路线和旧全局策略包装，日志为 `.work/application-group-root-input-review/ui-browser-contract-source-audit.log`，其中 `actualDomVerified=false`、`realBrowserExecuted=false`。目标管理专用 UI 文件及真实页面样式、筛选、键盘、窄屏、语言和完整矩阵仍待验证，未降低任何必需门。
- 公共浏览器用例再次核对并修正残留：scope 详情只要求组元数据，不再要求同页实际 grant 编辑器；详情 URI 对 scope key 使用普通编码，非 scope 的 opaque 标识仍使用其既有编码；初始语言页进入新应用组入口。并发 API 写入前标记需要恢复，失败清理先走生产登录，再为目录恢复单独捕获实际策略基线，避免空基线或旧身份造成误判。
- 浏览器诊断分类已提取为同一个公共函数，在主流程结束和清理结束分别执行；清理阶段的新 console/page/request 错误不再只收集不判定。清理登录失败、恢复失败、诊断失败均独立记失败，不能把原错误覆盖为成功。源码及输入核对通过，日志为 `.work/application-group-root-input-review/ui-cleanup-source-audit.log`；第一次临时核对脚本的 `index/indexOf` 笔误日志保留为 `ui-cleanup-source-audit-runner-error.log`，修正后重跑，未改变产品断言以获得通过。实际浏览器和清理行为尚未执行，不能以该静态结果宣称控制台无错误或无副作用。
- 目标 UI 模块改为 `runTargetGroupBrowser`，删除未参与两项现有检查的旧目标策略创建、恢复 helper 和停用保留清理。仍要求声明元数据 CRUD、实际 UI cookie 撤权两项：声明检查新增真正的额外权限 key/name UI 操作，并核对改名称、新增、删除、重建及失败清理不改实际策略；控制数据初始一个权限，清理恢复全部原权限。撤权用户在创建后立即跟踪，使用新 `scopeKeys`、明确准备的参考 scope/namespace，真实列表必须仅含该范围；拒绝只接受401/403，不把网络状态0当授权成功。
- 目标 UI 同 cookie 请求现记录 URL、页面代次和 documentId，失败也保留来源；native 保存仍按发起文档和精确 method/URL 等待响应。目标模块清理后额外分类新诊断事件，仅允许具体记录的预期拒绝、与对应响应同 requestId/文档的 console 错误、以及有文档切换证据的指定导航中止；其他错误令清理和目标验收失败，不再漏过后半程 console/page/request 错误。源码与数据清单核对通过，证据为 `.work/application-group-root-input-review/target-ui-source-audit.log`；实际DOM、候选CSS定位、真实OIDC、撤权时限和数据库无副作用未验证，不能将2项计划计为通过。
- 根仓真实执行 `blackbox-application-projects.mjs --static` 通过 source-inputs 和 shared-module-interface 两阶段，17个共享模块语法检查通过；报告保留 `mode=static`、`completed=false`、`notRun=154`、14项历史排除及 `containersCreated=false`。默认 blocker 文案不再把历史迁移或物理回滚列为交付条件，只有显式 legacy profile 才加入；真正完成时 blocker 必须为空，最终检查器验证该条件。实际调用最终检查器拒绝静态报告，错误为 `Acceptance did not complete`，不能将本次静态入口通过作为组合交付证据。报告、核对和拒绝日志分别为 `.work/application-group-root-input-review/static-driver-report.json`、`static-driver-audit.log`、`static-final-check-rejection.log`。
- 仍须完成全栈应用组命名（宿主 SPI/存储及插件少量内部标识）、内置组数据库及并发验收、正式 SPI 发布后插件的内置状态和删除 UI/API、真实删除后的跨组隔离验收、根仓安装计划新字段与旧恢复测试替换、管理 API/UI 其余适配，以及最终正式产物组合验收。下一步继续在所属仓移除旧模型行为；提交与发布须在实际权限允许后执行。

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

首次调查已完成差异与实施排序。当前已有部分正式机制和后续未发布候选，完整目标模型及其最终验收尚未通过；不得把阶段测试结果作为三个项目的最终交付。

## 2026-10-22 宿主 KsButton link 组合缺陷（插件已兜底）

`@kestra-io/design-system` 的 `KsButton` 在 `type="primary"` 与 `link` 组合下，
`--kel-button-text-color` 先被 primary 覆盖为白色，`is-link` 的透明背景规则随后生效，
亮色主题下渲染为白字白底不可读（实测 `--kel-button-text-color: #fff`、背景继承行背景）。
插件已在 `style.css` 以 `.rbac-page .kel-button.is-link { color: var(--ks-text-link) }`
兜底并通过明暗双主题验证；该组合缺陷属宿主组件，建议向上游或 overlay 报修，修复后
可移除兜底。
