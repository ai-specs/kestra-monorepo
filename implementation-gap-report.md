# 应用组目标模型实施差异报告

## 当前适用门状态（2026-10-31）

正式组合为overlay `ff707dd` / CI`41129076310` / image`15c7cace…472bac`，plugin
`0d97555` / CI`41135257271` / artifact`13017281224` / jar`402a1388…39cbadf`；
完整hash、来源与下载审计见下文正式输入及README。两个独立仓最终成功CI报告和正式产物
均已实际下载。根代码提交`9c97bc0`完整空库`new-install`本地验收通过：REST56、检查192、
UI137，失败/跳过/未运行均0；最终检查器重新执行通过，owner容器/网络/卷均0。
证据位于`.work/access-control-v3-20261027/resumed/root-final-origin-composition-local/`，
含`main-final-local-audit.json`、完整`report.json`和主控复算日志；此前失败报告不覆盖、不追认。

| 当前需求映射 | 所属与正式输入 | 已验证门与状态 |
| --- | --- | --- |
| N1–N6 / T1 | plugin目录/API/UI；正式宿主SDK | 卡片、只读详情、显式编辑、统计链接、内置拒删、退役key及真实保存；本地组合通过 |
| N7–N9 / T2 | plugin scope key/name/description | key不可变、重名、应用/用户/typed引用删除保护及拒绝无副作用；本地组合通过 |
| N10–N14 / T3 | plugin统一permissions，公开ProjectionV2 | 主动登记、支持并集、机器key/人类名称、Kestra typed/external边界；REST/UI/MCP本地组合通过 |
| N15–N18 / T4 | plugin用户scope授予与交集 | subject筛选、scope交集、授权投影、旧会话撤权和refresh；本地组合通过 |
| N4/N5/N19 / T5/T6 | overlay目录V2/借用事务；plugin参与者 | 首改密、账号删除/停用、全组清理、历史保留、双等待者互删/互停及回滚；本地组合通过 |
| N11/N19 / T7/T8 | overlay凭据V1/维护CLI；plugin管理API/UI | 掩码提示、一次性明文、CSRF、复制重试、响应丢失、维护取消/激活/回退；本地组合通过 |
| N19 / T9–T11 | plugin管理域；正式宿主原生组件 | READ/MANAGE分离、零授权换号、原生筛选/抽屉、计数间隔、中英文四主题三宽度；本地组合通过 |
| N20 / T12 | plugin schema2 PostgreSQL升级；root发布组合 | declaration-upgrade8必需门及全部正式来源检查通过；schema1历史迁移14项明确范围外，不计通过 |

其余11语言的重复业务浏览器操作按维护者裁决范围外；13语言各110 key、非空值与插值参数
均检查通过，不声称这些语言实际排版/交互通过。历史T6锁前拒绝与请求来源反例同源未证明；
本次新正式组合的T6已实际4/4且清理通过，不删除此前失败或降低双等待者标准。
本次后续变更仅同步验收文档，不修改9c97bc0的运行输入和断言。根最终提交仍须通过其自身
完整CI并实际下载核对；该最终门的状态以匹配HEAD的Actions及下载报告为准，不以本节代替。
以下各日期段落和“初查状态”表保留为历史调查与失败输入，由本节当前已执行状态覆盖。

2026-10-31 正式发布顺序已重新执行：overlay ff707dd/CI41129076310五job成功且推广，
7件artifact实际下载、412后端（2镜像前置由实际4份镜像XML另核）、UI95、20认证JSON、
SDK949、几何60全核，新增5具名来源门全过。正式digest15c7cace895531459fa1ef03446ec3945cd9ec1440c36a165c62b52e21472bac，
arm64正常pull/created未启动提取exe7142f7d86b29a611bd08a471616dc28d57f47c43b81081cef7cdb2462d218f22，
双架构after/run/BASE和三推广tag逐核；BuildKit completeness两项false限制保留。
plugin 0d97555只消费该registry正式输入，独立CI41135257271成功，artifact13017281224
实际下载并亲核Java286/PG108/生命周期24/UI195、schema2升级8/新装3、23bean/349资源。
正式jar402a13886bedd87c55b30fe62d55509bb8224f15381e01904cf919eea39cbadf与最终远端
独立克隆README构建件一致。根选择新正式组合、精确下载新增5具名来源门，不用旧结果替代。
证据入口resumed/request-origin-ci-main与plugin-origin-host-ci-main；完整根新装与最终根CI
尚待新干净提交执行，未宣称交付。历史失败同源仍未证明，新组合真实T6必须重新验证。

2026-10-31 当前首要阻塞为T6锁前拒绝：0563560完整本地两次分别在互停、互删观察到
请求index0约103ms提前403、双等待者未成立，均按失败保存和清理；第二次是有界本地复测，
未重复触CI。另一次有界hash诊断同类失败，证据见resumed/t6-early-refusal-credential-diagnostic。
JWT在有效期内且CSRF头与cookie哈希相等，不能据此宣称服务端全部鉴权分支正确。
保留部署上三次直接T6为4/4，包括一次JFR诊断；这些成功不抵消全量失败。异常栈仅保留
类名/方法/行号，不保留消息或凭据；诊断容器、PG、卷和网络均已精确清理。

独立宿主反例已红/绿复现：TypedRestRbacFilter收到真实request及Authentication，但无
ambient来源时，异步可信身份入口找不到请求，安全锁入口0并返回403；最小显式绑定该
HTTP request到Reactor来源后200。主控按overlay入口B接收最小来源传播修复及具名回归，
不得将真实HTTP调用改internal或放宽主体校验。该反例与历史T6失败同源尚未证明，必须以
修复后的正式独立发布和真实组合重验裁决。overlay候选在独占request-origin-boundary树，
尚未提交、CI或发布；当前正式851/3ff组合不升级为根验收通过。

2026-10-31 1525843精确本地门：全部137项真实UI业务、主体错误来源审计、零授权退出换号、
REST56、安全26、MCP11、聚合2、T6并发4均通过；测试数据和Compose资源均清理通过。
组合汇总仍失败：最后runtime target模块调用强制改密助手时未接收新onDenial回调，
其预期401及同requestId的console两条进入未知错误，target.completed=false。
主控已定位精确request8840.82230，现将助手返回的requestId、源文档、状态和预期写入
target自身清单，匹配时核对已记录requestId；不删除诊断断言。原失败报告保留在
resumed/root-final-response-drain-local，全部137项通过不代替最终组合和最终根CI。

2026-10-31 请求标记轮437db53：REST56、安全26、MCP11、聚合2、T6并发4及UI133通过，
最终诊断仍18条未分类而失败，后续3项UI未运行；业务清理和Compose清理均通过。
新导航page-error未再出现。主控逐项核实：8条为测试读取预期401后主动cancel响应正文，
现改为完整读取；宿主认证fetch的异常源栈在消息正文，现解析其文件/函数/行号，与请求
initiator精确关联；规范路径重定向时manifest取消须同文档实际路由变化且同URL替代
请求200，才分类；一次性响应丢失console须关联已记录的精确故障请求。旧失败保持失败，
只读重放仍留下8条主动cancel，不伪造全绿。下一轮必须实际运行正文完整读取后的全量门。

2026-10-31 f323c91精确本地门再次通过REST56、安全26、MCP11、聚合2与T6真实并发4，
但首次UI登录的测试主动capabilities GET与宿主并发GET同URL，旧测试助手无法唯一选择
响应，按规则失败关闭。未计UI通过，原报告保存在resumed/root-final-navigation-local，
自有资源已清理。现为测试主动fetch增加非凭据随机X-Acceptance-Request-Id观察头，
采集器只保留符合固定格式的标记，精确关联Network请求ID；不改变生产鉴权与业务API。
UI原生点击不加此头，仍按实际点击响应ID核对。共享离线133项通过，新干净提交须重跑。

2026-10-30 最新导航与诊断修正：根 d1de15a 精确本地 new-install 的 REST56、安全26、
MCP11、聚合2、T6真实并发4及 UI133 通过，但最终浏览器诊断1失败、后续3项未运行，
不得计完整通过。真实 page-error 为未处理的 Extension navigation rejected；自动规范路径
在读取锁仍持有时请求宿主导航，触发自身守卫。插件3ff3d09已修复并发布，CI41079323294
成功，artifact12988732576实际下载，Java286/PG108/生命周期24/UI195全部0失败/错误/跳过；
原175项顺序保留，新增20项，schema2升级8和新装3另核。独立远端克隆README构建通过，
jar SHA402a13886bedd87c55b30fe62d55509bb8224f15381e01904cf919eea39cbadf与正式下载件一致。
根只选择该正式jar；旧2d正式jar保留。宿主851/image0238无须修改或重新发布。

根清理原执行记录首次DELETE204、第二次因不存在对象失败关闭403，现记录已成功清理状态，
不放宽拒绝断言。根诊断新增精确请求ID、来源文档、导航顺序、请求发起栈和生产身份窗口；
预期拒绝与卸载逐项保存关联证据，不豁免page-error/integrity/未知当前故障。旧失败报告与
只读重放位于`.work/access-control-v3-20261027/resumed/root-final-en-zh-reviewed-local/`，
其自有Compose/PG/卷/网络已清理。独立复核的诊断缺口及修正证据保留于resumed，
最终新提交必须重新从空库执行完整137UI及全部适用门，再推送自动根CI并实际下载审计。
根诊断门进一步要求重新登录同一身份后精确capabilities200，才分类已确认授权变更边界的
旧会话403；scope名称等纯元数据写入不满足该分类。最终报告检查器独立重算分类结果，
不信任仅填零的错误汇总。公开错误响应仅按精确requestId归属；宿主fetch console还须
与请求发起栈共有同一文件、函数、行号，所有关联来源保留。未完成门保持失败或未运行。

2026-10-30 维护者更新语言验收范围：业务浏览器完整执行英文、中文，保留四主题、三宽度及
全部业务断言；其余 11 语言以最终插件提交的翻译 key、非空值、插值参数检查验收，重复浏览器
操作明确范围外，不计通过。已发布宿主 SDK949 审计保持全量。原 d75a847 全语言任务按此裁决
终止，172 项通过、1 项运行中、96 项未运行，原报告保存在
`.work/access-control-v3-20261027/resumed/root-final-exact-local-round2/`，不计最终验收。
根共享矩阵、最终报告门和 CI 同步此次范围；新完整本地验收和最终根 CI 尚待执行。
静态实际核对 13 种语言各 110 key，缺失、额外、空值与插值参数不一致均为零；共享离线
94/94 通过。新增缺语言、缺键、全语言共同缺键、空值和参数差异的拒绝反例。最终报告门
重新读取精确插件提交复算证据，不信任仅填零的汇总。离线复测还发现 T6 诊断的提前完成
标记漏记 validate-two-waiters 阶段，现已修正，真实并发要求及拒绝断言不变。
独立只读复核确认 SDK949 与业务断言未误减，并指出条件表达式 key 和未配对花括号两项
静态检查漏检。主控已亲核修正：显式维护当前动态调用 key 清单、拒绝残留花括号，补充相应
反例；共享离线复测 98/98，13 语言各 110 key 重新检查通过。T6 反例明确锁定实际失败阶段。
最终报告检查器从当前检出根仓的插件提交重算翻译证据，允许独立审计下载的 CI 报告，
不依赖 CI runner 的绝对路径。首轮中英文环境漏传 NODE_PATH 的失败保留；第二轮在发布门
因上述复核缺口主动终止，未将其计通过。将从下次干净提交重新执行完整 new-install。

## 当前交付阻塞（2026-10-29）

### 维护者补充：原生筛选弹层对照矩阵（2026-10-29）

2026-10-30 19:07精确提交本地首轮保留失败：23c65c6最后正式851/2d输入在T6互停用
请求提前完成、未观察到双waiter；实际响应403/200，失败时仅一个holder样本，原报告
不含充分毫秒时序，不能裁定原因。两回滚/互删通过，账号与管理员恢复且owner清理成功。
没有直接重跑CI或降低双waiter/1.5秒门。根仅增加观察证据：请求开始/结束毫秒、失败
当刻settled及耗时，响应只保存白名单机器code/type；不存原文/凭据，不改业务断言。
新离线早完成诊断回归通过，根85/85。其后一个新空库有界T6及同独占环境2次顺序
完整T6均4/4实际通过（共3次），各cleanup空并最终按owner清理，不将后续绿色反推
原失败通过或声称原因消失。证据`resumed/root-final-exact-local/`及
`t6-final-source-timing-diagnostic`、`t6-final-source-repeat1/2`。
下一精确根提交包含诊断增强，再完整本地new-install；最后仍须推送并取得最终根CI
成功及实际下载报告，外部阻塞门未解除前不得宣称最终交付。

2026-10-30 18:42最终来源收敛：宿主最后文档/manifest提交`851e9ea`的CI41027744615
五job成功，7原ZIP下载SHA/提交均核，99XML407/UI95/MCP4/20认证JSON/SDK949精确
顺序/geometry60及8诊断均核。正式digest`0238b214fdd284dab3017c8cd2049e5f599f2f2e71afe3dbf1d94c0d26ba4784`，
正常arm64pull及created未启动提取exeSHA`6c4bd609bd6a5e19b521b543cf3811da6e20ea20f454524c66f75d512522f7f7`，
66076个运行class等489已验证版，SDK10等实际CI tar；双架构after/run/BASE匹配，
BuildKit completenessfalse限制保留。插件仅pin/README更新为正式宿主，独立prepare-host
及clean check Java286/UI175通过，jar与2b正式件同SHA。精确2文件提交`2d01437`，
CI41041932608已success，最终artifact下载审计进行中，不将候选装载。

前一完整本地组合已达到UI168通过，失败2项：法语390 user无副作用只queue源hash
变化；实际宿主09:30:51 JdbcQueueCleaner清理flow_interface71/follow_execution23等
日志与失败窗口吻合，源码公开默认retention1h。原队列/数据库/存储hash与日志保留，
不改为通过。另一Hindi390原生KV创建等待超时，截图停在KV页；Ego语言菜单操作因
工具选项定位失败未复现到目标，明确未验证。根新KV步骤等待实际可见/可用/样式稳定
按钮再点击并记录阶段，不自动重试、不用脚本点击绕过。Ego提示更新后本任务已finish，
未升级浏览器。为避免长时证据被自身过期，隔离验收新增24h队列保留，清理器仍原调度，
实际容器环境必须核验；不丢queue记录、不放宽hash/副作用断言，不改生产Compose。
原运行精确owner runner经TERM未退出后KILL结束，保存168pass/2fail/98not_run/1running
及原报告；容器/网络/卷按owner清理，未计最终通过。

根将以精确干净提交执行下一次完整本地new-install资格门，本地通过后才推送自动最终
根CI；报告必须对应最终提交，360分钟job预算仅容纳全矩阵，不减少269UI或安全门。
根最终CI成功及下载证据尚未取得，不宣称交付。前述16:12等记录均为当时阶段状态。

2026-10-30 16:12正式修正插件门通过：`2b56348`/CI`41023207575` success，实际下载
artifact`12962612480`，ZIP SHA`458e85dac54bb93c090689134e22edbc46d5d8cb2d3a46122b2b878ce4ea4222`。
主控重解析unit286/PG108/lifecycle24全0fail/error/skip，UI175精确等本地顺序、原172
全部保留，upgrade8/newinstall3、薄jar23bean349资源逐hash、新host provenance均核。
正式jar SHA`2d24dc1e092712676bdbf62766bac4f6cb176c04ffc0db7ec985348329c8acfe`已从下载件
选择至deployment/libs，前正式bd71 jar保留。审计`resumed/plugin-native-focus-repaired-ci-main/`。
原完整269UI、REST56、安全26、MCP11、schema2等矩阵从新空库运行于
`resumed/root-native-focus-ci-browser/`，并未选择跳过失败项。当前T6实际4/4、互删
204/403、互停403/200及两轮双waiter、原会话撤权、cleanup空已独立审计；REST56/56
通过，安全/MCP/UI继续执行。仅一个主Compose/PG，辅助宿主只按用例共享隔离数据库。
本地显式nonFinal只用于运行前未提交根源码的完整资格验证，T12最终来源门不计通过；
根最终提交成功CI及实际下载门仍未取得，不能宣称全部交付。

2026-10-30 15:57插件CI失败已归因并修复测试：`85b277f`/run`41021754049`实际失败
artifact`12961448854`已下载并核ZIP与head；Java286/存储PG108/UI175通过，lifecycle24
仅`AuthorizationDependencyPostgresTest.signedContextAuthorizeExplicitFailuresAre503SecurityAndUnknownRemain403`
失败，XML为Mockito UnfinishedStubbingException，指向同context在异步close期间重设authorize。
不把此CI计通过，不部署其jar，不盲重跑。测试改为每个分类独立context/runtime并显式verify
恰好一次close；所有403/503、effects0、前后持久状态相等断言保留，未改产品/宿主/UI。
唯一自有PG实际完整lifecycle24/24及原失败方法3次具名定向全0fail/error/skip已复测，
owner容器/卷清零。精确一个测试文件working/index SHA相同、cachedcheck0后提交推送
`2b5634838efe38b6590114c7b9467bc61724fbd4`，远端main回读一致/工作树干净。
自动新CI`41023207575`运行中；等待本提交成功及实际下载，不复用失败85产物作正式输入。
证据`resumed/plugin-native-focus-ci-main/failed-*`及plugin `.work/async-context-test-fix/`。

2026-10-30 15:43修复与发布进度：根Ego原操作修正后，四类maximize逐项对照实际KV
99%几何、dark/zh_CN三宽度等定向9/9通过；上一light/en及四脏稿确认流程通过。
原定向首轮因错误调用pressFocused(Enter)失败已保留，改回已有元素原生press后重测。
根derive要求实际nativeMaximized参照/还原，新增反例后离线84/84通过，不将选例诊断
或离线计为完整UI通过。
插件最小修复确认为延后公开closed才卸载（SDK注册必须保留到原生focus-after-released），
每次打开独立周期闭包与key；不调用私有setup，不加焦点修复timer，不改SDK。
主控已审两源码、旧18真实浏览器13pass/5fail→新20/20、production349资源逐hash、
3项可提交实际组件生命周期旧0/3→新3/3，175UI保全部旧172。canonical clean check
及Java286通过，Java class逐字节等前正式bd71，host/Java/SQL未变，本地不重复PG；
最终插件CI仍执行完整PG/lifecycle门，不以UI回归替代。
精确4文件（2源码/测试+README/接口文档）working/index等SHA、cachedcheck0、
parent/remote一致后已提交推送`85b277f9232b1df546158abad8fee886dd9ffbff`，
自动CI`41021754049`运行中。主控证据plugin `.work/native-focus-release/`；子agent
独立检出 `.work/native-focus-after-unmount/.work/native-focus/`全部保留，本次pane已清理。
原失败根owner容器/网络/卷已按label清零，Ego18调查任务finish，未改原报告；
等待85正式artifact实际下载审计后，从新空库执行原完整new-install矩阵，范围不减少。

2026-10-30 15:26真实新组合结果与Ego归因：正式48946/bd71的T6实际4/4通过，互删
204/403、互停403/200，两轮双waiter、原会话撤权及cleanup均通过；REST56、安全26、
MCP11、聚合和新装/登录维护/冻结真实UI通过。完整UI出现焦点、最大化及主题关闭失败。
已按用户补充使用Ego生产登录调查，不改权限/不保存数据，也不启动另一套部署。
实际命中证明390宽scope多选wrapper中心落在已选tag的删除SVG：打开/Tab后scope存在，
wrapper点击后变空，随后关闭要求丢弃是正确产品行为。改点combobox真实输入，搜索
前后scope不变且clean close通过。Ego原共享theme诊断3轮保留，全部是选例诊断，
不计完整矩阵通过。最大化公开原生CSS为99%，旧根要求100%错误，截图证明已最大化。
根改为实际打开KV原生抽屉最大化取得几何参照，并保键盘Enter真实操作；主题搜索改真实
input并新增选集不变断言；header pointer保hit-test，新增等待确认层实际退出而非立即点击。

继续余主题只会重复错误测试操作，主控核对精确本次runner PID40373/命令后结束该有误
非最终运行（SIGTERM未退出后SIGKILL，仅本次owner进程）。保留当时UI102passed/
39failed/127not_run/1running、原始报告、截图、请求、源hash及operator说明；不计完整
UI通过，不清空失败，不将后续诊断回填原报告。下一轮必须原完整矩阵从头执行。
Ego另外精确复现subject抽屉expand Enter→close Enter后焦点落BODY；Escape可回原trigger，
事件trace显示trigger曾恢复后又被覆盖。现由本次Herdr子agent`plugin-native-focus`/
`wW:p1X`在插件独立检出目录研究公开close-auto-focus释放，无canonical修改权限、
无PG/服务权限、不得提交发布。主控继续根修复与Ego定向复测；产品焦点尚未裁定修复通过。
证据入口`resumed/native-drawer-ego-failure-investigation/`与`native-drawer-ego-shared-diagnostic*`。
根新增等待反例离线80项执行中；独立检出修复不得冒称正式发布或根组合通过。

2026-10-30 14:18新正式插件下载审计通过：`bd71c02`/CI`41012282222` success，artifact
`12957594983`原ZIP SHA`71b1a6dc62edfedf2858e12982eb1260df5f63de41573f307a9d25940c24222e`。
主控实解析Java286/PG108/lifecycle24/UI172（精确顺序等本地）全0fail/error/skip，
upgrade8/newinstall3、23bean349资源逐hash、薄jar及新正式host provenance均核。
正式jar SHA`fa5c6f38837a159f9ec0c9a789a0b3315ab7e869189a28f68ba61031561db68a`，
已从下载件选择到deployment/libs，旧73fa正式jar保留；根正式组合输入为
`resumed/formal-release-evidence-native-layout.json`。完整new-install本地CI浏览器矩阵
`resumed/root-native-layout-ci-browser/`已从空库启动，全部源hash冻结；不包含选例改写。
主控下载审计`resumed/plugin-native-layout-ci-main/main-audit.json`。
尚未有本轮根组合完成结论，根改动未推送、未触最终CI。

2026-10-30 14:09插件独立门通过后已提交推送`bd71c02beaeb2481e0a86f9ca0464bd6fd3466c4`，
精确8文件working/index/commit SHA等冻结表、cachedcheck0、parent/remote73fa一致，
推送回读远端一致且工作树干净。正式新host registry独立提取后，主树与独立clone
README clean check通过且jar同SHA`fa5c6f38837a159f9ec0c9a789a0b3315ab7e869189a28f68ba61031561db68a`；
Java286/PG108/lifecycle24/UI172全0fail/error/skip，upgrade8/newinstall3、23bean349资源
逐hash/薄jar已亲核，owner容器/卷清零。证据plugin `.work/native-save-icon-spacing/final/`。
自动CI`41012282222`运行中，未dispatch。根部署jar仍是旧正式8fdc，不消费候选fa5c。
宿主agent完成实际双架构pull/未启动提取，正式exe两架构逐字节相同，主控已亲核，
其本次pane`wW:p1V`已清理。下一步下载新插件成功CI产物后，使用正式组合全量复验。

2026-10-30 14:04正式宿主发布门通过：`48946d6`/CI`41007119467`五job均success，
7原始ZIP实际下载摘要/最终head一致；主控重解析99XML407(405过、2专项由实际MCP4
另核)、UI95、双模式20JSON、SDK949精确顺序及geometry60/8诊断零错误。推广实际
日志/rawindex/三tag一致，正式digest`d0d770076f026dd6c94d1c46ee7b6bbaa0dc5d3858645245cd0d74766549bfbe`。
双架构provenance事件after/run/BASE均匹配，completeness request/resolvedDependencies
false保留。arm64正常pull、RepoDigests、created未启动提取、owner与卷清理已亲核，
正式exe SHA`2e91a34a3bd0751eff756bdd9ea38b85831d342600ba1c1ea62a102d7445721a`，
10SDK等实际下载CI tar。主控审计`resumed/host-authorization-io-ci-main/main-audit.json`。
插件现在只从registry此正式digest独立提取，已更新host pin；8文件（7UI/文档+pin）
冻结并同步独立clone，主树及独立README构建执行中；唯一PG交插件，尚未发布新jar。
`.env.example`同步正式host，但deployment/libs仍保旧正式73fa jar，不将未发布新jar部署。

2026-10-30 13:28独立只读复核收敛：`root-native-assert-review`/本次pane`wW:p1W`
按指定命令启动，初始与后续通信标记、实际进程和焦点已核；只写自有work报告，未启动
浏览器/容器。确认1项报告门遗漏：localized行缺新增卡片布局仍可通过，主控已亲跑
同一合成反例（保留前后输出与修复说明），现在失败关闭。根derive要求3种宽度实际
计数/标题测量，保留混合overflow记录结构和所有提交/产物/source绑定；新增8项离线
回归，全部根79/79通过。20px间距无明确上限的候选缺陷撤回，不凭空提高要求。
报告`resumed/root-native-assert-review/review.md`已亲读，完成后只清理本次pane，
主控pane仍聚焦。它没有确认实际浏览器最终通过，不能替代下一正式组合矩阵。

2026-10-30 13:15发布状态：宿主精确8文件已提交推送`48946d63e4a806ac52b79d44e815240601a66a2b`，
主控回读远端main一致，工作树干净，原实现patch与精确测试门等本地主控审计hash。
自动CI`41007119467`的patch-verify已成功，build-push运行中；没有重复dispatch。
正式镜像未发布，插件host pin仍1b2b旧正式值，7文件UI增量及独立检出目录保留，
只准备公开产物提取与完整本地门脚本，未从候选镜像取得编译输入。

2026-10-30 13:10宿主本地门审查通过：SDK949最终全部通过/0fail/0notRun，ID顺序逐项
等e0e正式父报告；同源几何60精确主题/宽度/行为组合全部通过，8诊断源零error，
同build`b4271b56c3cb6b2c3b95c7f88d12499730376bcdedff9e3d2188cff97b3fc0cb`。
主控此前读到几何执行中第37行passed:false为检查入场预置值，误判失败；亲读实现及最终
报告后已纠正并通知agent无需重跑，没有因此修改断言/输入或制造修复。
主控独立审计已补最终949/60/诊断/source/owner全门，明确授权所属精确8文件提交推送，
要求working/index/commit逐hash和cachedcheck0、parent/remote一致，只跟踪自动CI。
此刻尚未正式发布，不允许插件消费本地候选；插件7文件待正式host pin和完整独立门。

2026-10-30 13:03主控独立重解析宿主候选门：归档99XML407/0fail/0error/2镜像专项skip，
实际MCP4份各1项0skip另核；20份双模式JSON全部completed，目录22/扩展7/主题26/
语言52/密码215/失效身份24/资料26/明确依赖503故障7均实核。UI实际报告为95/95，
此前agent及主控转述87是检查器最低数量，与实际报告不符，现纠正并要求文档同步。
335触达文件最终重放SHA一致、公开ABI无差异、3个实际class等executable及镜像内
exe SHA`c18a0ab95c40dea505881211ef9ff66115c10f96ed5610499eac509068866476`已核。
独立审计入口`resumed/host-authorization-io-main-review/audit-local.py`。
SDK949仍运行零失败，几何门尚待完成；未批准提交推送，未发布此候选。
根共享审计新增原生Save icon wrapper/SVG/实际间距与卡片标题纵向实测门，禁止旧
计数/抽屉报告替代。根离线70/70、原型完整脚本与共享入口静态门通过；静态396项
not_run不是生产通过。插件7文件补充修复和文档已显式冻结本地SHA，等正式宿主输入。

2026-10-30 12:44阶段核对：旧正式组合独立呈现调查实际比较31/48个唯一主题/宽度/抽屉
组合，其中4个1280主题组合完整；其余在窄屏主题或权限抽屉关闭的Ego原生CSS pointer
操作失败，保留17个未完成观察，不计为48通过。header/body/footer、SVG与贴底等已比较
行均匹配原生KV；不能据此推断全部交互通过。失败报告及主控精确数量在
`production-native-drawer-final/separate-viewport/audit.json`。
发现部分失败发生在已记录权限抽屉呈现之后的关闭，不是permission-add缺失；原始
阶段active字段不能单独用于归因。根共享关闭操作现改为每次从真实DOM、可见性、
enabled/inert、视口与两层hit-test确定原生按钮中心，再由两个浏览器适配器的原生
pointer点击；不触发DOM.click、不改样式或跳过按钮。离线反例新增11项，根共63/63通过；
新关闭路径仍待正式新组合真实复验，未以离线结果计UI通过。
主控已按owner清理第二套（顺序运行的）根Compose及PG，当前唯一PG容量已明确交宿主
agent做完整本地/镜像门。Ego16已about:blank，不与其安全测试并发业务请求。
关闭工厂的两项新独立红测也确认eventloop阻塞，主控亲核2fail/0error/0skip后明确接收
最小closeOnce调度隔离：同步唯一权、空上下文、有界池、保原released与异常/超时。
宿主还未完成发布，不触发根CI。

2026-10-30 12:30新增归因与实施：第二次完整根运行复现单waiter，实际线程栈确认
`default-eventLoopGroup-1-2`同步阻塞于`OidcSecurityTransactions.lock`，调用链为
`OidcProtocolState.lockSecurityState → OidcTrustedIdentity.currentForAuthorization →
AuthorizationEvaluations.boundary`。这属于宿主既有0330边界调度缺陷，已按入口C在
overlay所属能力文档、差异表和机制文档接收最小修复，不用扩大线程数/超时规避。
本次Herdr新子agent`authorization-io-host`/`wW:p1V`按指定no-daemon命令实际启动，
probe和同agent后续标记、真实进程及未抢焦点已核。独占overlay实现/本地门，主控独占
插件4文件补充UI修复和根验收；禁止子agent在未获主控释放前启动容器。
宿主旧实现新增2项实际红测为2失败/0错误/0跳过；新实现定向32项通过，尚未完整本地
检查、提交、CI或发布。仅传播必要授权来源，保持安全锁、403/503及取消恰好一次释放。

主控真实Ego已对照正式`e0e952b/73fa96e`：1280宽组抽屉header/body/footer计算样式、
原生SVG、展开/关闭按钮尺寸与KV原生一致，footer贴底；3个卡片计数Range均实测4px。
另真实发现Save图标与文字gap0（直接slot图标不是原生icon属性），卡片key/name/badge
被按钮slot内部inline-flex挤为一行。插件使用公开icon属性及自有纵向wrapper修复，
旧实现新增断言实际失败，新实现完整UI仍172/172通过且UI构建成功。尚未发布或生产复验，
待新正式宿主后与host pin一起独立重编译发布，不消费候选jar。
额外呈现矩阵保留全部失败：首轮不合法opaque identifier缺~为主控路径错误；后续
原生PWA安装提示遮挡按钮；Ego部分click报错后实际目标drawer已打开。按实际DOM核对、
保留action receipt错误及真实后置条件，不重复点击已打开控件，不跳过原业务断言。
这些是独立呈现调查，不是根完整UI/角色/写入验收通过。

2026-10-30 12:08根运行失败与诊断：`root-native-drawer-ci-browser`在T6进入UI前失败，
前两项真实事务回滚通过，但互删在原1.5秒内只观察到一个JDBC waiter与本次holder；
没有达到两个同时等待的原门，故保持失败。测试已恢复管理员授权且cleanup.remaining为空。
原报告、全部样本和持久状态hash保留；本次未执行的269项UI不得计通过。
随后同一独占环境两次定向原T6完整操作均4/4通过，第二次先实际运行原冻结CI浏览器，
两次均实际双waiter/原会话撤权/持久及清理通过。没有修改共享源码/断言/超时，
也未触发备用SIGQUIT诊断，故目前原因仍未核实，不能把独立诊断替换原失败报告。
已按owner核对并清理原Compose，启动新的完整`root-native-drawer-ci-browser-round2`，
若同一个waiter形态复现则采集真实JVM线程栈；不调整断言或放宽1.5秒门。不并启第二PG。

2026-10-30 11:54正式插件审计：`73fa96e6`自动CI`40999171025`成功，主控实际下载
artifact`12952369487`并核ZIP SHA-256`08fd992515666a2be4c20bd22ba91e9767164db07e5de3df020d93b3b2a5e410`。
Java286/PG108/lifecycle24及UI172均零失败/错误/跳过；UI逐名顺序与本地报告一致，
schema2升级8/新装3、薄jar23bean/349资源逐hash和正式宿主provenance已核。
正式jar SHA为`8fdcf25649e300c11dcfd83e0ceca71c5667f3dff6ac300b0722d5166fc67fea`，
已从下载件选择到deployment/libs，旧f456正式jar保留。主控证据为
`resumed/plugin-native-drawer-ci-main/main-audit.json`；完整根CI浏览器新空库矩阵
`resumed/root-native-drawer-ci-browser/`已启动，源码已冻结。尚无本轮根组合通过结论，
尚未推送根改动或触发最终根CI。

2026-10-30 11:49发布进度：主控已独立复核精确13文件和独立clone源码SHA、两jar相同
`8fdcf25649e300c11dcfd83e0ceca71c5667f3dff6ac300b0722d5166fc67fea`、Java286/
PG108/lifecycle24、UI172保全部164旧名及8新名、upgrade8/newinstall3、23bean/349资源
逐hash、薄jar、锁图不变和owner清理。授权后插件已提交推送`73fa96e6`，远端main回读一致，
工作树干净。自动CI`40999171025`运行中，未重复dispatch。尚未取得此提交成功CI及下载
审计，不消费候选jar，不宣称根Compose或最终CI通过。下述11:30/11:43为当时状态记录。

2026-10-30 11:43续查：主控直接执行`docker ps`成功，只有插件本地门拥有的一个
PostgreSQL；磁盘实际空闲121GiB，空间阻塞已解除，不需要清理缓存或证据。
删除焦点新候选实际UI172/172通过，原164项全部保留，新增8项覆盖延迟授权reload、
canonical导航、原trigger存活、取消、412、reload失败、导航失败与失权。
主控已亲审App实现和测试，根最终下载审计现在要求至少172项及全部8个新增具名回归。
完整后端、独立构建、13文件冻结表及owner清理仍在核对；尚未批准本候选提交或发布。
根可提交离线回归已重新实际运行52/52通过，不将此计为生产UI通过。

2026-10-30 11:30新增UI审查状态：维护者清理磁盘后主控实测13GiB，旧空间阻塞解除。
原生抽屉候选已收窄为直接默认KsDrawer/header/SVG/body/footer和KsForm，不派生setup，
不替换全局按钮；saving仅保留纯呈现最大化，关闭/字段/保存/取消/重复提交保护不变。
主控已审12file SHA、完整UI164保156旧名和8新名、Java286/PG108/lifecycle24、upgrade8/
newinstall3、独立clone正式registry输入/同jar、薄jar23bean349UI及锁图不变。提交前发现
真实删除焦点竞态仍阻塞：App先deletion=null再load替换sidebar，旧fallback随即断开。
现已撤销旧12file提交授权，扩大仅一个定向测试文件并在已有App写集修复授权reload及
canonical导航完成后当前fallback恢复；未提交、未推送、未触CI，须按新文件表重审。

根聚焦诊断`root-ui-round3-driver-recheck`实际8/9通过，清全部/subject空交集刷新/末页
删除规范URL均已通过同原断言，旧卡片/抽屉不作为新候选通过。另一次复制/删除聚焦
5/7通过：Clipboard已证当前Ego Task.cdp不实现Browser.setPermission（Browser.getVersion
也明确method not found），这不是产品复制通过。Page.targetId为lazy句柄，初始化前
undefined/后为真实ID，根现按初始化后实际ID限定origin/context，未作用其他用户页面。
不修改其他客户端权限，不用全局reset绕过。工具不支持的本地复制用例明确not_run且
整轮不通过；最终完整CI-browser仍必须实际拒绝/重试/剪贴板核对。独立本地Playwright
实际Browser.setPermission denied→prompt已验证可用，仅为工具能力证据，不算生产复制门。
敏感凭据截图继续禁止；预期抑制单独留artifact-suppressed记录，不污染后续诊断，真正
协议/文件系统错误仍失败关闭。6项适配器离线回归已过，全部根离线当前44项通过。
根共享矩阵现逐主题/语言/宽度对照真实KV原生抽屉样式/SVG/footer，并用Range测卡片
数量单位正gap；未实际跑新版本前不能声称其呈现通过。最终下载插件门至少164及8个
新具名用例，旧156报告不能满足本轮要求。唯一PG资源交插件本地最终门，主控不并启环境。

维护者2026-10-30新增原生抽屉与卡片分隔复核：主控按指定KV Create生产实测，1280
原生header右padding16、body/footer20，原生ArrowExpand/ElDrawer Close均SVG且无方框，
footer贴底；正式plugin f456自造⤢/×方框32，header右padding20，清零native body后
另设form padding20，footer在内容流bottom326。宽屏输入有效右距实际均20，不伪称
宽屏输入右距不同；窄屏plugin还覆盖为16/12，仍须按原生复验。图片/数值在
`resumed/production-drawer-native-review/`，主控已实际查看原生与插件图片。卡片DOM
textContent虽含`54 scope`等空白，Range实测三类数量右端到单位起点均0px，原因是
native按钮内部flex将`<b>`与匿名文本间空白折叠；不能用增加模板空白应付。
已将插件前端独占写集交新Herdr native-drawer-plugin（wW:p1T），同agent探测/后续
标记和实际启动进程已亲核，最初startup admission blocked的真实错误及恢复过程保留。
任务只复用正式1b2b宿主的公开原生组件，不改Java/API/SDK，不启动PG/浏览器；UI/H2
候选和原生计数gap由其实施，主控独占根驱动与现有Compose，未授权提交/推送/CI。

根候选a4d224f已本地提交但未推送。完整Ego round3尝试269个UI行，失败环境保留，
并非完整通过；REST56、安全26（包含v3子矩阵）、MCP11、聚合和强化T6已过。原生
筛选四位置/四主题48观察、80打开及四个底锚点Clear/Close由主控重解析通过，其他UI
仍失败。已确认根驱动两类问题：手造CDP Escape在Mac/Ego不产生DOM keydown，而公开
page.keyboard.press确实关闭同一个空抽屉；敏感凭据截图拒绝被错误写成协议完整性错误，
继而使后续主题等用例连锁失败。当前修复保留原始失败与显式截图抑制，不捕获凭据；
真正协议损坏仍失败关闭。4项离线保护已过，真实聚焦与新完整门尚待。清筛选、撤销
subject范围和末页删除的URL断言已改为等待同一原定最终规范状态，不手动跳正确URL。

2026-10-30 08:59根并发测试前置修正后的Ego定向round7四项实际全过，清理通过，
互删与互停用各有精确双waiter、holder已释放、一成功一安全拒绝、持久结果与原会话
撤销证据。后台准备实际观察并排空，未关闭清理任务。准备等待后重新取得mutation
客户端及CSRF，原会话见证不重新登录且在操作前再次实测允许；完整账号行hash在所有
准备登录之后取得（正式宿主登录会更新last_login_at），不将合法准备写误算拒绝副作用。
此前round5旧mutation客户端在等待后提前403、round6新登录后旧账号hash失败的报告均
保留，不计通过。最终定向证据`resumed/t6-desktop-observer-ego-round7/main-audit.json`。
这只证明T6，完整新空库Ego与根最终CI仍必须执行；不继承首两轮完整失败报告。

2026-10-30 08:44并发观察器的额外writer已取得正式运行证据：第二轮新空库实际
采样为一个holder加三个JDBC waiter，未放宽断言，仍判失败。无业务HTTP请求的独立
有界探测再次观察到一个后台waiter，同刻HotSpot线程栈明确为scheduled线程调用
`OidcOwnershipService.cleanup → OidcProtocolState.lockSecurityState → OidcSecurityTransactions.lock`。
本次SIGQUIT只打印线程，正式JVM始终运行，holder已释放；报告与限定栈保留于
`resumed/t6-scheduled-writer-probe-round2/`。宿主0190公开源码的每分钟清理与该证据一致，
不是把第三个未知事务任意忽略。前一探测缺SQL终止分号失败，亦保留；07:53:21合盖睡眠
至08:37:19的系统事件只影响诊断窗口，不用它解释此前07:47的真实三waiter失败。
根测试增加独占cohort准备：不发HTTP写、不关闭scheduler，实际观察一个后台writer并
释放、确认安全锁已排空后才取业务before快照。初版分段短事务的定向round4仅互删
通过，互停用准备失败，报告保留且不计全过；分段间隙可能漏过清理，因此当前改为单个
连续有界测试事务，500ms心跳和服务端4秒空闲断连兜底，总准备期限75秒。它只阻塞
本次隔离部署且没有业务HTTP请求的准备阶段，不修改产品60秒撤权门；随后原1.5秒
真实双waiter观察与第三writer拒绝完全保留。7项离线拒绝保护通过；新定向真实T6
round5仍在执行，尚未把准备代码宣称为完整组合通过。首两轮完整报告及失败保持不变。

2026-10-30 07:44新正式组合首轮Ego已在T6观察器失败，不能计通过：冻结原型真实UI、
维护、首装与两项回滚检查通过，但并发DELETE虽为204/403，未取得双waiter证明；
报告`resumed/root-compose-desktop-final-local/`保留。初始错误未保存具体观察断言，
不能断言是产品缺陷或已确定的环境故障。主控补充失败phase与实际PG采样，不延长
1.5秒观察期限、不允许顺序结果通过。普通Node定向诊断中互删真实双waiter通过，
后续因诊断回调写同一tmp文件竞争失败；该诊断失败与源码、旧报告均保留。另一次Ego
诊断因工具PATH未传入立即失败；修正独立诊断PATH及串行记录后，真实四项T6全部
通过，互删/互停用均实际双waiter、holder释放与恢复通过，证据
`resumed/t6-desktop-observer-ego-round3/report.json`。这不是完整组合通过，也不追认首轮。
主控另将本地冻结检查后仍存活的Ego页面导航到about:blank，保证并发门的独占两请求
前置；CI冻结浏览器原先已关闭。该隔离不放宽产品门，不能据此断言首轮根因已证实。
首轮owner已核label定点清理，下一轮复用同一Ego14空间但必须新空库完整执行。

2026-10-30 07:27插件f45641b/CI40972006759成功，artifact12940707783实际ZIP SHA
f59cb42b11e5eb9850e39ca8120e13f6083bd92456e4018a66d737e6b4a0005f由主控核元数据。
实际下载XML286/108/24、UI156完整本地顺序/10新具名门、升级8/新装3、审计PG见证、
23bean/349UI逐hash及正式host provenance均亲核。正式jar SHA为
c65805d4cb088032f2fed4ff0e4021b5cebc01ba246fdf2c6fefd590b240d418。主控只从该下载件
选择本地正式jar，保留d099旧件；`.env.example`同步正式1b2b镜像，三仓源码与正式组合
证据绑定到`resumed/formal-release-evidence-desktop-final.json`。主控下载复核脚本和结果为
`resumed/plugin-desktop-final-ci-main/audit.py`及main-audit.json。
唯一PG已交回主控，准备新空库完整Ego共享矩阵，不选例、不改业务断言。根最终提交和CI
仍未取得，不将独立发布写成根交付成功。

2026-10-30 07:15插件最终7文件本地门已由主控重解析：unit286、PG108、lifecycle24、
UI156均零失败/错误/跳过，升级8及新装3具名用例存在，审计实际PG见证已核。
canonical与独立克隆均从正式registry输入提取，两份插件jar SHA一致为
c65805d4cb088032f2fed4ff0e4021b5cebc01ba246fdf2c6fefd590b240d418；仅为本地候选。
23bean索引、349UI资源逐hash与薄jar门亲核，唯一测试PG/owner资源已清理，未知原卷保留。
主控审计`resumed/plugin-final-desktop-main-audit.json`，明确授权仅精确7filehash提交推送，
随后必须实际下载最终自动CI产物。根仍不得选择候选jar。此处不代表新插件CI或组合通过。

2026-10-30 07:02桌面视口宿主e0e952b/CI40964088091五job成功并推广，主控重解析
7实际ZIP及报告：后端97XML/395（2镜像专用skip另由4实际MCP报告核验）、UI95、
20认证JSON、SDK949精确父版ID顺序、几何60精确组合/8诊断源零错误。原digest为
1b2b11023c35adf44f3f0dd534d591eaeeb243acab76ddcb9fc98625486e269a，正常pull/
RepoDigests及未启动提取已核；正式exe为9f563ad6d2498bf2923a0c9088c4f6152027bc89a2ab849cbfaa279fe740e450。
SDK10逐字节等实际CI tar，双架构after/run/BASE匹配，completeness两项false继续保留。
主控已将canonical overlay干净快进到正式提交。审计入口
`resumed/host-desktop-final-ci-main/main-audit.json`及同目录可复跑audit.py。
唯一PG与插件7文件/独立验证树的写入权已交rbac-plugin-final；其本地完整门亲审前
不得提交推送CI。根当前仍选择27520a2/d099594的旧正式输入，不能冒称新组合通过。
根新增几何断言已纳入T11/T12底层重derive：必须有四主题真实底锚点Clear/Close及几何
证据，旧正常位置绿色行不能通过；8项合成报告拒绝保护已过，不算浏览器通过。
新版宿主Compose配置检查也通过且未创建容器；旧正式jar仅作为只读挂载路径验证语法，
不表示新旧组合兼容。报告为`resumed/root-review-agent/new-host-compose-config-only.json`。

本次续接主控另亲跑插件全部156项UI，零失败/取消/跳过，5文件SHA仍等冻结表，日志
`resumed/plugin-ui-main-recheck.log`；不算新宿主编译或正式CI。根定位谓词增加当前锚点
水平夹入检查，11项离线保护通过（8项几何、3项滚动归属与恢复）；生产共享矩阵另增加四主题权限页底锚点实际宿主滚动、
上翻及Clear/Close点击，未修改页面样式或业务数据。这些新增浏览器断言尚未运行，
必须在最终正式组合执行，不能沿用此前正常位置的通过结果。最终插件报告门同步提高至
156并逐名要求10项subject/页签回归。根静态26项检查通过，396项业务仍明确not_run。

2026-10-30 06:43重新核对：Docker正常命令可用，`docker ps`为空，Compose v5.5.1，
可用磁盘约1.5GiB；未检查socket或清理缓存。桌面底部锚点缺口的独立宿主提交为
e0e952ba77804e84724d23d415ec11bbcc8f3684，自动CI40964088091的patch/build/OIDC
三项成功，SDK job尚在执行；未推广，不是插件正式输入。原949保留，几何门由48增至60，
另12项覆盖四主题的桌面底部、离屏和展开重开/resize；本地通过不替代本次CI或根组合。
当前根正式组合仍是27520a2/d099594，根完整验收未通过。插件5文件候选已主控逐SHA核对，
22定向与156全部UI测试通过，但尚待新正式宿主输入的独立编译、存储门和发布CI。
其中subject授予重验空交集不得退回全表、原生box页签取消丢弃必须保留当前选择；
两项须在正式生产登录组合中复验。根T6离线12项本次重跑全过，既有真实双waiter结果
仅属于此前组合，最终组合仍须重跑。证据入口为`resumed/host-desktop-main-approval.json`、
`resumed/plugin-scope-tabs-main-source-audit.json`及`resumed/local-ci-full146/`。

2026-10-30 04:19宿主27520a2/CI40941713707最终5job全成功并推广，7artifact实际
下载、ZIPdigest核对；主控重解析SDK949/几何48/8诊断源零错误、后端395及UI93、
20首装JSON/4MCP专项。registry原digest为bd04a93453bc57d26d7ab2e8292823cbdb81de4398f2b6935f88ae221460e191，
正常pull/RepoDigests及created未启动cp/rm已核，正式exe SHA为
211d6095cb641584ef7797de604aaa74ee5abcc03a775aad354aaac11249d8af。双架构after/run/BASE
匹配，BuildKit completeness两项false保留。canonical已干净快进；插件获准从registry
自己提取编译输入并补公开KsTabs type=box对齐MCP参照，尚未发布新插件或组合通过。

独立根审查F1–F4已形成实质修复：最终checker重derive底层T门/摘要一致；T6并发必须
同一主PG实际安全锁两waiter及精确owner释放证据；workflow只清本run登记且owner核对的
资源；最终期望input从镜像文件/实际jar/root gitlink独立计算。离线12保护通过，真实
强化T6与最终根CI仍待。审查pane wW:p1R本次创建，任务结束已清理，证据保留root-review-agent。

2026-10-30 02:40跨浏览器新宿主缺口已接收、未发布：生产权限长详情页390×900中，
mobile-bar.bottom=1669.031、sheet top约1677/maxHeight=0，字段在视口外；Ego与
CI Playwright共享原断言均失败，不能仅用键盘绕过。实际几何保留于
`resumed/production-mobile-bottom-anchor-gap.json`。overlay独立release树先形成
r-ee-rbac最小通用契约提案：下方够空间保原偏移，不足上翻/夹入视口且保持正高度、
实例归属/滚动/resize/焦点清理。不得引入plugin业务路径。原949/36保持，底锚点另增
精确门；未审/未发布前禁止插件消费。主控旧owner已全部清理，唯一PG验证位置交宿主。

后段诊断（非整轮）另发现并已修根驱动：管理client并行登录竞争改串行显式认证；
Dialog隐藏保留节点按可见判断；原生textarea/wrapper焦点均按计算样式核；冲突刷新
限当前抽屉；掩码提示等待实际读回；默认page1/size25与编码等价按参数核；历史条目
等待当前URL与业务稳定。生产19项聚焦曾全过，后续原完整矩阵仍有失败，全部报告保留。
最新local-ci-full144在移动视口失败后停止，尚未完成全部主题/语言/账号/凭据矩阵，
更未取得根最终提交CI。宿主新正式产物发布后仍须插件独立消费、完整组合重验。

2026-10-30 00:23正式插件70cb552/CI40908627243成功，artifact12911564479实际下载，
主控核286/108/24/144零失败错误跳过、349UI摘要及host9e266/exe6e1一致，jar为
b4866c5b6e184a0ef08804ea8976948edadeb5cb6e9d57375b9e224833ac0800。该版本补原生
size100的同tick重复page更新覆盖；此前3e7正式版本已保留上游styleBase修复真正缺失
overlay样式和删除成功规范导航。主控生产聚焦19个共享操作已全部通过：卡片搜索、
历史、完整分页/100、焦点最大化、删除next/previous/empty、非法query及四类遮罩。
报告`resumed/shared-ui-final-pagination-diagnostic/`；其余not_run，不能代全量。旧owner
部署/PG/卷已定点清理，当前准备从空库完整重验，根最终提交/CI仍未完成。

20:47正式plugin6eb6bc0/CI40872250865通过，artifact12896672301实际下载后主控重核
286/108/24/133零失败错误跳过、host9e266/exe6e1一致及349UI逐hash；正式jar为
4b7b223c0f7ca0a05adbf820a402fd33e8bff88a09bba95ae93a5aac4fb2b1a3。
本轮修复真实SDK portal层在内容完整性失败前的原生关闭顺序，主控在正式运行产物上
执行共享原断言诊断：六条关联导航通过，筛选四主题×四位置桌面/390的48条观察、
16次Apply删除后的真实Clear/重挂载/列表恢复均通过。报告为
`resumed/shared-production-filter-recovery-round3/report.json`，主控审计`main-audit.json`。
诊断只选择六项，其余明确not_run且完整module返回未完成，不能替代全量或根CI。
外部物理移除生命周期scrim的探索失败仍保留，当前SDK不保证该情况安全恢复，不计通过。

18:36第二次完整本地组合因环境干扰作废：macOS日志实证17:33:53 Clamshell Sleep、
17:36:43 DarkWake及反复睡眠至18:24:24；同区间Docker子命令和HTTP发生超时。
此前新空库REST56、冻结原型/T6/维护通过，但安全v3准备失败、UI未运行，不能计最终。
主控核专属Node75227后停止并确认CLI退出；睡眠事件、原报告、环境判定及owner清理
均保留于`resumed/root-compose-query-final-local/`。唯一主Compose/PG/卷已定点清理。
未改产品来掩盖此环境超时，不延长60秒撤权标准。下一轮使用任务专属caffeinate防空闲
睡眠，不修改系统设置；合盖仍不能保证被阻止，若重现仍不计通过。

17:17正式plugin4e2ed30/自动CI40845571223通过，artifact12885066771已实际下载，完整
ZIP SHA与metadata digest匹配。主控重解析286/108/24/125全零失败错误跳过、349UI资源
逐hash及host9e266/exe6e1一致；jar3d388db75d15c3a2578330558003c21f7b20d0a71aeca23137ba41386d922e5b。
在保留诊断部署重启JVM装载该正式下载jar后，生产Ego query聚焦32/32（四主题×四位置
×桌面/390）真实选值、query保存、弹层连续操作及关闭通过，64个打开定位样本已绑定
运行hash。旧失败报告和辅助脚本错误保留，不能算整轮通过。诊断owner主Compose/PG及
卷已定点清理，接下来从空库执行新全量组合；根最终CI仍未触发。

16:43生产几何独立诊断已完成32/32（四主题×四管理位置×1280/390），实际64次打开/
重开。主控核运行镜像9e266及jar b44b，对应正式plugin5628；报告与SHA在
`resumed/production-filter-geometry-themes/`。此结论不覆盖已知query连续编辑失败。
插件候选App级回归已复现有效值host echo导致实例卸载、连续query被busy挡、过时host ack
回退新query三类问题。7项权限/身份/403/503/历史清敏回归曾通过，但ack顺序门仍红，
候选未提交。主控发现并纠正过时load清掉新query刷新标志的generation边界；要求真实
refresh点击和外部路径/tenant/dispose取消待发query回归，禁止以保实例为由绕过授权。

16:29真实组合首次本轮已失败并停止，不能记交付：正式host1e363/plugin5628下REST56、
安全26、MCP11、聚合、维护、冻结原型及T6事务均通过；UI先10项通过，scope/app深链
跨侧栏页时选中项不可见导致4项等待超时。PID335为本次嵌入Node，核lstart/进程后已
SIGTERM并确认退出，CLI退出；报告/截图及owner部署保留诊断，不将局部通过归最终。
插件侧栏红2→绿2、完整UI113并实施候选；尚未发布。

聚焦生产筛选round2实际8/8（4位置×1280/390，各2opens）通过；round1因用户单字段
重复添加不会生成第二行而断言错误，已改真实Clear归零，不降低合法添加检查。round3
实际选值触发另一个产品缺口：query保存后App整页load清敏卸载KsFilter，父弹层消失，
Close找0。已交插件修同路径query同步并保留组件/焦点，身份/路径改变仍重载且非法query
失败关闭。必须补App级context.navigate回传回归及真实生产多条件/重开，不能仅靠孤立
KsFilter绿测。报告路径`resumed/root-compose-filter-final-local`及`production-filter-focused-round*`。

15:21正式宿主本机产物门已通过：OCI缓存13个可达blob主控逐hash/size亲核，正常
docker pull原9e266成功、RepoDigests包含原index digest；created未启动容器提取后已rm。
正式exe SHA为6e1a19a258917e1d40e00b0abde9d80371d3dfe471ae133f79760a479e3af09f，
主控复算SDK10与CI/被测输入逐字节相同、宿主UI532。镜像获取阻塞解除，已交插件从
自身registry入口独立提取并执行完整本地门，禁止把host.work文件当编译依赖。根仍保留
旧正式jar/pin，待最终插件CI和产物后切换；根396项完整生产验收尚未运行。

15:08主控已解析插件候选原生Node JUnit：111具名用例全passed，新增移动false配置、
en→fr/de切换、合法选择/Clear/Apply及结构损坏后的卸载→清除→重挂载两项均存在。
根发布门已强制下载最终插件`.evidence/ui/results.xml`并核这些具名用例、真实数量及
零失败/错误/跳过；最终报告再绑定commit/run/artifact/SHA与后端同件产物。不是插件CI
或生产浏览器通过。移动保存裁决已收窄为落实既有false，不新增保存功能；适配代码不
读取/迁移/删除旧保存记录，但原生KsFilter自身仍会useStorage读取默认key，未虚报消除。
新镜像层保留约91MB连续前缀及已验证非连续块，完整SHA/正式exe/插件新输入门尚待。

14:46新增消费风险尚未裁决：DS0.5移动层忽略`buttons.savedFilters.shown=false`，
仍露Save/My Filters；其保存key依赖prefix与route.name，插件尚未提供隔离prefix，
删除还调用未声明适配的KsMessageBox服务。已要求插件核最小范围：落实原有隐藏配置
或明确支持后按公开prefix隔离，不为修界面引入全局服务劫持或复制vendor。不能把这些
按钮计有效。Ego空间7已在14:42返回not found、list为空；已停止该空间操作并保存
`ego-space7-disappeared.json`，原因未验证，之前8组报告保留，生产UI仍未运行。

14:39重新核根当前HEAD的真实CI：a6fe358对应40467372007为failure，已下载失败日志
并在写入前脱敏。失败发生在正式插件选择：当时gitlink16869c1没有成功发布CI；不是
浏览器通过，也不是缺少读取凭据的证据。最终根提交必须更新为本轮正式两仓gitlink并
重新成功运行，不能复用此失败run或旧绿色。日志为`root-existing-head-ci-failure-redacted.log`。

14:37下载缓存补救取得可复核进展：主控正常`docker image save`上一正式90388，流式
检查而不保存整archive，得到9个与新arm64 manifest逐SHA/size相同的原压缩blob，合计
123,598,967字节；报告与文件在`resumed/formal-parent-blob-cache/`。此为正式Docker
缓存复用，不读取相邻源码、不构建宿主。已交下载owner复核，只剩新层120,292,156及
157字节需获取；仍须原digest正常pull/RepoDigests及created/cp门。前述fork辅助下载
失败日志保留并已改独立subprocess硬截止，不能把工具失败误记为产品或网络失败。

14:28正式产物获取诊断：Docker客户端/daemon29.8.2正常，普通只读df容器立即执行，
VM盘剩279.1GiB，未启动PG。registry鉴权、manifest及两新blob HEAD200；实际Range
GET从pkg-containers.githubusercontent.com取得206及精确Content-Range，公开传输并非
完全不可达。Docker原pull停在新层，已停止本次自有挂起pull，未停daemon。子agent仅从
正式registry按原index/arm64 manifest/config/逐层SHA下载OCI缓存补救；仍必须正常
pull原多架构digest、RepoDigests精确匹配及created/cp正式exe，不能用单架构archive
冒充发布digest或通过状态。插件和根完整门仍待，未降低。

14:15主控核下载949的ID/顺序与根完整计划精确相同，几何driver/fixture三源码摘要与
canonical一致；双架构provenance事件after1e363/run40822882820/BASE172匹配，BuildKit
两项completeness=false仍明确保留。canonical overlay从干净4151安全快进至正式1e363，
无自造提交。根部署pin仍90388配原正式jar，未误混新宿主。arm64首次拉取600秒超时，
原collector未保存partial stdout/stderr是证据限制；已要求独立流式重试及具体错误定位。
根生产门另增加52主题语言的AND说明精确翻译及独立说明块无溢出检查，仍全部未运行。

14:04宿主1e3632e的自动CI40822882820最终5job全部成功，推广成功。7件artifact已实际
下载，主控重解析97XML=395/0失败/0错误/2镜像专项skip、SDK949全部通过、几何36全部
通过且8诊断源零错误；同build691f78及driver/source/frozen结束摘要一致。registry raw
index摘要为9e2667744f9f0515a9902aa3d83bca3a3433aa9b752ec72fd8c07f3c539acdd0。
正式arm64拉取及exe审计正在继续，canonical尚未快进；插件待消费正式输入，根组合未通过。
主控独立报告：`.work/access-control-v3-20261027/resumed/host-filter-main-downloaded-audit.json`。

13:36主控独立Ego补验完成：同冻结SDK691f78的4主题×桌面/390共8组，每组依次
打开实例0、1、0，等待锚点偏移稳定、真实选择First并保存，验证实例1未改变。报告
`filter-native-comparison/host-candidate/ego-review-round-20261029.json`为8/8，明确只证明
独立SDK，不证明生产插件。当前根静态检查0失败/396未运行，完整§11原文脚本通过。
根发布门修正几何报告字段核对：driverSha256才是driver摘要，sourceSha256是多文件映射；
同时强制finalSourceHashesEqual和finalInputHashesEqual，未降低36项/8诊断/949门。

13:48根真实生产筛选断言已补齐，尚未运行：4主题×4页面，桌面各重开两次并核同主题
Namespaces原生计算样式、AND禁用说明、键盘跳过禁用OR、添加行、字段选择及二级Escape；
390窄屏实际选值、等待URL保存与唯一结果、Apply关闭及重开定位。单比较符原生下拉本应
disabled，旧脚本尝试点击不合法；改断言禁用及正确Equals/Contains，有多比较符仍真实选。
打开高级筛选按当前原生状态识别直接高级面板或入口，不重复假定入口存在。插件候选
组件106/106仅是子agent输入，主控仍需复核，正式宿主消费/完整插件门/组合UI均待执行。

13:27复核：宿主b363001的CI40818562486实际失败，原949通过但新增几何在dark/390
选择值后Apply超出视口，promote跳过。旧失败JSON、截图及日志完整保留，不计正式发布。
子agent在本地重新完成36项后提交1e3632e，仅为内层select仍打开时先用Escape关闭并
断言父层保留；不改SDK、样式、949或矩阵数量。自动CI40822882820仍在运行，禁止消费
候选。主控Ego空间7实际dark390选择First、Apply保存、再次打开保留值，证据为
`filter-native-comparison/host-candidate/ego-ci-driver-review.json`。根仓生产门同步修正
重开入口状态识别，新增四位置disabled/aria-describedby的AND说明检查；未执行仍不计通过。

12:48发布进度：宿主b363001/自动CI40818562486的patch、build和OIDC job已成功，
SDK job仍执行原949及新增几何，推广未开始。主控已复算14提交blob等批准SHA，不切换
插件/部署。插件AND消费限制裁决已记录：DS0.5公开接口没有logical能力开关，后续
用版本绑定、精确owned filter/portal的薄封装明确禁用不支持OR入口并提供本地化说明，
同时阻止mouse/Enter/Space；不得仅CSS、全局事件、OR静默转换或复制vendor。合法AND
与手工OR错误清除恢复必须真实验证。该方案未实施，不能将当前groupable修复计完整。

12:34宿主14文件主控最终快审接收并授权提交：最终localci后端395/前端89、MCP四项、
两首装20JSON、原949完整及新增36几何同build691f78均通过；主控亲核零浏览器错误。
333触达文件正确parent4151加46patch独立重放一致，UI532未变，SDK10仅helper/README
更新。CI失败前初始化geometry未运行报告/隐藏PNG上传已审。候选exe9638e2f7…a8dcabd
不作为正式输入；新提交CI/推广/下载尚待取得。插件inline冲突取消与groupable配置候选
继续冻结，正式SDK发布后一起消费重验，不能把宿主36通过写成真实插件UI通过。

12:24最终候选补验：无追踪冻结buildId为691f78fc…1f52664，独立真实几何36/36、
8份collector零错误，主控亲解析。原949同快照已593通过/零失败，尚未结束。主控Ego
复核双实例：第2锚点x114/bottom391.187→弹层x114/y397.187，宿主同名decoy x8不影响，
二级ESC保留父层；dark390第2栏x12/w366→面板x12/w366，真实Second选择及Apply仅更新
第2实例。截图/JSON在host-candidate/ego-frozen-*，不是正式插件组合通过。先前16条
移动锚点console已通过逐实例关联修复，未豁免；root内滚动捕获及已登记advanced样式
重算防宿主全局锚点覆盖。仍须949结束、普通镜像完整门/最终CI/发布，然后插件消费。

12:03补充：生产对照时宿主Namespaces曾出现授权拒绝提示，主控核实为测试观察者未配置
该参照页的NAMESPACE读取。根配置只补四个既有测试命名空间READ/LIST及默认MCP server
精确ID的READ/LIST，供正式页面参照，不扩普通账号/不加写权限。下一轮必须实际核对
允许列表与无拒绝诊断，不能以组件可见代替页面授权成功。

| 位置/动作 | 正式版本实际证据 | 当前裁决与所属仓 | 本次已验证状态 |
|---|---|---|---|
| 宿主Namespaces添加筛选→高级筛选 | 按钮(301,92)，弹窗left301/top130；重开同位置，添加条件有效 | 实际发布宿主的比较基准 | Ego真实点击与JSON已保存 |
| 插件应用组列表高级筛选 | 按钮(311,163)，弹窗(0,0)、style空；重开仍错 | SDK桌面锚点无法穿透ShadowRoot，最小宿主适配 | 旧SDK新增回归真红；候选unit14及Ego定位/重开通过，未发布 |
| 插件用户/权限列表高级筛选 | 弹窗(0,0)，enabled“添加条件”点击后0行 | 定位归SDK；groupable:false配置归插件 | Ego分别复现；插件候选组件门通过，未正式组合验证 |
| chip编辑与二级select | 候选真实选择First后仅one/three两行 | 保留原生chip自身定位，SDK不覆盖 | Ego实际选择/数据结果通过；完整多主题及重开门仍待 |
| rules-pill/同根多个filter | 额外入口曾未记录，可能沿旧锚点 | SDK只跟踪本根真实控件，不使用全局query或固定坐标 | 单元新增rules-pill/scroll/dispose；真实多filter单列几何门待完成 |
| 390窄屏 | 宿主原生移动面板与栏位x32/w326对齐；候选同样x32/w326 | 保持宿主响应式行为及主题 | Ego对照JSON已存，全部主题/语言/焦点仍待最终矩阵 |
| 插件AND业务约束 | nativeChips拒绝OR；原生条件组提供OR入口 | 不擅改业务语义，必须核公开配置/明确支持范围 | 风险已记录，不将enabled但必错按钮计通过 |

2026-10-29 11:40，维护者新增筛选交互重点已实际调查：Ego对照正式宿主Namespaces与
正式插件，宿主按钮(301,92)→高级弹层left301/top130，插件应用组按钮(311,163)→
弹层(0,0)、无style，关闭重开仍错误；用户和权限页同样复现。主控源码核上游高级
筛选document.querySelector无法找到ShadowRoot锚点，最小SDK候选只定位本根真实
customize/rules-pill，不全局替换查询、不复制vendor。旧正式helper新增几何用例红1/
13通过，候选14/14；Ego候选最终x86/bottom319.328→弹层x86/y325.328、条件/组和
嵌套select真实点击过滤有效，390移动与原生对照无横向溢出。仍是候选，不计发布。
另插件AccessList所有keys配置groupable:false使用户/权限/subject高级“添加条件”
点击零行，已分配插件合法原生配置修复；不将业务字段迁宿主。正式证据与截图在
`filter-native-comparison/`。已授权宿主完整原949加单列几何门，随后插件消费发布及
根真实全组合验收，尚未通过。诊断root20已正常结束并按owner清理，无遗留执行Node。

2026-10-29 10:50：发现主控中止方法错误：SIGINT仅断开ego-browser CLI，embedded
Node执行仍可继续。已核round19 runtime PID40092及启动时间，仅SIGTERM该本次执行，
ps确认消失；Ego服务29466未signal。原operator-stop文件保留，并为16/17/18/19新增
更正证据；不能把CLI退出视为执行停止，存在后续输入变化的轮次标operatorInvalidated，
不计验收。round19原partial报告保留，主控owner部署已拆除。重复名409后取消禁用
已作为插件真实UI缺陷授权最小修复；最终仍须全新冻结输入从头运行，不能用这些局部
诊断或先前绿色结果代替根最终提交的组合与CI。

2026-10-29 10:11：插件 `862ccf9` / CI `40803869433` 成功，artifact `12867218072`
已实际下载，主控复解析286/108/24全零失败错误跳过，新jar99f1已装入忽略目录，旧6318
保留。最终clone/UI89/升级8/首装3通过，正式host90388不变。round19现从空数据库
执行包含原生筛选/焦点/冲突修复的最新组合；非最终根提交运行，不能计最终根CI通过。

2026-10-29 10:00：插件唯一冲突11文件通过主控逐SHA审查并授权提交；scope创建/改名
及跨组client三项旧400真红均修为精确409，无副作用。final-success286单元/108PG/
24生命周期全零失败错误跳过，UI89/升级8/首装3通过；测试client旧登记前置错误与
多轮exit1报告单独保留，不当成产品红测。候选jar99f1f5e1…bec818，最终提交CI/下载/
独立clone待取得。宿主90388不变，根完整组合与全UI、最终提交CI仍未通过。

2026-10-29 09:40：round18再次通过真实T6四项、REST56、MCP全11项，安全仅旧内置组
400断言失败，已改精确409 protected_group待新轮重验。真实UI前十项通过，重复scope名
真实PUT400（预期409）确认为插件分类缺口；已授权仅事务写边界的scope_name_exists/
client_already_assigned专用409，损坏快照/非法输入不改分类。其余UI诊断失败涉及
导航稳定内容、原生复选框隐藏input、advanced filter二级入口、chip定位及授予派生
授权版本比较，已按实际DOM和公开契约修测试，未记通过。主控仅SIGINT中止本轮CLI，
保留partial报告与operator-stop记录，owner独占部署已清理。新插件正式发布、全UI/
完整组合和根最终提交CI仍待完成。

2026-10-29 09:00：插件 `192062d` / CI `40788946268` 成功，artifact `12859849870`
实际下载，主控复解析286/108/23零失败/错误/跳过，新jar6318已装入忽略目录且旧e071
保留。独立最终clone/UI89/首装3/升级8通过。round18现从空数据库执行正式90388+
6318组合，包含最新根UI/安全断言修正；仍为根仓未提交的非最终运行，不计最终CI通过。

2026-10-29 07:39：插件删除冲突七文件通过主控逐SHA审查并授权提交：内置组409
protected_group、非空409 group_not_empty，CAS412/非法400/权限403保持。286单元/
108PG/23生命周期全零失败错误跳过，新增真实Controller无副作用检查通过；候选jar
63189673…9189303，薄jar/索引/349资源通过。新最终CI、正式下载及独立最终clone待取得。
root业务UI定位/原生可见焦点修正与完整runtime已实现，但未完成全矩阵，不能计通过。

2026-10-29 07:28：round12真实T6四项、REST56、MCP全部11项（含三撤权/refresh/缺插件）
通过。安全失败四项中：两503实际状态正确但测试漏宿主traceId；旧路由扫描误把无
Controller注册的历史类方法计活动路由；零授权capabilities应按宿主403拒绝而非200。
这些已据实际契约修正，原报告不改。业务UI初始菜单/路径等待及多处定位错误已用
Ego实际DOM纠正；诊断13–17保留，16/17因具体失败由主控中止，仅本次CLI收到SIGINT，
未停止Ego/Herdr服务，不记通过。CI运行时控制丢失已补共享hydrate并实际执行，仍需
最终完整矩阵。内置/非空组删除目前400，主控裁决分别409 protected_group/group_not_empty，
已授权插件最小分类修复及真实PG无副作用回归；CAS412/非法400/权限403保持。
本轮owner部署已清理；新插件发布、完整UI/组合及最终根提交CI仍未通过。

2026-10-29 06:34：插件 `42ceeeb` / CI `40780018961` 成功，artifact `12857491022`
实际下载，主控复解析286/108/22零失败/错误/跳过并重算新jar e071；最终提交独立克隆
clean check通过。已保留旧801d，根仓选择正式90388镜像及新jar，round12从空数据库
执行。前置输入及故障断言修复须由该轮重验，原round11失败不改。当前仍非最终根提交
运行，真实完整组合、业务UI和最终根CI尚未通过。

2026-10-29 06:25：插件消费正式90388镜像及授权复查接口，十三文件已主控逐SHA审查
并授权提交推送。42 XML/286单元、17 XML/108 PG、3 XML/22生命周期均零失败/错误/
跳过，UI89、upgrade8/newinstall3与候选独立克隆通过；正确路由下3项真红→3绿，
首轮缺路由失败单独保留，不误算产品红测。候选jar `e071ca20…37f88f`，薄jar/23索引/
349资源重算通过。最终提交CI、正式下载及最终clean clone尚待取得；根仓未切换候选。

2026-10-29 05:58：宿主 `4151e1b` / CI `40767280055` 五项job成功并正式推广
`90388a6d…d9bdfe`，executable为 `169fe749…58ebd9`。主控实读最终下载97 XML/395
（零失败错误、2专用跳过）、SDK949与20认证JSON全通过；实际推广/registry及双架构
provenance匹配，完整性false限制保留。canonical已安全ff且干净。已分配插件消费
正式default授权复查入口和精确依赖异常；其本地门/新提交CI/产物仍待验证，根仓尚未
切换部署组合，不继承旧镜像的局部通过。完整根组合及最终根提交CI仍未通过。

2026-10-29 04:58：宿主503修复 `4151e1b` 已推送，自动CI `40767280055` 正在构建，
patch-verify成功；主控复算17提交blob全等批准表，release干净。尚未推广，不能供插件
消费。根故障断言保留精确503，并按新增公开契约核安全RFC7807 service-unavailable
正文或原插件directory_unavailable错误码；403继续失败，不把安全拒绝当依赖故障。

2026-10-29 04:52：503宿主17文件通过主控逐SHA审查并授权提交推送；两种首装各10份
JSON全部completed，新增真实生产cookie503各7项、原身份复查24/资料26/favicon26等
均保持。MCP审计原错误计零份，主控实际解析四XML各1项零失败/跳过并要求修正，
不是省略专项。新增脚本先拒绝五类同名资源冲突且不取得清理权，安全复测通过；58源
独立重放、SDK10/UI532保持父正式输入。最终提交CI/SDK949/推广尚未取得，插件仍
消费旧正式2b67镜像；根仓后续完整组合与最终提交CI仍未通过。

2026-10-29 04:42：503宿主候选完整local-ci 395项（393通过、2镜像专用跳过）及UI87
通过，仍未提交或发布。主控另核真实生产签名cookie与应用组claim的镜像探针7项：
允许200→自有投影表不可读503→恢复后同cookie200，无账号副作用。该证据文件名含red，
但实际为成功诊断，不记为红测；真正begin-sync403→503红测另存。classpath/OIDC35/MCP4
通过，两种首装完整门仍在执行。V1普通异常与V2借用连接兼容保持，新增default授权
入口，不以旧SDK949代替新提交CI。根仓静态检查0失败、395未运行；完整组合仍未通过。

21:42 round11真实T6四项及REST56全部通过，后续安全/MCP/UI准备失败仍保留，不作组合
通过。已实证两项根前置问题：TENANT grant的GET省略null namespace，严格写输入需补
合法null，原输入PUT400、补null后200；MCP资源audience曾误用登录kestra-ui，改成精确
MCP资源URL后真实DCR/PKCE/consent及tools/list200返回精确4工具，证据
`mcp-resource-audience-diagnostic.json`。根测试据此规范输入/刷新支持变化后会话，保留
错误audience拒绝，不扩大业务授权。另集合顺序比较与RFC7807拒绝正文已按正式契约修正。
依赖表不可读的管理GET仍403，违反明确503门；主控已接收宿主最小授权依赖异常分类
提案，V1普通/V2生命周期原契约保持，新增default授权复查入口和明确异常传播，不把
未知异常/缺插件全改503。宿主实施与发布、插件消费、根重验仍未完成。原round11及
故障回执保留，本轮独占部署已按owner清理，不删除用户部署或未知匿名卷。

20:51 新正式组合已取得：宿主 `e720f55` / CI `40663374442` 五门成功并推广
`2b67b233…2644b8`，正式exe `aad527bb…095cbcc`；主控核实际下载385 XML/SDK949与exe。
插件 `3cb6a33` / CI `40681482628` 成功，artifact `12813530231` 实际下载；主控复解析
281/108/19全部零失败/错误/跳过，新jar `801d3d56…159870` 已保留于deployment/libs，
旧b7a另保留.work。最终clone门与schema2升级8/首装3/UI89通过；BuildKit完整性false
限制不变。round11现以新正式组合从空数据库执行，仍是未提交根仓的非最终诊断。
真实HTTP互删/互停用、后续业务UI、完整根组合与最终根提交CI仍待该轮核验。

17:19 宿主V2分类修复11文件通过主控审查并授权提交推送：真实锁等待4红→4绿、分类
单元6、完整93 XML/385（383通过、2镜像专用跳过）、UI87、OIDC35/MCP四项及两模式
18份认证报告通过，新增每模式V2复查24项。借用连接无提交/回滚/关闭副作用，SQL/投影
损坏仍UNAVAILABLE，V1原异常契约保持。21源码重放一致、SDK10/UI532等正式父输入；
本地候选exe `77d49fd2…8967c0` 不作为正式插件输入。最终提交CI/949/推广待取得，
真实插件互删、互停用与完整根仓验收仍未通过。

16:41 round10 两项真实事务回滚检查通过，互删管理员请求实际204+503失败，互停用未运行。
已确认宿主借用连接身份复查将锁等待后账号删除/停用等明确身份失效折叠为普通异常，
生命周期分派再转UNAVAILABLE；插件最终映射503。主控接收最小宿主异常分类修复提案，
仅明确安全拒绝映射FORBIDDEN、SQL/投影/组件故障保持UNAVAILABLE，不按异常消息分类，
不把503纳入根允许集。原事务清理中permission及报告回调失败仍保留失败；独占round10
部署已按owner拆除。根仓另修报告并发持久化队列，30并发回执测试最大同时写入1，
业务状态门不变。宿主新修复测试/CI/发布、后续插件消费及完整根验收均尚未通过。

16:33 插件修复 `a1894b7` / CI `40656389624` 成功，artifact `12802191008` 实际
下载，主控复解析281/108/16全零失败/错误/跳过；新jar `b7a872aca460739020c9655c4f570e38c093877c1e2402b8f6b71d0323789ecc`
已装入被忽略的 deployment/libs，旧正式jar另保留于.work。最终提交独立克隆门通过。
round10正在从空数据库执行正式a56镜像与新jar组合，publication已通过；本次根仓
仍带未提交改动，属于非最终诊断，不能计为最终提交组合或根CI通过。

16:22 插件目录缺组404最小修复九文件已主控审查接收：仅目录入口先校验IDENTITY动作，
通过安全 optional 边界区分未知404与跨issuer403；upperBound、capabilities与LOCAL_POLICY
拒绝规则保持。新增4项单元和1项真实PG生命周期用例，完整281/108/16及UI89均零失败
零跳过，schema2升级8和首装3保持通过。已授权按显式九文件提交推送及自动CI，尚未
取得该修复最终CI/产物；候选jar为 `b7a872ac…89ecc`，不得继续以旧47cf作修复后产物。

16:10 round9 冻结生产准备及真实浏览器检查已通过，原 favicon/父入口问题不再阻塞。
随后 T6 准备失败，清理原管理员授予成功、无剩余事务测试资源。主控实际生产登录后
复现有 IDENTITY READ/MANAGE 的 bootstrap 对未知组 GET 返回403；插件目录入口先调用
缺失目标会拒绝的 upperBound，未返回公开管理 API 规定的404。裁决为插件缺陷，不能把
403当不存在或放宽断言。已授权仅插件目录入口修复与红绿回归，保留无权/跨issuer403、
capabilities未知403及LOCAL_POLICY失败关闭。根仓新增仅请求方法/规范路径/状态的安全
事务回执，不保存请求体或凭据；原失败报告保持不改。完整组合与根仓最终CI仍未通过。

16:02 插件 `1aecf6f` / CI `40650697989` 正式成功，artifact `12799642126` 已实际
下载；主控重新解析 41 XML/277 单元、17 XML/108 PG、2 XML/15 生命周期，全部零
失败/错误/跳过，jar 保持 `47cf65f8…68f9`；独立最终提交克隆 clean check 通过。
根仓已选择新正式 digest 与插件，round9 使用真实已下载 artifact 输入，从空数据库
执行。publication、feature-off 首装、显式目录 apply 与统一权限初始化已通过，正进行
功能启用后 JVM 阶段；当前仅为未提交根仓的非最终诊断运行，不能满足最终验收。

15:23 宿主 favicon 正式发布门通过：`dae2b4a` / CI `40645098489` 五项 job 全成功，
registry 推广 digest 为 `a56adfb92b775ec586e70918bbebd6509557b71173faa7c7eb80fea260b84ade`。
主控独立实际下载核心报告核对 91 XML/375 项、16 JSON、SDK949 精确唯一 ID、零失败
及零未分类错误；四份镜像专项覆盖原两项专用跳过，元数据七项均对应最终提交。
正式 executable 为 `33d21c2055c1e3e14063144627d1c4e5f4095364b55f6a249b8e43dfee4565a4`，
双架构 provenance 的 completeness=false 限制仍保留。canonical 已安全快进且干净。
已分配插件消费正式输入并独立复测；当前根 `.env.example` 尚保持上一组合，待插件
对应 CI/产物通过后再整体切换。根仓业务 UI、完整 Compose 和最终提交 CI 仍未通过。

14:47 宿主 `dae2b4adaa9cc0fadbfc9a44a6ba58633dac0419` 已按 14 文件提交推送，
主控逐文件复算提交 blob 等最终批准 SHA。`0385` 仅一行空上下文格式规范化，
19 源码与 SDK10 不变，真实 cached check exit0。自动 CI `40645098489` 正在执行，
patch-verify 成功、build-push 运行中；尚未有新正式镜像推广结论。canonical 保持
旧正式提交，插件输入与根仓组合不抢先切换。

14:36 提交前 cached 检查实际失败：新 `0385` 的单空格空上下文行被判尾随空白。
此前主控普通 `git diff --check` 未覆盖未跟踪 patch，是本次审查遗漏，不能记为索引检查
通过。提交和推送尚未发生。已授权仅规范空上下文格式，必须保存原 patch、重放核对
19 源码与 SDK10 不变、更新输入 hash 后取得真实 cached exit0，才可继续提交。

14:34 主控完成宿主 favicon 14 文件快审并授权提交推送：显式工作文件 SHA 全等审计表，
19 触达源码经正确父提交加 46 补丁独立重放一致；新定向 7 项、完整后端 375 项
（373 通过、2 镜像专用跳过）、UI87、OIDC35、四份 MCP 专项、form/env 原有完整门
及各 favicon26 均核对，新增诊断回归由主控独立重跑 10/10。两模式最终未分类错误零；
早期两份浏览器失败和错误生成基线保留。SDK10 与 UI532 实际文件等正式父镜像，
旧 SDK949 只作为不变输入证据，最终新提交 CI 必须实际执行并下载949，不继承旧绿。
当前仅授权发布步骤，尚无本次新提交 CI/推广结论；正式产物门通过后插件才可更新输入。

14:00 宿主审查：主控亲读新增 favicon HTTP 红测和最终定向日志，后者 7 项通过、零跳过，
但未据此接收候选产物。候选 `0385` 还重复增加父提交 `0230` 已有的改密协议判定；
主控已明确拒绝该 patch，要求从核对完整输入的父基线重新生成并复测，不准仅手删 hunk
掩盖来源问题。完整 local-ci、镜像专项、真实浏览器、新提交 CI 与推广均未通过，根仓
仍只保留未完成结论。

13:51 续核：已接收宿主 favicon 最小提案，实施只限独立 release；共享分类必须核对
规范原始路径、GET/HEAD、真实静态解析及宿主打包资源归属，不能放行所有无方法路由。
宿主 agent 正在补红测，尚无新提交、CI 或镜像通过结论。round7 的两个 owner 容器、
本轮卷和网络已清理，独立清理记录为 `root-compose-round7-cleanup.json`，原失败报告不改。
根仓同类父入口断言已统一：通过公开集合取得首项预期，仍实际进入父路径或点击计数
入口，再等待精确规范子路径；该变更须待新正式组合真实复测。静态检查为 0 失败、
395 未运行，最终 checker 使用完整参数实际拒绝该报告，未将静态成功计为交付。

13:40 续核：正常 `docker ps` 与 `docker compose version` 均成功，未访问 Docker socket。
根仓 round7 在冻结页面的父路径与实际自动选择首个 scope 的规范路径断言不一致处失败；
已修正为从父路径进入并等待实际规范子路径，不手动跳转隐藏失败。随后独立诊断 round8
实际读回 22 用户、19 scope、19 权限和 1 subject，但保留五项未分类浏览器错误，未记通过。
其中首页八个真实图表请求已按请求 ID 与请求正文再次核对：七项执行图表为 200，
`next_executions` 的 `Triggers` 数据源为 403。原因是根仓测试观察者只登记 FLOW/EXECUTION，
缺少 TRIGGER 读取；本次仅给该观察者的四个既有测试命名空间增加 READ/LIST，未增加写入
或普通账号授权。证据为 `.work/access-control-v3-20261027/resumed/dashboard-preview-diagnostic.json`。
匿名登录文档 `/favicon.ico` 的 401 及配对 console 错误仍在调查，不作噪声豁免。
插件正式提交 `32d6f443`、CI `40636316445` 与已下载 jar 已核对；真实完整 Compose、生产
业务 UI 与最终根提交 CI 尚未通过。

12:59 续核：overlay `3a96e111` 的 CI `40632084140` 五项门全部成功并推广。主控实际
下载七项 artifact 元数据与报告，核对后端 368、UI 87、四份 MCP 专项、两种首装 14 份
JSON（包括各 26 项空资料）及 SDK 949 精确矩阵/零错误。registry index、推广日志和
SDK candidate image 一致为 `e5f8a2e5…0014fb26`，双架构 provenance 的提交/run/BASE
均匹配，完整性 false 限制保留。正式 arm64 镜像已拉取，未启动提取容器删除，正式
executable SHA 为 `190fb02df7923f096bc8a540b49c5e96f16a25736f3c1649749dcb51a7eae15b`；
十项 SDK 资源等最终 CI 输入包，canonical 已干净 fast-forward 至同一提交。插件正在
消费新正式输入并执行新增空资料 readback；根仓冻结准备、生产业务 UI、完整组合和
最终根提交 CI 仍须继续，不继承旧输入的局部成功。

12:25 续核：账号空资料最小修复已完成本地门并提交为 overlay `3a96e111`，自动 CI
`40632084140` 运行中。主控实读红测两项失败、修复后目录 14 项全过，归档后端 368
项（366 通过、2 项镜像专用前置跳过）、UI 87 项；新镜像 classpath/OIDC35/MCP四项
和 form/env 各 22/7/26/52/215/14 + profile26 全部通过，后端两项专用在镜像门实际
执行零跳过。候选 executable 为 `7398388f…88dee6`。14 文件提交 blob、remote、父提交
及干净 release 已亲核；323 编译源、441 SDK 缓存及 9 入口哈希实际重算一致。
需取得该提交最终 CI、实际下载报告及正式镜像推广后，插件才可消费并执行新增空资料
读回断言。根仓不能改非空测试数据绕过；生产业务 UI 和最终组合/根 CI 仍未通过。

11:39 续核：插件 `4f7fa9a` 的 CI `40626018407` 成功，主控已实际下载 artifact
`12789646503`，核对 277/108/15 项 XML、新装三项、升级八项及 349 项 UI 资源，正式
host provenance 为 f7d195b6/ fd16fcfa，jar 47cf65f8。根仓 `root-compose-round5` 使用
这两个正式产物，真实通过新装五表、完整维护轮换、临时密码强改及重新登录。
随后冻结准备的 bootstrap 账号空姓名/邮箱 PUT profile 返回 400。需求明确姓名/邮箱
可空，原型“—”转空；实际插件 HTTP/UI 允许空字符串，宿主 OidcUserDirectory 的
createTemporary 将空转 null 后生成 subject/@localhost 默认资料，update 的 text 校验
又拒空。属于新发现的宿主公开账号目录契约缺口，不能改非空测试数据或另造插件存储。
已授权仅 V2 临时创建保存空资料及 update 清空能力的最小修复方向，保留历史 V1 默认
行为和 subject/凭据/权限边界；须先真实 PG 红测，再完整宿主门并正式发布，插件之后
才可消费。失败轮留证后已核 owner 清理唯一 Compose/PG，旧报告不改写为通过。
当前无环境阻塞，正在处理实际产品缺口；生产业务 UI、根仓最终组合和 CI 仍未通过。

10:58 续核：最终 overlay `cfd81ec` 的 CI `40619438865` 五项 job 全成功。主控实际
下载 7 个 artifact 元数据及报告，核对后端 365、UI 87、MCP 4、两种首装 12 份 JSON
和 SDK 949 全门；registry raw index、真实推广日志和 SDK report 的 candidate image
均为 `f7d195b6…36ffe1f`。双架构 provenance 对应最终提交/run/BASE，完整性 false 限制
保留。正式 arm64 镜像已实际拉取，未启动的提取容器已删除，正式 executable SHA 为
`fd16fcfa82fe8ebed22cbcb22dcb7be215b9c40d703050920365201194866acd`，10 个 SDK 资源逐字节
等最终 CI 输入包；canonical overlay 已干净 fast-forward 到同一提交。插件现获准只从
正式 registry digest 独立提取并复测；新插件发布及根仓真实生产 UI/组合/最终 CI 仍未通过。
当前无 Docker 或执行权限阻塞，不把下方历史故障继续当成当前状态。

10:11 续核：首次改密修复的本地 classpath、OIDC 35、MCP 四份各 1 项零跳过，以及
form/env 两种首装各 22/7/26/52/215/14 项均已通过，候选 image 中 executable 由主控
实际提取并重算为 `021abcf5…2f72ad`。修复提交 `a21417f` 后又发现宿主黑盒脚本依赖
PostgreSQL 自动匿名卷，owner 查询会漏掉这类卷。已改三脚本为显式 owner/run 命名卷、
拒绝同名已存在卷，并按标签清理；重新完整执行受影响镜像门，前后卷清单相同、未新增
匿名卷。本次修复为 `cfd81ec`，自动 CI `40619438865` 运行中，最终发布必须对应此提交。
4 个此前无 owner 标签的卷未凭时间推断删除，正在只读核对归属；不得把它们冒称已清理。
上述本地门不代表正式宿主推广、插件新输入发布或根仓生产 UI/组合通过。

09:45 续核：执行权限已恢复，主控仅使用正常 Docker 命令确认 `docker ps -a` 成功且
零容器、context 为 desktop-linux、磁盘约 16 GiB。固定 IMAGE_BASE digest 与新
executable `021abcf5…2f72ad` 的候选镜像已实际构建成功；旧只读和会话权限阻塞均不再
作为当前结论。当前正串行补跑 classpath、OIDC、MCP 和两种首装镜像门，尚未通过，
不继承旧产物结果，也未触发 CI。下方 09:22 及 08:39 记录保留其历史语境。

09:22 续核：维护者反馈 Docker 已可执行，主控实测宿主可用空间约 16 GiB。当前会话
执行权限已变为 workspace-write、网络受限、approval never；`docker ps -a` 返回
permission denied，Unix socket 直接连接返回 errno 1 / Operation not permitted。
不能据此声称 Docker 仍是只读，也不能通过 Herdr、其他 pane 或子进程绕过沙箱。
候选补丁结构 15 项及来源回归 10 项重新通过；驱动测试 16/17，唯一失败为
`listen EPERM 127.0.0.1`。原型完整断言及根仓静态检查通过，但不代表组合通过。
当前首先需要恢复本会话的 Docker、本机监听及发布操作所需执行权限，随后继续下列
宿主镜像门；不是要求重新确认已授权的业务范围。实测证据见
`.work/access-control-v3-20261027/resumed/docker-resume-session-permission-20261028.json`。

尚未完成 v3 最终交付。正式 overlay 为 `2906d795`（CI `40576953734`），正式插件为
`9e10e4d`（CI `40600248458`）；两者实际报告和产物均已下载核对。根仓真实新装五表
和 R25 维护流程已通过，但生产首次改密遇到宿主精确协议路由遗漏。修复候选的
365 项后端中 363 项通过、2 项镜像专用未执行，UI 87 项通过；候选镜像导出因 Docker
VM 写 I/O 错误、journal 中止及 containerd 只读而失败，后续镜像门未运行。
空间保真回收不能证明内部存储恢复可写。用户禁止停止共享后台进程，未重启 Docker
或删除其数据，未越过本地门提交/推送该候选或触发 CI。需先恢复 Docker 可写环境，
再按宿主→插件→根仓顺序续验。生产业务 UI、根仓最终组合和最终提交 CI 尚未通过。
精确候选、原失败、恢复的 SDK 缓存和所有正式 jar 保留在 `.work` 与部署目录。

## 2026-10-27：需求 v3 重新调查与实施裁决

本节依据当前工作树、真实 Git 远端、当前 CI 和本次浏览器调查，优先于下方历史状态。
目标入口为 `docs/access-control-ui-requirements.md` 的 v3，R21 替代双分节权限设计。
以下“已核对源码”不等于行为测试、正式发布或组合验收通过。

### 环境、版本与前置检查

- 实际环境为 Darwin、zsh、`/Users/xuybin/kestra-monorepo`。Docker 正常，Compose
  v5.5.1、context 为 desktop-linux；调查开始时没有运行中的容器。
- Herdr 0.9.5 的真实主控为 CLI 返回的 `wW:p1A`。继承 pane 已失效，终端内容匹配
  确认归属后新建后台 `wW:p1B`，实际运行指定 Codex 参数。只读任务、同 agent 后续
  消息及保持焦点复测通过；初次焦点变化来源未确定，原始记录和复测均保留在
  `.work/herdr-probe-20261027/`，不以 idle 或创建成功代替通信证据。
- root HEAD/远端均为 `a6fe358c22a8188427a6c2f41f39e8f23ba76f82`；overlay 为
  `c2390ff22705135ba2773bce23aab27bb4e9472b`；plugin 为
  `40715daee761043783a9dd53f9ec1694f5d53fb3`。两子仓工作树干净。root 已有插件
  指针差异（记录 `16869c1`、实际 `40715da`），不得回退或冒称本次新增改动。
- 当前 overlay CI `39712369397`、plugin CI `40468205769` 成功，仅说明各自旧契约。
  root 当前提交 CI `40467372007` 失败：发布选择器拒绝没有成功 CI 的 gitlink
  `16869c1`；没有运行 Compose。日志已下载到 `.work/access-control-v3-20261027/`。
  修正最终指针不能代替新增需求验收，不盲目重跑旧提交。
- §11 完整原文校验已实际执行，**失败在 hash 断言**。当前原型与 HEAD blob 一致，
  实际 SHA-256 为 `7bb5c48639f78c018971bb7b768625f463a421c8a6251f60330ed8f7829f929a`，
  不等于正文的 `089b9a...5140`。独立诊断为12条 ruling、20处字段提示、计数
  `19/1/19/22/18`。失败与诊断分别保留，不能算冻结门通过。已用 ego-browser 实际
  点击卡片、应用页签及侧栏“＋”：登记表单在详情内容区，不在侧栏、不是第五抽屉。
  裁决为核对已提交原型差异后显式修正文档冻结值及过时19处/内联表单记录，不修改
  原型交互来凑旧 hash；全部断言重跑后才能作为新基线。
- `.env.bak-round-ap` 不读取、不修改、不删除、不提交。已有 `.work` 与正式 jar 保留。

### N/T → 实现、契约与发布门

P0 是授权/事务/凭据风险，P1 是数据升级与协议一致性，P2 是界面行为和样式；均为必需门。
表中的测试路径表示现有入口及必须扩充的位置，不表示已有测试覆盖新目标。
“目标行为与差异证据”保留本轮首次调查的缺口定位；当前进度以下面的状态更新表及最新
阶段证据为准，不将初始旧源码描述继续当作当前能力结论。

| 范围 | 当前已核对进度 | 剩余发布门 |
|---|---|---|
| N4/N5/N19、T5/T6 | 宿主账号生命周期、受限首次改密和借用连接机制已随协议 44 正式发布；最终 CI 的 17 个具名账号/密码/凭据用例已由主控读取下载 XML 核对通过 | 插件真实 V2 适配、审计、最终 PG 与组合事务仍未通过 |
| N11/N19、T7/T8 | 宿主掩码提示、普通轮换及维护 CLI 已正式发布；插件控制器为候选，当前正在消费正式 digest 接线 | 完整生产 UI 一次性明文、CSRF、响应丢失、维护与新旧 secret 协议组合未通过 |
| N10–N14、T3 | 插件统一权限实体及单表 UI 候选已存在；先前单元和 PG 结果只覆盖各自记录的版本，不代表当前源码 | 最终正式输入的编译、独立 CI、发布和真实 typed/external 边界组合未通过 |
| N20、T12 | declaration-upgrade 候选及八个具名真实 PG 用例在先前版本通过；当前新审计表增量须再次纳入升级门 | 当前最终源码、最终正式输入的升级 CI 与根仓核对仍未通过 |
| T10/T11 | overlay `2906d795` 的 CI `40576953734` 五个 job 全成功，SDK 949 报告实际下载核对；正式镜像 `91827c9d…79f0a2e6` 推广及 arm64 拉取成功，正式 executable `67f0d8a6…cb21134` 的全部 10 个 SDK 资源等最终 CI 输入 | 插件已获准只从正式 registry digest 独立提取 SDK 并接线；生产插件 UI 和根仓 Compose 仍未通过 |

2026-10-28 续核：合法空 context 未计数是结构解析器缺口。独立 release 的最小修复及
10 个正反回归、45 补丁结构 15/0 已由主控实际运行通过；两次失败回归保留。原补丁
`b57b59a8` 仅规范精确单空格 context 后为 `0bd5022a`。主控复算重放树、已测构建树
全部 323 个触达文件及 SDK owner 的 13 文件，差异均为零。最终 cached 检查另发现
共享矩阵末尾多余空行；仅独立 release 删除一个 LF，矩阵 SHA 为 `1bac5b40`，不改
当前运行中的旧矩阵。最终 29 文件逐项哈希与 parent `64c4498` 已核对，index 为空。
新 build `6c7873d3` 的完整双浏览器门各 949 项通过，不改写或继承 `f34331c5` 的结果。
主控于 2026-10-28 04:16 后核对实际报告、冻结哈希、29 文件变更集合及父提交，明确
授权独立 release 提交推送，证据为 `.work/access-control-v3-20261027/resumed/` 内
`sdk45-final-main-precommit-review.json`。随后正式提交 `2906d795` 的五项 CI 和镜像推广
通过。主控独立下载并核对 89 XML/364 项（362 通过、2 镜像专用跳过）、四份镜像专项
各 1 项零跳过、UI 87 项、两种首装十份 JSON 及 SDK 949 报告。真实推广日志与 registry
raw index 的 SHA-256 一致，双架构 provenance 的事件提交、run 和上游 BASE 相符；
`buildkit_completeness` 为 false 的限制保留，不把上游 revision 冒充 overlay 提交。
正式 arm64 镜像已实际拉取，主控读取 executable 并复算完整 hash，全部 10 个 SDK
资源逐字节等下载的 CI 输入包。证据为 `sdk45-main-full-downloaded-ci-audit.json`、
`sdk45-main-downloaded-sdk-audit.json`、`sdk45-main-named-lifecycle-checks.json`。
canonical 在完整备份 43 项旧候选后只作 fast-forward，当前 HEAD/远端均为 `2906d795`
且工作树干净，未新增提交，未改 `.work` 或 SDKdev。插件生产 UI、插件最终发布和
根仓 Compose 验收仍未通过，不以宿主 SDK 发布替代这些门。

插件与根仓只读对照又确认三项缺口：subject 创建时 scope 下拉选择器不唯一；插件
自身失权页换号只跳 `/ui/`，未执行公开退出；LOCAL_POLICY.READ+MANAGE 且无
IDENTITY.READ 时缺父修订和受限 scope 输入。归插件修复，不新增宿主业务 API，也
不隐含授予 IDENTITY.READ。root 已补明确 scope 控件定位、双权限账号真实修改保存/
刷新及拒绝目录读取、插件错误页实际退出后换号断言；尚未运行，不能算验收通过。

2026-10-28 插件消费正式 SDK 后，主控又确认两项提交前缺口。实际 Micronaut 路由红测
把合法 key `mutation-metadata` 分派到集合管理方法；原生语言红测显示德语上下文仍为
英语。集合 metadata 已改为 `permissions/-/mutation-metadata`，保留合法 key 的普通
READ 和逐项 metadata，不保旧集合别名。原生 ElConfigProvider 现消费公开 locale 并
随宿主偏好更新。根仓新增真实合法同名权限读写及全部主题/语言/宽度的 Select 无匹配
文案检查，不以新逻辑测试代替浏览器。两处红测、初次测试准备失败和最终复测均保留。
主控已核最终本地 40 套 Java 274、16 套 PG 105、生命周期 2 套 15 项全部零失败/跳过，
亲跑 UI 89 项通过；正式 host/SDK 输入未变。当前本地 jar 为 `17b7f079…68468e8`，不是
正式 CI 产物。精确 135 路径（133 文件、2 个旧 UI 文件删除）提交为 `37c7560`，随后
自包含 `file:// --no-local` 独立克隆实际执行 README 提取与 clean check，通过 274 项
Java 和 89 项 UI 逻辑。主控重算克隆 133 文件、薄 jar、349 项 UI 清单资源及正式宿主
provenance，全等已审结果；无 alternates，node_modules 非链接且由独立 npm ci 安装。
独立 clone 门通过后已授权推送，远端 main 为 `37c7560`，自动 CI `40595114003` 运行中，
没有重复 dispatch。仍须实际下载该提交成功 CI 的正式 jar 和全部阶段报告。

插件 `37c7560` 的 CI `40595114003` 已成功，主控下载 artifact `12775364735` 并核对
三个隐藏阶段 274/105/15 项、升级 8 项、薄 jar、349 项 UI 资源与正式宿主 provenance。
正式 jar `17b7f079…68468e8` 已保留在 `deployment/libs`，旧不同 jar 按 hash 备份。
根仓真实开发轮 `root-compose-round2` 已用这两个正式产物创建唯一 Compose/PG，通过
发布输入、功能关闭首装、显式目录 preview/apply、统一权限初始化及功能开启重启。
**新装存储门失败**：实际存在 `rbac_application_scope_declaration` 旧平行表。根因是
插件 `ApplicationScopeDeclarationMigration` 作为生产 `MigrationScript` bean，仅受
PostgreSQL 条件约束，会在功能关闭首装自动建旧表。此失败归插件，不放宽新装五表
断言，不把 schema2 升级降为可选。插件正在修复生产发现与显式历史升级边界。
失败报告和未执行项保留；根仓该轮 finally 已核 owner 清理全部容器、网络和卷，数量
均为零。真实 UI 尚未运行，不能以宿主 SDK 双矩阵或已发布插件 CI 代替组合验收。

该新装修复仅变更六个插件路径，移除旧迁移类的自动 bean 注解，保留类本体、原
scriptId/checksum 以及显式旧入口。真实 PG 红测已复现旧表创建；修复后新装三项、
原升级八项、Java 277、PG 108、生命周期 15 和 UI 89 项通过。主控读取实际 XML、
检查新 jar 的旧类保留但 bean 索引缺失；根仓新增同样的产物预检，以实际旧 jar 为
拒绝反例、新 jar 为允许正例，不放宽数据库断言。精确六路径提交为 `9e10e4d`，
独立克隆复用前核对 BASE、干净状态、无 alternates 与全部已装依赖哈希，随后精确
fast-forward 并重跑 README 提取和 clean check，新 jar `47cf65f8…5d068f9` 与主树相同。
已授权该提交推送；必须再取得对应成功 CI 和实际下载产物，此处仍未取得新版本根仓
组合通过证据。

插件新装修复已随 `9e10e4d` 的 CI `40600248458` 发布，artifact `12779210882` 由主控
实际下载并核对。根仓 `root-compose-round3b` 已用正式新 jar 从空库重新执行，五表门
通过。R25 维护门首次失败归根仓断言：旧消费者 secret 在 `/oauth/login/kestra` 入口
被宿主以 500 拒绝，具体 host 日志含唯一 traceId 和明确初始化配置错误；旧断言只认
回调拒绝。已按精确请求阶段与唯一来源日志修正分类，不接受任意 500/网络故障。
`root-compose-round4` 从头运行，完整 R25 prepare/cancel/activate/旧配置拒绝/rollback/
confirm/真实登录十步通过，所有失败轮保留，恢复登录及 owner 清理均核对成功。

round4 随后在冻结账号真实准备阶段失败：宿主接受临时密码 POST 并 303 至
`/oidc/password`，但 GET 返回 401。主控定位正式宿主的 `TypedRestRbacFilter` 在
匿名身份检查前调用精确 `RestRbacFilter.protocol` 清单，该清单遗漏
`OidcPasswordChangeController`。公开 Compose 的 `/oidc/**` 匿名规则不能绕过此独立
授权过滤器，故属于 overlay 必要协议激活点缺口，不是插件业务模型或 root 放宽认证。
已授权仅实际控制器、精确路径、GET page/POST submit 的最小补足方向；受限交互、
CSRF/Origin、首次改密前零授权和错误路由失败关闭必须完整保留。宿主独立修复、CI 和
正式发布后，插件才能消费新正式输入。当前 root 仍无最终组合/UI/CI 成功结论。

2026-10-28 08:39（本地时间）宿主候选镜像导出遇到环境阻塞。实际 Docker 构建日志为
containerd `tmpmounts` 的 `read-only file system`。主控读取 Docker VM 系统日志确认
vda 写入 I/O 错误、vda1 journal 中止及 containerd/BuildKit 元数据只读；不是根据
socket 路径猜测故障。恢复空间后，当前 `desktop-linux` context 的 `docker ps -a`
与 `docker desktop status` 分别仍在 15 秒超时，Compose CLI 5.5.1 可正常执行。
正常命令输出和具体日志保留在 `docker-storage-readonly-diagnostics.json`、
`docker-storage-readonly-log-excerpts.txt` 与 `host-password-image-build.log`。
主控另对已停用自有依赖的 4,014 个小文本文件保真压缩，实际减块 355,938,304 字节，
路径、逻辑 SHA、大小、mode、纳秒 mtime 与归属保持；未删除缓存或正式产物。
可用空间回升约 461 MiB，但不能据此宣称 Docker 内部已恢复可写。
用户禁止停止共享后台进程，因此没有重启共享 Docker、Herdr 或 Codex，也未 prune、
删除 Docker 数据或越过本地镜像门触发 CI。宿主协议定点修复仍是未发布候选；必须先
恢复 Docker 可写性，完成新镜像和两种首装的 RBAC 改密门，再依次发布宿主、重验插件
正式输入及根仓真实组合，最后才可取得根仓最终提交 CI。当前不是全部交付成功。

| N/T | 目标行为与初查差异证据 | 归属、公开输入与实施方案 | 必须测试与发布门 | 初查状态 |
|---|---|---|---|---|
| N1–N6 / T1 | 卡片 key 主标题、同快照 counts 链接、组描述和创建抽屉；`ui/src/ApplicationGroupCards.vue` 仍以 displayName 为主且无 counts；`ApplicationGroupDirectory.Group` 无 description | plugin 目录/API/UI；只用正式宿主 UI SDK，组 id 不改名、内置标识与退役约束保留 | 扩充模型/服务/UI测试；真实卡片、统计点击、普通空组删除、内置拒删；plugin→root门 | 已核对源码，目标未验收（P2） |
| N7–N9 / T2 | scope key/name/description 与 key 不可变已存在；`ApplicationGroupChanges.deleteScope` 只检查独立支持集和用户授予，尚无权限激活引用阻塞明细 | plugin；改为按统一权限激活关系/用户授予/残留策略受限删除，READ过滤错误明细 | scope并发加引用/删除、重名、不可变key、MANAGE-only不泄露、拒绝前后DB一致；真实侧栏与双深链 | 部分旧行为存在，新门未验收（P0） |
| N10–N14 / T3 | `ApplicationGroupDirectory.Application` 仍有 approved 与可写 supportedScopeKeys；`ApplicationScopeDeclarationStore.StoredScope` 按 scope 嵌套权限且禁止跨scope重复key；不满足多对多、单一事实源 | plugin 独立权限实体 key/name/scopeKeys、description；支持取全部关系并集；server决定 kestra-policy/external-declaration；主动登记真实标准client、不绕过pending/owner | P1→s1,s2/P2→s2、空关联、最后引用撤权、metadata不撤权、外部“管理员”文本不扩权；真实PG和REST；plugin发布门 | 已核对源码，模型需替换（P0/P1） |
| N14/N19 / T3/T9 | `management/ManagementController` 同时注册 runtime-permissions；declaration控制器另有scope-declarations。UI App.vue 仍有独立 declarations 页签；R21明确替代这些入口 | plugin：当前Kestra grants/managementGrants存入同一权限实体并直接typed投影，不另建实际策略区；保留同scope完整授权，不跨scope拼接 | 新权限CRUD及旧两套写路由不注册；grants变更真实允许/拒绝；IDENTITY与LOCAL_POLICY独立，支持变化双域、只写回执；单/多角色精确namespace；plugin→root门 | 已核对源码，未实现（P0） |
| N15/N16 / T4/T5 | 当前UserGrant可保存空scope；eligibleScopeKeys已求支持∩授予；涉及应用、禁用过滤、ANY/AND深链、分页与同快照枚举仍需重做 | plugin；(issuer,subject)精确身份；用户目录提供候选，subject删除不删账号、禁用保留授予 | 两组两应用、同名scope、超过25行、失效深链、筛选后Total、刷新/返回、组外拒绝；真实UI→DB | 交集源码存在，其余未验收（P1/P2） |
| N4/N5/N19 / T5/T6 | `ManagementController.createUser` 仍接收调用方password；UserDirectoryV1没有公开delete；宿主已有同连接IdentityLifecycleGuardV1与安全锁，但不满足物理删除全组清理和完整首次强改 | overlay先发布通用生命周期机制；plugin借用宿主连接清全组授予并重验当前操作者/最后管理员；宿主不读插件表；临时凭据宿主生成、生产改密页受限会话 | 参与者写后抛错/宿主删失败全回滚；缺失重复参与者拒绝；并发互删/停用；历史执行审计保留；首次改密前拒绝业务/code/token/refresh绕过；overlay→plugin→root门 | 缺口已确认，需最小宿主提案（P0） |
| N11/N19 / T7/T8 | 当前宿主pbkdf2哈希不能还原提示；没有公开credential状态/轮换/维护CLI；插件无credentials入口 | overlay F4：maskedHint与哈希同存、历史无提示明确显示；普通secret原子轮换、强修订；配置登录client只允许维护prepare/activate/cancel/回退/清回退材料。plugin仅调用公开契约 | public拒绝、旧secret失败、新secret成功、并发/CAS/CSRF、一次性no-store与内存清理；维护全链真实登录/回退后单值有效；overlay→plugin→root门 | 未实现，不以“已设置”替代R20（P0） |
| N19 / T9/T12 | 单issuer、签名组claim、client登录audience与MCP资源audience已有机制；不能被UI重构误改。旧metadata更新由DirectoryStore.update无条件推进epoch，会误撤权 | overlay保留精确issuer/签名/audience机制；plugin只在有效支持/授予变化推进epoch、真实grants更新失效缓存；60秒为维护者可调参数，不是技术必然 | 真实签发/验签/错issuer/audience/未知scope整单拒绝、metadata凭据保持、缩减60秒内失效、扩大不升级旧code/token/refresh/UI/MCP | 源码部分存在，目标未验收（P0） |
| N17/N18/N19 / T10/T11 | 现有页面以整页表单与独立声明表维护，未达到四抽屉、侧栏只读详情/显式编辑、失败草稿和焦点行为；KsFilter已从正式设计包导入，可复用但不是交互通过证据 | plugin使用正式SDK、宿主主题/13语言与原生组件；不复制原型壳层、独立偏好按钮或私有宿主翻译；根仓ego/CI共用断言 | 403/409/412/503、保存中禁闭、ESC/焦点返回/丢弃确认；四主题×全部语言、中英计算样式、1280/768/390；宿主实页对照；plugin与root门 | 原型已浏览，生产UI未验收（P2） |
| N20 / T12 | 现有脚本仅new-install/legacy-migration，无独立declaration-upgrade门；旧声明与实际策略分存，需显式映射，不能猜测grants归属或静默丢弃 | plugin离线preview/apply：绑定schema/revision/hash、显式冲突决策、停写安全锁事务、新单一事实源；root同步生产安装计划和验收输入 | 真实PG schema2干净转换/同key冲突/旧独立支持不等价/approved=false/未知引用/映射冲突、回滚/幂等/并发；升级前后等价及旧凭据不扩权；独立必需发布门 | 未实现（P1，不能归入历史排除） |
| 全部 / T12 | 旧project类名/脚本/历史README、旧绑定/恢复/配置状态描述仍有残留；当前业务路由多已改application-groups，不能用历史文档恢复旧机制 | 各仓自足文档按当前目标同步；root保留历史schema1显式legacy-migration，不把脚本文件名等同于仍有旧运行API；正式输入从已发布digest取得 | 独立克隆README流程、薄jar/bean索引/provenance、下载最终报告；new-install REST/MCP/安全/UI/缺插件/关闭功能加declaration-upgrade；最终三仓HEAD/远端/CI | 当前无v3发布与组合通过证据 |

### 实施方案、依赖顺序与裁决边界

1. 先修正已核对的冻结输入冲突，按 N/T 建立完整测试映射；保存失败，不把历史绿色
   CI 计入新目标。模型设计归 plugin 自足文档，通用宿主提案归 overlay 能力文档。
2. P0 宿主前置先行：复用现有安全锁/guard，新增账号删除同连接参与与受限首次改密、
   client公开状态及secret轮换/维护机制；R24/R25保持“维护者可复核设计”来源限定。
   不引入组CRUD/存储；候选明确未发布。主控负责共享manifest/机制/差异表一致性。
3. P0/P1 插件统一权限模型与升级设计可以并行推进，但新增宿主类型的编译与交付必须
   等宿主本地完整门、独立CI及正式镜像发布。外部声明不得进入Kestra资源授权。
4. 插件从正式digest提取类型/SDK，完成服务、API、UI与new-install/declaration-upgrade
   测试、独立克隆和CI发布。保留拒绝/撤权/最后管理员门，不降低旧有效断言。
5. root只选择正式镜像/jar；一个主Compose与一个PG，辅助JVM按真实阶段启动且owner
   label可追踪。真实生产登录、允许写入保存、拒绝无副作用与完整矩阵本地通过后，
   才提交最终组合并取得该提交成功CI及实际下载报告。最终证据不足不得宣称交付。

### 本轮已取得证据与剩余门

- 冻结值已按提交`716f00a`实际原型显式修正，原型文件未修改。重新执行§11完整脚本
  通过；新增CI/静态入口复用的原型检查器通过，改原型字节和正文/脚本hash不一致的
  两个反例均拒绝。原失败保留，不覆盖为通过记录。
- 已输出19条逐key映射（保留scope名称/说明及permission key/name）、22个标准用户和
  1个持久subject的期望。原型impl缺完整typed字段和managementGrants，仅作历史
  参考，实际初始化必须来自明确typed测试策略，不推断管理员权限。
- 实际下载plugin当前CI`40468205769`的artifact`12717382010`，jar SHA-256为
  `5ccb6a569d2450f572cda00ee20f52234af9fab7e90cc9ef18353d4be0b374df`。
  下载报告实际为Java219、PostgreSQL77，失败/错误/跳过均0，两个现有数量检查器通过。
  provenance镜像为正式`sha256:50315684e3826c4fafadac834ed1fc5438c3e2c77c394740634b59a1f6591024`。
  这只确认旧契约基线，不是本轮模型、生命周期或UI通过。
- overlay当前CI的host-scoped-tests已下载：XML合计325项，失败0、错误0、跳过2；
  两项的镜像专项执行证据尚需单独核对，不能把该报告说成零跳过全通过。
- root静态入口通过且明确`completed=false`、167项not_run、未创建容器。新增T1–T12
  与declaration-upgrade均从not_run开始；没有真实执行证据不得从静态通过转换为通过。
- overlay、plugin后端、plugin UI分别由独占修改范围的本次Herdr agent实施；主控保留
  root全部验收文件。当前仅候选修改，无本轮正式提交、发布或Compose通过证据。
- 继续实施时发现正式UI SDK只承诺按钮/输入/表格，明确不支持dialog/popover/复杂
  dropdown；v3四抽屉/居中确认不能因公开npm中有组件就描述为宿主已支持。已按现有
  管理UI能力文档要求调查通用portal/focus/主题/卸载兼容提案，未发布前仍为明确缺口。
  新增一次性凭据截图防泄露门只完成源码/语法检查，实际浏览器反例尚未通过。
- **外部浏览器前置阻塞**：本次唯一ego空间35曾成功用于原型调查，随后
  `taskSpace(35)`返回`task space not found: 35`，`listTaskSpaces()`无同id或同名空间。
  没有创建第二空间绕过，也没有claim用户空间或擅自升级。具体输出保存在
  `.work/access-control-v3-20261027/browser-space-failure.md`。本地真实UI组合及截图门
  未运行，不能用CI另一个矩阵替代；不依赖浏览器的实现和独立检查继续。

### 2026-10-27 候选检查点（未发布，未完成最终交付）

2026-10-28 续行早期检查点：本地日期已核对进入次日。当时第五轮 SDK 矩阵仍在运行；插件正式
协议输入已实际提取并由主控核对 executable SHA-256 与五个公开类型。首次编译通过，
后续单元及生命周期 PG 当时有真实失败，按日志修复，未触发插件 CI 或宣称 PG 通过。
该阶段本地只运行插件 owner 标记的一个 PostgreSQL，没有第二套验收服务。

2026-10-28 01:10 更新：主控已重新运行插件的真实报告检查器，并读取保存的全部 XML。
正式协议 44 输入的本地候选为单元 39 套 272 项、PG 存储与业务 16 套 104 项、正式
宿主适配器生命周期 2 套 15 项，均零失败、错误、跳过；另核八个具名 declaration-upgrade
用例及宿主 image/executable provenance。各阶段不相加冒充唯一用例；这不是最终 SDK
输入、插件 CI、正式 jar 发布或生产登录/UI 通过。插件 PG owner 容器已清理。
SDK 第六轮因无稳定 key 的探针列表复用触发 DOM 失败（8/1/940），主控实际节点引用
证明其不是节点删除；已修探针 key，并强制断开前置及准确 fallback。第七轮同一新
冻结输入的 13 个行为已全部通过，936 个配置检查仍在运行。宿主已获单 PG 窗口并行
执行新版候选本地门；最终完整 949、本地镜像门及精确 diff/hash 未审查通过前不得触发
新版宿主 CI 或发布，不改变宿主→插件→root 的正式交付顺序。

2026-10-28 02:15 更新：旧候选 `69e11808` / probe `02d12978` 的 Ego 与本仓独立
CDP+Log 驱动均已完整 949/949、零失败/未运行/诊断错误，主控亲自核对精确同一用例
集合及结束源哈希。完整 local-ci、UI83 和该候选新镜像门也已核过。但最终公开契约
审查发现打包 contract.json 仍标 overlay 为未发布候选且 README 仍称 dialogs 不支持，
因此主控没有批准提交或推送。当前只修契约元数据、SDK README 与一致性测试，核心
renderer/helper 不变；必须按新最终输入重算补丁、jar、镜像及完整矩阵，不将旧绿色
结果冒充新输入通过。根文档另已改条件式发布规则，`r-oidc-server.md` 同步正式44
状态，待审显式文件集合从26增至27；后续仍按实际新补丁与文件集合重新审查。

2026-10-28 02:30 更新：公开契约修复输入为 SDK `2f2984a`、0384 patch `b57b59a8`，
实际触达13文件（原11加SDK README和一致性单元）；完整UI单元87项，保留原83并新增
4项。正式能力字段为 overlayCompatibility，不保留 candidate 别名；四个原生组件须
经公共适配，未适配 overlay/popover/KsPagination 仍不支持。发布资格以对应提交 CI 与
推广为准。新 probe `f34331c5` 已冻结，主控和宿主按新输入重跑全部门。原 Ego 空间2
实际失效，本轮尚无浏览器检查时即失败；已按维护者授权建立真实空间3，续跑8b完整
949，未把工具恢复当通过或外部阻塞。证据分别保留，不改原型或降低任何断言。

最新续接状态：协议 44 已由独立 release 树提交并推送为
`64c449867b09ec21a5462104783fd2b8c7a4b4c5`。主控实际回读远端 main 一致，CI
`40523539018` 的 headSha 一致，四个 job 全部成功。主控实际读取推广日志和注册表
`:64c4498` 原始 OCI index，二者 digest 一致：
`sha256:bebf7a7c06a6205c151ffd35882c54965918357f4e1c71bc0cd2879c3177a22e`。
主控实际下载该 run 的认证 artifact，10 份报告完整覆盖两种首装；也实际解析已下载的
89 份后端 XML 和 4 份镜像 XML。该正式协议输入已允许插件核对 provenance 后消费，
但不包含新 SDK。canonical overlay HEAD/index 与 SDK 开发树未改。
26 个工作文件和 index blob 的 SHA-256 已由主控逐一核对；44 补丁不含 0384。
实际 XML 为后端 364 项（362 通过、2 项镜像专用跳过），镜像 4 份 XML 各 1 项、
零跳过；UI 单元 8 文件 64 项。独立 44 镜像 OIDC 35 项及两种首装完整门通过。
详见被忽略的 `.work/access-control-v3-20261027/resumed/protocol44-main-review-verdict.md`
及同目录最终 provenance、原始日志和 XML。此处不将该阶段证据计为 SDK 或组合通过。

SDK 完整 949 计划的第三次诊断运行：4 通过、1 失败、944 未运行。原生筛选器
触发 `Unknown extension Teleport target`。SDK owner 已修复通用原生 Tooltip 弹层
归属机制，完整 UI 单元 83 项通过。第四轮最终为 707 通过、1 失败、241 未运行；
主控实际测量确认 system 主题失败发生在原生 0.3 秒过渡中，终态颜色正确。共享测试
已改为等待实际原生 token 目标及连续稳定样式，不关闭动画或降低对比度标准。
第五次原 949 计划实际为 936 通过、1 失败、12 未运行：全部主题/语言/宽度配置已通过，
首个导航行为因测试把原始 `%2F` 编码当规范 URL 失败。主控核对实际 runtime 与公开
契约：宿主沿用 Vue Router 的 parseQuery/stringifyQuery，解码值、重复值、null、空值
均正确，查询中的斜线规范输出为 `/`。不改已正确的宿主实现；共享测试正修为独立
规范预期，并将 13 个行为前置，仍须同一冻结输入完整 949，不合并前轮绿色结果。
Ego 空间 2 继续复用；空间失效时已获授权重新创建。
根仓共享 UI 当前初始计划 268 行；12 个 T 门已严格聚合，但生产运行仍未通过。
新增实际缺口：当前已调查范围未找到可绑定主体的生产审计 writer/reader；测试中的
`test_history.subject` 不计生产审计，`AUDIT_LOG` 枚举和普通执行日志也不能代替。
该缺口归插件管理生命周期与凭据业务审计，不扩建宿主完整审计业务。主控已接收并
收窄方案：仅对正式 `IdentityLifecycleParticipantV1` 已有五种操作，在宿主借用连接
追加 `rbac_management_audit` 提交记录；不扩展无公开钩子的创建/资料更新，也不新增
执行审计。读取沿用 §4.7 的 issuer 范围 IDENTITY.READ，包含同 issuer 已退役组历史，
不新增组级 IDENTITY 权限。此前主控按组隔离的提案已纠正。subject 原值无级联关系，凭据、
哈希和请求内容均不记录。失败与审计写入共同回滚。新安装及 schema2 升级必须包含
该第五业务表与真实 PG 检查；候选实施中，尚未发布。
审计保留门不排除、不计通过；测试不得强加需求未规定的 executionId 关联或伪造记录。
根仓维护验收另修复一处误判：确认后的回滚必须明确收到正式 CLI 的 `CONFLICT`，
网络故障及 `UNAVAILABLE` 不能算拒绝。三项离线控制流回归通过；生产维护门仍未运行。
以下旧检查点中的“未提交”“空间前置”“顶层门未整合”和旧数量仅说明当时状态，
不能覆盖本段最新结果。最终发布、生产 UI、独立插件及最终根 CI 仍必须实际验证。

2026-10-27续接纠正：维护者明确授权旧Ego空间失效时新建空间。已实际创建新空间
`kestra-access-control-20261027-resumed-1915`（本次返回spaceId=1、page=p1），打开实际
原型并取得页面内容。下方旧空间35丢失仅保留为历史工具故障，**不再是当前阻塞**。
后续浏览器操作复用新空间；宿主公开契约、独立发布和真实组合验收门仍须完成。

续接已实测同一新空间中的截图安全门：可见一次性凭据标记位于ShadowRoot时截图被拒绝，
没有输出PNG；移除公开测试标记后普通截图成功。证据在
`.work/access-control-v3-20261027/resumed/adapter-security/report.json`。这仅证明工具安全门，
不证明生产凭据、授权或UI通过。R19最小协议区分和UI SDK通用扩容已分别分配独占修改
范围重新实施；R19方向已接收，新增接口版本和UI兼容细节仍须主控审查及实际测试。

维护者续接补充：UI优先上游原生组件和主题，不另造全部控件或独立配色。已同步根需求
§6及各实施owner。SDK完整浏览器矩阵已发现真实宽度、筛选、窄屏与关闭回焦问题，失败
和未运行项保留，修复后仍须完整执行原949条，不以单元绿色或独立探针代替生产验收。

主控阶段发布裁决：先隔离并完整验证、发布0380–0383的账号/凭据/R19公开协议契约，
不包含尚未通过浏览器门的0384；插件仅在该协议正式CI与镜像推广后取得真实编译输入，
推进事务参与者和真实PG检查。0384仍须独立完成原矩阵及宿主门，再发布正式SDK。
最终插件UI、正式jar与根仓组合必须消费包含已验收SDK的正式版本；该阶段发布不代表
完整目标交付，不删除SDK断言，不将45补丁的镜像测试冒充44补丁测试。

| 所属 | 主控实际核对结果 | 不代表通过的门 |
|---|---|---|
| overlay | 0380账号删除/同连接参与、0381临时密码/受限改密、0382凭据状态/轮换/维护CLI的候选patch已生成；主控结构检查43个patch、PASS=15/FAIL=0 | 完整local-ci、最终镜像HTTP/浏览器、正式CI与镜像发布未运行；定向测试的不同阶段不得相加冒充完整门 |
| plugin后端 | 最新保存XML为Java34套239项、真实PG13套91项，均零失败/错误/跳过；主控亲自运行PG检查器与8个具名declaration-upgrade检查器通过 | F3/F4尚未接入正式新契约；独立克隆、最终新宿主输入CI与发布未通过 |
| plugin整体 | 主控执行clean check，日志显示BUILD SUCCESSFUL、69项前端逻辑与verifyThinJar通过；外层zsh误用只读status变量报错后，以正确变量重新执行check，退出0 | 构建仍消费旧正式宿主SDK；SDK明确未支持的弹层、导航守卫不能因候选编译成功升级为公开能力；真实UI没有通过证据 |
| root | 统一formatVersion=2安装计划保留19条scope及权限key/name、typed测试grants；静态/语法及输入反例通过；新REST/UI用例从not_run初始化，不造通过行 | REST/MCP/安全/UI/维护CLI/缺插件/关闭功能与最终组合CI均未运行；顶层T门尚未整合；静态不等于部署验收 |

候选源码与报告保存在原工作树及各仓被忽略的`.work`。没有本轮正式提交、推送、CI触发或
产物发布；根仓已有插件gitlink差异保留，没有回退用户修改。正式jar及原有缓存保留。
本轮唯一手动PG容器在确认测试退出并核对owner后用`docker rm -f -v`清理，未删除用户数据。

下一步必须先解决并正式发布宿主最小机制：弹层/ShadowRoot/导航query与离开守卫的公开
SDK兼容边界，以及资源Audience可空与登录client audience分离的R19提案。插件的空资源
Audience登记仍被正式V1投影限制，未用默认clientId伪造资源列表。随后才消费正式新digest，
接入F3/F4，执行独立克隆与正式插件CI、完整根仓真实组合并下载最终提交报告。
冻结22用户与初始1个subject的生产准备/浏览器阶段也仍须落实，不能用之后的多页随机
测试数据计数代替。Ego空间恢复或新的明确浏览器上下文授权仍是本地Ego检查的外部前置。

收尾核对：本次创建的5个子agent均已结束任务或中止报告轮，读取其状态/输出后逐个关闭
本次pane；最终CLI只列原主控`wW:p1A`且focused=true，未关闭原pane。owner容器、网络、
卷查询均为空。三仓HEAD、upstream及远端main仍分别为`a6fe358`、`c2390ff`、`40715da`，
所有候选改动保持未提交，三仓diff空白检查通过。没有创建交接文件，未读取用户秘密备份。
根静态最新报告为`completed=false`、224项not_run、无容器，保留于
`.work/access-control-v3-20261027/root-checkpoint-static-report.json`；不作为业务通过报告。

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
