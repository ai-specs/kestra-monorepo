# Kestra monorepo

## 访问控制需求 v3（正式产物与组合验收）

2026-10-31 当前正式宿主输入：`ff707dd` 的自动CI `41129076310` 五项
全部成功并已推广。正式镜像 digest 为
`15c7cace895531459fa1ef03446ec3945cd9ec1440c36a165c62b52e21472bac`，
正式可执行产物 SHA-256 为 `7142f7d86b29a611bd08a471616dc28d57f47c43b81081cef7cdb2462d218f22`。
7件artifact实际下载后主控重解析原949、几何60/8诊断源零错误、UI95、后端412、
4镜像专项及20认证JSON；正常拉取、双架构来源和SDK10等实际CI输入均已核。
后端两项镜像专用跳过由实际镜像报告另核，不将跳过计通过；BuildKit completeness
两项false的限制保留。此版本包含移动边界、桌面底部上翻/视口夹入及授权初始化/关闭
工厂的阻塞隔离，不复制原生筛选器。本次新增HTTP边界来源的5项具名回归：真实request
显式传播、并发隔离、事务裁剪与缺认证拒绝；历史T6早拒绝是否同源不作未经证明的归因。

正式插件`0d97555`由根submodule与`host-contract.properties`共同固定，独立CI
`41135257271`成功，artifact`13017281224`
已实际下载。jar SHA-256 为 `402a13886bedd87c55b30fe62d55509bb8224f15381e01904cf919eea39cbadf`。
主控重解析Java286、PostgreSQL108、生命周期24、UI195均零失败、零错误、零跳过，
schema2升级8及新装3具名门另核；薄jar、23bean索引、349UI资源和编译provenance已核。
新增subject空交集保留来源且不放宽结果、原生box页签取消后受控选中态的回归包含于
这次报告，另含原生抽屉及卡片分隔8项、删除焦点8项和原生关闭生命周期3项；旧172项不能替代。
最终镜像选择见`.env.example`，jar已从该成功CI实际下载核验后选择；不得以本地候选
编译结果替代。导航修复提交为`3ff3d09`，最后正式host消费提交为`0d97555`，最终报告须匹配后者。
导航修复在授权读取完成后释放读取锁再请求规范路径，并处理公开导航拒绝；当前失败显示错误，
旧页面或旧导航的迟到拒绝不覆盖新状态。独立远端克隆按本仓 README 编译的 jar 与正式下载件
hash 一致，原有175项UI保留并新增20项。上述正式组合已在根提交`9c97bc0`从空库完整验收。
保存按钮使用公开icon属性，卡片标题和显示名使用自有纵向wrapper；真实组合核对原生KV
抽屉、筛选锚定、计数分隔、保存与拒绝，独立组件和构建检查不能替代此组合门。
关闭保留本轮原生组件及SDK注册至公开closed后再卸载，避免迟到焦点释放覆盖恢复；
每次重开使用独立周期，旧关闭回调不影响新周期。原失败CI和后续修正证据保留在差异报告。
上一组27520a2/d099594的正式jar保留在被忽略的deployment/libs中。
根提交`9c97bc0`本地`new-install`真实Compose验收：REST56、检查192、UI137全部通过，
零失败、零跳过、零未运行，包含T1–T12、schema2升级8、真实双等待者互删/互停、撤权、
refresh、无副作用、缺插件和关闭功能。中英文完整覆盖四主题和三宽度；其他11语言核对
key、非空值和插值参数，不重复业务浏览器，不计为这些语言的视觉或交互通过。
上述结果只证明对应历史提交。最终提交必须再核对其
自身成功CI和实际下载报告；独立发布、本地组合与最终CI是不同的证据门，不能相互替代。
按当前根提交查询对应CI：`gh run list -R ai-specs/kestra-monorepo --commit "$(git rev-parse HEAD)"`。
选择该提交成功run后执行`gh run download -R ai-specs/kestra-monorepo <run-id> --dir <目录>`，
核对report中的提交、镜像digest、jar hash、矩阵数量与清理状态。历史失败及其诊断继续保留，
不得把宿主机制反例表述为此前所有锁前403均已确定同源。

三个仓库的 CI 按职责分层。独立仓已经通过的基础测试由根仓下载和核对证据，
不得在根仓重新编译或重跑；根仓自己的验收脚本和浏览器适配器回归仍须执行。

| 仓库 | 自身必须执行 | 根仓如何使用 |
| --- | --- | --- |
| overlay | 宿主公开机制、OIDC/MCP 协议、原生 UI SDK、镜像测试和镜像发布 | 核验成功提交、具名契约报告、promotion、镜像 digest 和 provenance，不重复执行宿主基础矩阵 |
| plugin | 插件 Java、PostgreSQL、生命周期、组件 UI、升级和独立 jar 编译发布 | 下载该提交的报告与 jar，核验完整性、具名门、jar SHA-256 与宿主输入，不重复运行插件单元或组件测试 |
| root | 正式镜像与 jar 的真实 Compose 组合、生产登录、REST/MCP 授权链路、撤权与 refresh、拒绝无副作用、缺插件和功能关闭、schema2 声明升级、真实 UI | 直接证明部署组合行为，不能用独立仓组件测试代替；同一上游基础测试不在这里再运行 |

真实 UI 保留中英文、四主题、三宽度的组合覆盖，以发布宿主的原生页面作为对照。
其余语言检查 key、非空值和插值参数，不重复全部业务操作。浏览器诊断必须保留完整事件，
读取使用不可变事件和独立历史数组，避免每次深复制累计历史；脱敏每次先去除重复凭据，
不减少错误检查、生产登录、持久化核验或拒绝副作用断言。运行时长优化须以完整组合实测为准，
局部性能测试不能承诺最终 CI 的运行时长。

2026-10-31 本地根提交`3717e52`的完整运行记录保留：REST56通过，UI135通过、2项诊断失败、
零未运行，34项恢复及运行时授权用例通过，owner资源清理为0；不能记为整体验收通过。
其组合阶段约63.5分钟，133个具名UI用例合计34.3分钟，仅代表本机实测。
随后两处诊断来源规则已用完整原始事件重放和187项离线回归验证：旧配置读取取消须匹配
精确栈与文档卸载；退出过程的旧拒绝页401须绑定真实logout307与最终登录文档。
这类规则不忽略未知错误。原失败报告保留，最终交付仍以对应最终提交成功CI和下载核验为准。

本轮完整目标以 `docs/access-control-ui-requirements.md` 为准，
`docs/application-group-target-model.md` 是同步摘要。当前差异、风险与发布顺序见
`implementation-gap-report.md` 顶部当前状态与2026-10-27初查章节。下方历史版本的构建与验收结果
不能证明新目标已经交付；旧双权限入口、独立可写支持集与插件 approved 不是新契约。

冻结输入可以运行 `python3 scripts/check-access-control-prototype.py` 检查。它只核对
已审查原型的 hash、裁决、字段提示及测试数据，不运行原型脚本，也不证明业务通过。
默认 `new-install` 的最终报告还必须包含 T1–T12 以及独立 `declaration-upgrade` 门；
schema2 升级不能归入历史 schema1 的 `legacy-migration` 排除项。未执行保持 not_run，
旧绿色报告不得满足本轮新增门。

历史检查点（2026-10-29，非当前部署锁）：宿主原生筛选 ShadowRoot 定位修复通过独立发布门，overlay `1e3632e`、
CI `40822882820`，正式镜像为
`sha256:9e2667744f9f0515a9902aa3d83bca3a3433aa9b752ec72fd8c07f3c539acdd0`。
该提交的 SDK 949、新增筛选定位36项、后端、镜像专项及两种首装报告已实际下载核对；
正常拉取原 digest 及正式可执行产物提取已完成。BuildKit provenance 的 completeness
限制保留在差异报告，不宣称完整依赖可复现性。

插件 `70cb552` 已消费该正式输入，CI `40908627243` 成功，正式 jar SHA-256 为
`b4866c5b6e184a0ef08804ea8976948edadeb5cb6e9d57375b9e224833ac0800`。
最终 artifact 已实际下载，Java 286、PostgreSQL 108、生命周期24、UI JUnit 144均零失败、
零错误、零跳过，schema2升级8项另核。UI JUnit 包含同路径query保实例、
并发及宿主回传顺序、失权清敏和侧栏跨页选中。当时选择该组输入；当前选择见本页顶部。
插件继续复用原生 KsFilter；修复条件添加、AND约束、移动关闭保存入口和错误恢复，
不提供未适配的全局 MessageBox 保存筛选服务。
根仓真实组合仍未通过：匿名 favicon 及测试观察者缺少首页 Trigger 读取的配置已修正，
须以新正式组合从空数据库重验，不能用宿主或插件独立成功代替。
独立发布成功不能替代新部署组合验收，不得将现有 jar 与镜像描述为已验收组合。

## 历史：应用组重构状态（2026-10-22）

本节仅记录 2026-10-22 的版本状态，不是当前部署锁。当前需求见本页顶部。
当时实施规范见 `docs/application-group-target-model.md`，差异与验收门见
`implementation-gap-report.md`。应用组、scope、应用支持、用户授予、应用权限声明、
管理 UI/API 与业务存储全部属于插件。overlay 只保留标准 OIDC 与只读协议输入机制。
当前是单一 issuer、共享协议端点及经过签名校验的应用组 claim，不提供多 issuer 模式。

宿主 `c2390ff` 的 CI `39712369397` 当时全部通过并发布，`.env.example` 当时固定其镜像 digest。
插件 `6f23eeb` 的 CI `39715045248` 通过，实际下载产物与独立克隆构建的 jar hash 一致。
插件 Java 218 项、PostgreSQL 76 项与前端逻辑 39 项通过，薄 jar 与公开契约门通过。
根仓本地空库 `new-install` 通过 REST 56、安全 15、MCP 11 和 UI 99 项，失败与未运行
均为零，资源已清理。开发报告为 nonFinal，最终根提交 CI 尚须取得。历史结果不能
替代当前提交的真实 REST、安全、MCP 和 UI 报告。

该历史版本要求实际 jar 含插件自有目录、服务、安装 CLI 与新模型类型，数据库包含七个插件
业务表且没有旧宿主组表或 schema1 策略表。安装计划与 scope 使用新字段，不保留旧 API、
首方成员类别、完整恢复、应用组级配置状态或权限声明驱动资源授权的旧路径。
当前 v3 的新装契约为四个统一应用组表与一个生命周期审计表，不沿用上述七表模型。

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
安装命令要求的 `RBAC_POLICY_JDBC_URL`、`RBAC_POLICY_JDBC_USER`、`RBAC_POLICY_JDBC_PASSWORD`
环境变量与调用示例见插件 README；Compose 服务环境不包含这三个变量，通过
`docker compose run` 执行安装命令时必须在命令行显式传入，缺失时命令只报
`IllegalArgumentException` 不提示缺失的变量名。
未完成目录初始化即设置 `KESTRA_RBAC_ENABLED=true` 时，授权请求以失败关闭拒绝，页面
无法登录；服务日志记录 `Application group directory is not initialized` 并指向安装命令。
按上述顺序完成 preview/apply 与策略初始化后，重启容器即可恢复。

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
选项中的 `browserCdp` 必须绑定同一已有任务空间的
`(method, params) => task.cdp(method, params)`。它只用于核对当前页面所属上下文并控制
该测试来源的剪贴板权限；不得改为操作其他页面或清理整个浏览器配置。
剪贴板与响应丢失用例必须执行真实浏览器操作，不读取或保存凭据响应正文。
适配器必须在 Page 初始化后取得当前真实 target ID，再限定同一 origin/context 修改
剪贴板权限；不能使用其他客户端焦点或重置整个浏览器配置。若本地浏览器传输明确不支持
`Browser.setPermission`，复制失败/重试用例保留为未执行，不能算通过；完整 CI-browser
矩阵仍须实际运行同一断言，本地工具限制不能减少最终门。敏感凭据可见时禁止截图，
报告记录明确抑制原因并保留原用例失败；不得将有意抑制误记为协议采集损坏、使后续
用例全部失去诊断。真实协议/采集错误仍失败关闭。
本地与 CI 共用 56 个 REST 探针、MCP 业务断言及 4 主题 × 中英文 UI 矩阵。
按维护者 2026-10-30 裁决，中文 `zh_CN`、英文 `en` 完整执行真实业务 UI、三种宽度及
主题切换；全部 13 种语言检查最终插件提交的翻译 key、非空值和插值参数。其余 11 种语言
的重复业务浏览器操作列为范围外，不计通过，不声称已验证译文质量、排版或交互。
已发布宿主 SDK 的独立 949 项报告仍完整核对，授权、安全与副作用门不减少。
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
S256 换码激活完整分页目录中的每一个长期测试 client，并逐个读回owner-only详情。
不能仅激活需要直接编辑的前两个：目录更新会核对整个应用组，其他pending过期也会使
长时验收恢复失败。准备门和最终报告门核对完整登记集合与激活集合完全一致，不延长期限
或关闭清理器；该设置不改变生产 Compose 的注册默认值。
完整主题/语言/三宽度矩阵运行数小时。隔离验收将队列证据保留期设为24小时，保留
清理器原调度，避免一小时历史事件过期改变拒绝操作的前后hash；实际容器环境必须核对。
该设置不改变生产Compose、不丢弃队列记录、不放宽入队或持久状态相等断言。
根CI的360分钟上限用于容纳完整矩阵，超时或未执行项仍不得计为通过。
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
