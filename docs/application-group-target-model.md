# 应用组目标模型

状态：当前目标摘要，2026-10-27 同步访问控制需求 v3。本文描述目标，不表示源码、CI
或已发布产物已经实现。完整可实施需求及验收入口为 `docs/access-control-ui-requirements.md`。

## 文档效力

1. 当前维护者明确的新指令与裁决。
2. 本轮 `docs/access-control-ui-requirements.md` 的最新裁决与具体行为。
3. 本文的模型摘要，以及所属独立仓接收需求后的自足设计和公开契约。
4. 当前源码、README、发布产物和报告，说明事实，不能反向改变目标。
5. 历史 project、双分节声明/实际策略及旧恢复文档，仅作调查。

各仓 AGENTS.md 的仓库边界、独立构建和固定发布顺序继续有效。新旧条款冲突必须明确
替代，不提供旧命名/API/迁移流程的兼容转发来掩盖冲突。

## 仓库职责

- plugin：应用组、scope、应用登记、独立权限及多对多关系、用户授予、内置/退役约束、
  管理 UI/API、业务存储、升级，以及当前 Kestra 应用真实资源策略与运行时评估。
- overlay：标准 OIDC 账号/client、注册/consent、签发与校验、共享协议安全锁及通用
  生命周期事务参与者、凭据状态/轮换。只读组协议投影由插件提供；宿主不实现组业务表、
  scope CRUD 或组初始化 CLI，不理解或读写插件业务模型。
- root：Compose、正式镜像/jar选择、CI与真实组合验收；独立仓构建不得读取相邻源码或
  未发布产物。正式宿主发布→插件消费并独立发布→root组合验收。

## 应用组、scope 与应用

“应用项目”统一为“应用组”。组 key 对应既有不可变 id，安装内唯一；第一个内置组由
安装固定标识持久识别，不按列表顺序或当前 client 推断，不可删除或改名。普通组删除
要求无 scope、应用或用户成员引用；同事务登记退役 id，不得复用。

scope 为组内 RBAC 角色标识：key 稳定不可改、name 为必填且同组精确唯一的人类名称、
description 为说明，不含资源动作。key 为 `[a-z][a-z0-9-]{0,63}`。删除为受限删除：
有权限激活关系、用户授予或实际策略引用时拒绝；先显式解除引用，不级联。

应用通过 OIDC 接入，是组普通成员；当前 Kestra client 也不例外。应用 key 对应
client_id，创建后不可改。同一 client 安装内最多属于一组；移出并不删除标准 OAuth
client。插件不维护 approved 业务字段；宿主 active/pending/owner consent 保留，
移除该字段不能绕过标准协议状态。组/应用都有可编辑描述。

## 权限与事实来源（2026-10-27 R21）

应用页签只有一张“应用运行时权限”表和一个维护入口。权限是应用下独立实体，具有
不可变 key、name、scopeKeys，与组 scope 多对多，任一激活条件匹配即有效；不允许
组外引用。表中内容按应用类型解释，服务端决定 implementationKind：

- 当前配置 Kestra client：权限实体保存结构化 grants/managementGrants，运行时直接
  由其生成 typed 授权策略；权限明细展示该策略摘要，编辑使用类型化控件。不再维护
  两套可写声明与实际策略，不设独立“Kestra 实际权限”分节，不解析自由文本执行授权。
- 外部应用：内容为其应用自身权限逻辑的声明说明，可滞后于外部代码；本系统不假设
  外部代码依据该副本执行资源授权，也不因登记外部权限授予本实例资源权限。

此前“所有声明均为非执行文本副本”的表述对外部应用仍成立，对当前 Kestra 的新单表
模型已被 R21 替代。name/description/外部details 不授予动作；Kestra真实grants变更
必须影响实际允许/拒绝。同一scope可以聚合其完整grants，不跨不同scope拼接READ/LIST、
namespace、资源id或管理动作。保留现有 IDENTITY、LOCAL_POLICY、BUSINESS_INSTANCE，
READ/MANAGE 不互含；Kestra权限维护与支持变化的联合权限按需求§4.7/§12.1。

## 支持范围与持久授予

```text
应用支持scope = 本应用全部权限的激活scope集合的并集
用户可获scope上限 = 应用支持scope ∩ 组内持久授予scope
权限对该用户激活 = 权限scopeKeys ∩ 用户本次有效scope ≠ 空
```

不再保存另一份独立可写支持集。一个权限移除引用而另一个仍引用时，不撤销该scope
支持。空关联权限可以保存但不支持任何scope。subject授予是管理员维护的持久关系，
零scope成员保留；删subject只删该组成员授予，不删标准账号。OAuth consent是具体
请求的用户确认，token是有期限结果，三者不能混为“临时授予”。

支持/用户授予缩减后受影响旧access、refresh、UI/MCP会话60秒内失效，未知scope混入
整单拒绝，扩大集合不自动升级旧凭据。metadata-only只推进对象revision不推进组epoch，
不能因纯名称变更误撤权；真实grants变化60秒内使旧允许策略缓存失效。授权事务重验当前
身份、修订、支持交集和最后管理员，失败全部回滚。

## OIDC 与账号生命周期

真正单一issuer、共享discovery/authorization/token等端点；签名并验证应用组claim，
不修改iss编码组，不放宽标准issuer校验。多issuer延期，不新增产品入口。client_id与
ID token登录audience保持对应，access token资源audience维持现状（如MCP资源URL）。
无组级统一Audience，概览不展示；应用详情只读展示其资源Audience列表。

标准用户删除与所有组授予清理必须使用宿主同一事务、插件借用连接参与；不先清理后
删账号，不让宿主理解插件表。自身删除/最后管理员删除拒绝。禁用保留授予并撤销登录。
初始临时密码一次性下发、首次登录强制修改，真实流程属于本轮宿主前置交付。

secret明文仅生成/轮换时一次性下发；头3尾4掩码提示在生成时存储，旧值无法从pbkdf2
还原，缺提示显示“已设置，提示不可用”。public无secret入口。配置登录client走维护
prepare/activate/cancel及失败回退，不在线自锁；具体契约与验证按需求§2.6。

## 页面与交付

顶层应用组卡片与用户表，组详情概览/scope/应用/subject四页签。卡片及徽章分别导航；
scope和应用侧栏切换内容，详情初始只读、显式编辑。权限/组/用户/subject维护使用规定
抽屉、确认和键盘交互，不设默认操作列之外未经需求要求的额外入口，不展示组级scope
配置状态或完整恢复。用户可见术语不使用身份目录、本地权限、本地绑定或本地grants。

默认new-install从空库运行REST/MCP/安全/撤权/refresh/无副作用/UI/缺插件/关闭功能。
本轮schema2权限升级 declaration-upgrade 是独立必需发布门；历史schema1迁移及物理
回滚只在显式legacy-migration，14项历史排除不算通过。新语义不能以旧绿色报告证明。
最终三仓提交CI成功且报告实际下载核对正式输入、矩阵与资源清理，才是本轮交付证据。
