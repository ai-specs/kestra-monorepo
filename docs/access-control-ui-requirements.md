# 访问控制管理 UI 需求文档

状态：**可实施需求基线 v3**（2026-10-27）。维护者已授权主控补齐实施裁决；R13–R20
及本次 R22–R29 均为该授权下的主控裁决，不冒充维护者逐条确认。本文定义目标及交付门，
不声明目标已实现或发布。全新实施 AI 从本文进入，按 §10 执行；无需重新询问本文
已经确定的产品取舍。维护者的新指令和各仓 AGENTS.md 的责任边界继续有效。

---

## 0. 需求来源、原型地位与文档效力

### 0.1 形成方式

1. **起点**：插件仓 `kestra-plugin-rbac` 已实现的"应用项目"管理页（`/ui/main/extensions/rbac/**`）。
2. **维护者裁决**：2026-10-20 至 10-27，维护者对概念模型、信息架构、交互、命名作出
   R1–R12 共 12 项裁决，逐条落地高保真原型并由维护者浏览器验证。
3. **评审修订**：v1 文档经独立评审，暴露"模型变更被归为 UI 重构、前置被排除"的结构性
   缺陷；维护者授权主控代行裁决 R13–R20 补齐形成 v2；独立评审后升级为 v3 基线（含 R21–R29）。

### 0.2 原型地位（重要）

- 原型 `docs/prototype-application-groups.html` 是**交互与视觉基准**：页面结构、导航
  链路、交互形态、布局对齐、双语双主题的呈现以原型为准。
- 原型**不是业务契约**：授权语义、删除规则、数据来源、持久化行为以本文为准。原型与
  本文冲突处，本文胜出；§9.2 列出已知的原型简化偏差清单。
- **原型的演示元素不属于需求**：右上角语言/主题切换按钮、左侧宿主外壳（Workspace/
  Tenant/导航）、左下角"原型"水印、`protoTodo()` toast（示意按钮）、内存态数据（刷新
  即复原）——这些仅为原型自证手段，实施时全部不实现。
- 原型内嵌两类机器可读资产，实施 AI 必须读取：
  - `<script type="application/rulings+json">`：历史裁决集 R1–R12（按本文最新替代条款解释）；
  - 19 处 `data-field-note` 元素属性：字段级实施语义（就地提示）。

### 0.3 文档效力（冲突时以此为准）

| 文档 | 效力 |
|---|---|
| 当前维护者明确的新指令 | 最高优先级；新增裁决须写回所属需求 |
| 本文（v3） | 本轮目标及验收权威，不覆盖 AGENTS.md 仓库边界和发布规则 |
| `docs/prototype-application-groups.html` | 交互/视觉基准 + 裁决/语义载体（冲突处本文胜） |
| `docs/application-group-target-model.md` | 概念模型摘要；历史条款按日期及本文替代裁决解释 |
| `kestra-plugin-rbac/docs/application-*.md`、`implementation-gap-report.md` | 现状调查输入，不是需求 |

---

## 1. 范围与交付归属（裁决 R14）

本轮交付**完整功能**（含必要的后端与契约变更），不做"UI 先行、后端另行"的半交付。
每个功能块有唯一交付归属与前置门，按发布顺序执行：

| # | 功能块 | 归属 | 前置门 |
|---|---|---|---|
| F1 | 抽屉、侧栏、导航、筛选、分页、卡片、双语、主题 | 插件 UI | 所选正式宿主的公开 UI SDK；原型不替代 SDK |
| F2 | 权限多对多模型、支持范围推导及协议只读投影 | 插件模型 + API + 存储 | §4.6 新版升级门；schema 变更允许；初始化与撤权一并更新 |
| F3 | 用户删除 / 禁用 | **宿主能力 + 插件清理** | overlay 公开用户生命周期能力（契约立项），插件消费 |
| F4 | client secret 重置与状态显示 | **宿主能力 + 插件入口** | overlay 标准 client 管理（重置+一次性下发契约），插件消费 |
| F5 | 组创建 / 组描述 / 应用描述 | 插件模型 + API + 存储 | schema 变更允许 |
| F6 | 正式产物组合验收（CI 全绿 + Compose + 报告） | 根仓 | 上述全部 |

**发布顺序**（AGENTS.md 固定顺序）：overlay 宿主契约（F3/F4 前置）发布镜像 → 插件独立
编译 CI → 根仓组合验收。任何 UI 不得以未发布宿主候选产物为编译输入。

F3 同时覆盖新用户临时凭据一次性下发及首次强制修改。修改完成前只能进入受限的
密码修改/退出流程，不签发带业务授权的正常会话；不能仅保存 password_change_required
标志却不提供可达的生产修改页面。创建失败或返回中断不得产生带默认密码的可登录账号。

**明确延期**（本轮不做，UI 无对应入口）：多 issuer；持久化 OAuth consent 管理（§2.4
区分）；跨组权限激活及跨组资源授权的新机制。不新增管理授权域。现有 IDENTITY 的
issuer 范围管理、LOCAL_POLICY 精确目标组授权及全安装用户删除仍按 §4.7 保留，
不得把“跨组延期”解释成删除这些已交付能力。

---

## 2. 概念模型

### 2.1 实体定义

| 概念 | 定义 |
|---|---|
| 应用组 | 应用、scope、用户授予的组织范围。字段：组 key（固定唯一、创建后不可改）、显示名称、描述（新增字段）。第一个内置组不可删除（安装时固定标识识别） |
| scope | 组内角色标识。字段：key（组内唯一、不可改）、name（角色名称，必填）、description。不含资源动作定义 |
| 应用 | 接入应用组的 client。字段：应用 key（≡ client_id，R1）、描述（新增字段）。接入/删除生命周期见 §4 |
| 权限 | 应用下独立实体（R15/R21）：不可变 key、name、scopeKeys，内容按应用类型为 Kestra 结构化 grants 或外部应用说明。多对多关联，各激活对 ANY 生效 |
| 用户 | 顶层用户目录中的账号（宿主域）。组内不创建用户 |
| subject 授予 | 组内用户 ↔ scope 的持久绑定，由管理员维护（见 2.4 三层分离） |

### 2.2 数据事实来源与单一权限表（R21，替代 R16 的双分节方案）

2026-10-27 最新目标模型裁决：应用页签只有一张“应用运行时权限”表和一个权限维护
入口，不再并列“声明副本”与“Kestra 实际权限”两个编辑区。原型及本文件较早的 R5、
R15、R16 中“所有权限明细均为不执行的文本副本”在当前 Kestra 应用上下文被替代。

| 数据 | 维护者/来源 | 用途 |
|---|---|---|
| 组 scope | 插件 scope 管理 | 角色标识，key/name/description，不含动作权限 |
| 应用权限实体及 scope 关系 | 插件应用权限表 | 计算应用支持 scope，并为 consent 提供可读说明 |
| 当前 Kestra 应用权限的结构化 grants | 同一权限实体、同一表和编辑入口 | 插件运行时资源授权唯一策略来源，不能另存一份可写声明/执行副本 |
| 外部应用权限内容 | 应用登记的说明或结构化声明 | 表示外部应用自身逻辑，不声称本插件实际执行外部代码授权 |
| 支持范围 | 从本应用全部权限的 scope 关系取并集 | 与用户授予求交，约束签发；无独立可写支持集 |
| subject 授予 | 插件持久关系 | 决定用户持有的组 scope |
| 账号/client 有效性、签名、协议 scope、consent | 宿主标准协议服务 | 身份有效性及协议签发，不能由管理表绕过 |

当前 Kestra client 仍由正式配置精确标识，不根据名称、列表顺序或管理员输入推断。
其权限编辑必须使用现有类型化资源/namespace/action/id/managementGrants 控件与校验；
表格“权限明细”是同一结构化 grants 的只读摘要，不是自由文本执行语言。修改 grants
必须改变实际策略；修改 name/描述不能扩大资源范围。外部应用的 details 是纯文本说明，
不可通过填写 Kestra grants 获得本实例资源权限。接口返回显式 implementationKind：
`kestra-policy` 或 `external-declaration`，由服务端决定，不接受调用方切换类型。

保持同 scope 完整授权：运行时可把同 scope 激活的当前 Kestra 权限实体投影为该 scope
的 grants，沿用现有同 scope 组合规则；不同 scope 不拼接所需 READ/LIST 或资源边界。
声明展示与运行评估均由同一当前事务快照生成，禁止 UI 更新后运行时仍读取旧策略表。

### 2.3 支持范围推导规则（R17）

```text
应用可授权的 scope 范围 = ∪(各权限的激活条件 scope 集合)
用户在该应用可获得的 scope 上限 = 上述范围 ∩ 组授予该用户的 scope
激活语义：权限的任一激活条件（组key, scopekey）匹配即激活该权限（ANY）
激活条件不得引用本组之外的 scope（API 校验拒绝）
```

- 应用可以支持没有权限明细文本的 scope（明细可空）；
- 只有本应用**全部权限**均不再引用某 scope，它才退出支持集。一个权限移除引用，
  另一权限仍引用时支持集不变。权限可以暂时没有激活 scope：仍可查看和编辑，不支持
  任何 scope，不在 consent 的有效 scope 明细中展示；
- 支持或用户授予缩减后，受影响旧 access token、refresh、UI/MCP 会话在提交后
  **60 秒内**失效（主控代定的当前基线，**维护者可调参数**；不是既有已冻结时限）。
  调整时须同步本文、所属仓契约及验收等待上限，不改变以下撤权规则。
  未知或不再支持的 scope 混入时整单拒绝。组 epoch 可保守失效该组
  全部凭据，不得失效无关组。扩大集合不自动升级旧 code/token；
- 修改权限 name/外部明细、组显示名/描述、应用描述不推进撤权 epoch；对象 revision 仍
  推进。仅改关联但支持集不变也不推进 epoch。凭据按当前 epoch、支持与授予校验，
  不得因纯元数据 revision 变化误拒绝，也不得复用过期授权快照；
- subject 的"涉及应用"= 存在权限其激活 scope ∩ 该 subject 授予 ≠ ∅，且应用为组内
  有效成员、该用户未被禁用；
- subject 筛选公式（应用页签深链）：

```text
匹配权限 = { pm | pm.激活scope集合 ∩ subject.授予scope集合 ≠ ∅ }
```

### 2.4 subject 三层分离（R18）

| 层 | 定义 | 持久性 |
|---|---|---|
| 组内 scope 授予 | 管理员在 subject 页签维护的用户↔scope 绑定 | **持久**（管理数据） |
| OAuth consent | 用户在登录授权时对具体应用的本次确认 | 运行时行为（非管理页维护） |
| token | 签发结果，受当前支持范围、用户授予与撤权约束 | 有期限 |

补充规则：零 scope 的 subject **保留在组内**（授予可为空）；删除 subject = **撤销该组内
全部授予**，不删除用户账号（账号删除见 §4.4）；禁用用户 = 账号不可登录，**授予保留**
供重新启用；不存在"已批准"字段（R3）。

### 2.5 audience 与应用 key 的范围限定（R19）

- **约定仅限登录/身份侧**：应用 key ≡ client_id；**ID token / 登录流程的 client
  audience** 使用该值；
- **access token 的资源 audience 维持现状**（如 MCP 链路使用资源 URL）——本需求**不
  改变任何 access token audience 语义**。不存在组级统一 Audience，概览移除该字段；
  应用详情只读展示本应用登记的资源 Audience 列表，不聚合成组级配置。Issuer 显示
  安装的单一共享值；
- 若将来统一 audience，属协议需求另行立项，不得由 UI 实施顺手修改。

### 2.6 client secret 呈现规则（R20）

宿主以 pbkdf2 哈希存储，**旧值不可还原**：

| 状态 | 显示 |
|---|---|
| 已设置（首次/历史） | **头尾字符掩码**（头 3 + `••••••••` + 尾 4，用于区分不同 secret）——维护者最终裁决 2026-10-27 |
| 重置后 | 一次性弹窗显示新明文 + 拷贝按钮 + "仅此一次显示"警示；关闭后回到掩码态（新值掩码） |
| public client（无 secret） | `无 secret`（不显示重置入口） |

实施要求：掩码显示要求在**重置/下发时一并存储脱敏提示**（头 3 + 尾 4 明文片段，与哈希同存——属于宿主公开契约 F4；存量历史值缺提示时显示“已设置，提示不可用”，不得编造头尾）。重置/一次性下发是**宿主公开契约**（F4），插件不得直读宿主表；响应丢失不补
发（重新生成新版本）；重置要求 §4.7 管理权限、CSRF、强修订和审计脱敏。
普通 confidential client 原子轮换后立即废止旧 secret；已签发用户 token 不因轮换
延长有效期，也不另行缩短，仍按标准撤权检查。
当前配置登录 client 不允许从正在使用它的在线会话直接重置：UI 显示“部署维护轮换”
及原因。本轮须交付宿主通用维护 CLI：prepare 一次性生成待激活 secret，activate 校验
预期版本后替换有效哈希，cancel 丢弃待激活版本。prepare 不影响旧登录。部署方在维护
窗口停止宿主 JVM、同步消费端配置，activate 后更新 Compose 并启动 JVM，通过真实
登录验证；失败使用专用回退操作和保留的旧配置恢复匹配版本。旧哈希仅供受限维护回退，
不经 HTTP 返回；验证成功清除回退材料，不长期接受两个有效 secret。此流程属于 F4
交付门，不得只写“用户自行同步”而跳过验收。
secret 不进入 URL、日志、截图、浏览器存储或报告；一次性响应 no-store，弹窗关闭或
页面卸载清空内存。拷贝失败可在弹窗未关闭时重试，关闭后不得再次 GET 明文。

---

## 3. 信息架构与交互（基准：原型）

> 本节描述**结构与交互**；`data-test` 稳定标识清单见 §7。专有名称恒英文规则（R4）、
> key 主体原则（R9）、图标/删除/筛选/链接全局规范（R10–R11）沿用裁决，不重述。

### 3.1 顶层：应用组 / 用户

**应用组 tab**：卡片列表（组 key 标题 + 显示名副行 + 数量徽章 N scope/N 应用/N subject
——**点击直达对应页签**；内置组右上角"◆ 内置"角标）；工具栏 ⟳ + 创建（右侧抽屉：
组 key/显示名必填、描述可空，key 唯一校验）。

**用户 tab**：表（subject/姓名/邮箱/状态/操作）+ 分页；行操作 ✎ 修改（抽屉、用户名
锁定）、SVG 垃圾桶删除（确认弹窗，联动清理其组内授予——§4.4）、🚫/✔ 禁用/启用；工具栏
KsFilter 式筛选（字段 subject、值=用户目录枚举）+ ⟳ + 创建用户（⟳ 右侧，抽屉：用户名/
姓名/邮箱）。宿主生成随机临时密码，一次性展示及复制，不使用公共默认密码；首次
登录必须完成修改后才建立正常业务会话（F3 需交付完整强制修改流程）。姓名/邮箱可空，
不改变 subject；响应丢失通过新的密码重置处理，不找回旧值。

### 3.2 组详情（tabs 与内容对齐；← 返回在概览左侧）

**概览**：单一内容区（边框+上边距）：基本信息（显示名称/组 ID/内置标识/Issuer 锁定
共享；无组级 Audience）+ 统计行（scope/应用/subject 数量为链接跳页签）；显式编辑 + 丢弃确认。

**scope**：侧栏（key 条目、选中高亮、悬停/选中浮现删除图标）+ 详情区（key 只读、
name/desc 编辑、**绑定的应用**（应用维度行 + 权限 key tag 深链）、**scope 授予**
（subject tag 深链 subject 页签并筛选））。

**scope 删除（R13，受限删除）**：点击 🗑 → 居中确认弹窗：
- 若无任何引用（无权限激活条件引用、无 subject 授予引用）→ 确认后删除（持久化）；
- 若有引用 → 弹窗**列出阻塞引用清单**（哪些权限激活条件、哪些 subject 授予）并拒绝
  删除，提示先解除引用；
- **不做级联清理**（原型演示的级联行为废除，§9.2 #1）。

**应用**：侧栏（应用 key 条目 + 标题行"＋"登记入口 + 悬停删除 → 确认弹窗，删除语义见 §4.2）+ 详情区：
应用 key（只读）/应用描述/资源 Audience（只读）/client secret（§2.6）/支持的 scope（只读推导 tag 组，自动
换行，tag 点击跳 scope 页签）；**应用运行时权限**表（权限 key/权限名称/激活条件
`组key: scopekey` 具体值多对多多行/权限明细一行摘要+N 展开（展开后提示消失）/操作 ✎
SVG 删除）；表格明示当前内容为 Kestra 执行策略或外部应用声明；分页 + 筛选；添加权限（⟳ 右侧）与编辑共用右侧抽屉（编辑锁定权限 key），
KV 行式表单：权限 key/权限名称/激活条件（**下拉+已选 tag 可移除，任何时候列出全部
key**）/权限明细（Kestra 为结构化 grants 编辑，外部应用为文本域）；当前 Kestra 的实际 grants 在同一权限抽屉内编辑，不另设分节或第二编辑入口（R21）。

**subject**：表（subject/已授予 scope（tag 跳 scope）/涉及应用 key（tag → 应用页签 +
`scope ∈ k1 · k2 · k3` 筛选 chip，按 §2.3 公式）/操作）+ 分页 + 筛选；添加 subject
（⟳ 右侧，用户下拉=用户目录排除已添加 + scope 多选下拉+tag）与编辑共用抽屉。

### 3.3 全局规范摘要

右侧维护抽屉（760px/遮罩关闭/⤢ 最大化/关闭复位；创建与编辑双模式、标识锁定；补充：
**Escape 关闭、焦点圈定、关闭后焦点返回触发元素、遮罩关闭触发未保存确认、保存中禁用
关闭**）；删除一律居中确认（红主按钮）；筛选统一 KsFilter（**实施用上游原生组件**，
值枚举下拉、chips AND、清除所有按需显隐、⟳ 最右）；链接无下划线（悬停仅光标/边框）；
占位符不进入下拉选项；空态提示。

---

## 4. 生命周期、状态与权限

### 4.1 应用接入（R14 补全）

新建应用 = **登记已有 OAuth client**（输入已注册的 client_id），或由宿主动态注册后
登记（宿主域）；redirect URI/client 类型/认证方式/owner 由宿主 client 管理配置，**不在
本 UI**。登记时校验 client 存在且有效（协议校验，同安装计划校验）。

### 4.2 应用删除

= 移出本组 + 删除其全部声明与激活关系，在同一插件事务完成；不删除宿主 OAuth
client，不撤销用户组级授予，当前 Kestra 应用移出会使其权限实体整体撤销；在同一事务校验管理员可达性，不能
通过“声明清空但真实策略仍存活”保持授权。若管理员因此不可达，全部拒绝。
同 client_id 可重新登记，但声明及支持集为空。移出、重入均推进组 epoch，旧凭据不得
因重入恢复。一个 client 同安装最多属于一个组，跨组登记先显式移出原组，不隐式搬迁。

### 4.3 权限删除 / 应用删除的撤权

按 §2.3 计算支持集差异，仅最后引用消失才退出支持；受影响凭据在 60 秒内失效。
授权相关写入在同一安全锁内重验当前身份、修订和最后管理员，失败全部回滚，不先提交
再补偿。metadata-only 写入只推进对象 revision。Kestra grants 变更推进真实策略版本，运行时
在 60 秒内采用新策略；若支持集同时变更，再推进组 epoch。

### 4.4 用户删除 / 禁用

- **删除用户**：删除标准账号，同时清理所有组的授予和标准认证凭据、code、token、
  session；历史执行及审计保留 subject 原值，不级联删除。必须在**宿主拥有的同一
  数据库事务**内调用插件生命周期参与者，由插件在借用连接上重验操作者、最后管理员
  并清理组授予，宿主随后删除账号；任何异常全部回滚。插件不读宿主私有表，宿主不
  理解或实现插件业务表。不得先清理 API 再删除 API。组功能开启时，参与者缺失、
  重复、异常均失败关闭。删除当前请求主体和最后有效管理员始终拒绝；
- **禁用**：账号不可登录；组内授予保留；"涉及应用"计算排除被禁用用户（§2.3）。

### 4.5 并发与失败状态

- 所有删除/写入为**成功后更新**（非乐观更新）：请求成功才移除行/关闭弹窗；失败保留
  状态并显示错误；
- 状态矩阵（每列表/弹窗适用）：加载中（骨架/spinner）、空态（—/提示）、403（拒绝页
  入口）、409/412 冲突（提示"已被他人修改/引用已变化，请刷新"）、503（重试提示）、
  删除中（按钮禁用）；
- 冲突后必须重新拉取数据，不得用本地缓存覆盖。

### 4.6 权限多对多数据迁移（R15）

旧模型：scope 声明内嵌 `permissions[]` 数组，且存储检查禁止同一权限 key 跨 scope。
迁移：将嵌套 permissions **展平**为应用下权限实体（应用内权限 key 唯一），并为每条
建立与原 scope 的关系；迁移后约束：权限 key 应用内唯一（跨 scope 允许同一权限多处
激活）；同 key 不同 name/明细、未知引用、旧 approved=false、旧独立支持集无法由
声明关系完整重现时失败并输出逐项冲突报告，不静默合并、丢弃或扩大支持。干净转换
原样保留 name，旧声明缺明细则设空；将原有实际策略无损转换到当前 Kestra 的权限实体，不把摘要文本当可执行策略。
多个旧 grants 无法唯一映射到权限 key 时，preview 给出显式逐项映射计划再审批；
不得随意按名称猜测、丢弃 grants 或将外部声明混入本实例策略。
本轮 schema2 升级设置独立 **declaration-upgrade** 必需发布门，不能塞进显式
legacy-migration 的 schema1 历史门而不运行。new-install 默认空库初始化；插件 CI
额外在真实 PostgreSQL 验证本轮升级、冲突拒绝、失败回滚和重复执行。
升级停写，preview 绑定源 schema/修订/hash 与完整计划，apply 在安全锁事务内复核。
冲突以显式逐项映射/删除决策文件解决，再审查完整 hash，无需维护者在线逐项裁决。
旧表不得继续作为另一运行事实来源，不保留旧 API 转发。支持集、用户授予、真实资源允许/拒绝范围
转换前后必须等价；重新登录验证后结束维护窗口，旧凭据不得因升级获得新 scope。
初始化 CLI、示例、root 安装计划及测试配置同步切换新形状。

### 4.7 权限矩阵（验收覆盖）

| 操作 | 需要的机器权限 | 只有 MANAGE 时 |
|---|---|---|
| 组、scope、外部声明、subject 读取、统计和筛选枚举 | IDENTITY.READ | 不返回列表、详情、计数或名称 |
| 组、scope、外部声明、subject 写入 | IDENTITY.MANAGE | 可提交已知目标及修订；只返回精确回执，不携带对象副本 |
| 标准用户读取与枚举 | IDENTITY.READ | 不返回用户列表或选择器数据 |
| 用户创建、修改、禁用、删除；普通 secret 重置 | IDENTITY.MANAGE | 可提交已知输入；新建临时密码/secret 仅本次响应例外一次性返回 |
| 当前 Kestra 权限表/grants 读取 | LOCAL_POLICY.READ（精确目标组） | 不返回策略，不要求 IDENTITY.READ |
| 当前 Kestra 权限/grants 写入 | LOCAL_POLICY.MANAGE；若支持集变化还需 IDENTITY.MANAGE | 可写已知输入和修订，只返回回执 |
| 正常业务操作 | 现有资源 grants、协议能力和有效身份 | 管理域不替代业务授权 |

READ/MANAGE 不互含。沿用 IDENTITY、LOCAL_POLICY、BUSINESS_INSTANCE，不凭“声明管理权/
用户管理权/client 管理权”文案发明新域或超级权限。IDENTITY 保持当前 issuer 范围，
同 issuer 获准管理员可管理组目录与全局用户，跨 issuer 拒绝；LOCAL_POLICY 不扩大精确
目标范围。不含 IDENTITY.READ 的实际策略入口由 capability/明确深链进入安全外壳，
不得先加载组目录或账号列表。无相关权限者进入可退出换号的拒绝页。MANAGE-only 无
READ 时不展示依赖枚举的编辑抽屉，但公开写 API 仍独立验收，不能给 MANAGE 偷加 READ。
聚合、下拉、深链读取按目标权限检查；所有拒绝写入验证数据库、队列、存储无副作用。

---

## 5. 验收标准（三层全过才通过）

### 5.1 结构与数据一致性

1. 页面/页签/区块与 §3 逐项一致（以 §7 需求编号清单为核对表）；
2. 在 §5.4 冻结数据下，表格行数、列内容、侧栏条目、下拉枚举、统计数字与预期完全一致
   （预期值见冻结数据附表）；
3. R1–R29 逐条对照通过；原型字段提示按 §9.2 解释后满足；§9.2 偏差清单逐条
   以本文为准。

### 5.2 交互与联动（真实浏览器执行、留证）

1. **导航闭环 6 条链路**逐条实际点击（§3.2 各深链，含筛选注入正确性——按 §2.3 公式
   核对结果行）；
2. **维护流逐项核对持久结果**（刷新后仍在）：组创建（校验）、scope 创建/编辑（key
   锁定）/受限删除（有引用拒删并列出引用；无引用可删）、权限添加/编辑（key 锁定）/
   删除（支持范围联动）、subject 添加（目录下拉同源）/编辑/删除（授予清空账号保留）、
   用户创建/修改/禁用/删除（授予联动清理）、secret 重置（一次性弹窗+拷贝+掩码态——有脱敏提示显示头尾掩码，存量无提示显示"已设置，提示不可用"，R20）；
3. **筛选体系**三处 + 分页联动 + 页码重置 + 深链 chip 共存；
4. **弹层规范**（含 Escape/焦点/未保存确认/保存中禁闭）；
5. **权限矩阵**（§4.7 全行）与**状态矩阵**（§4.5：人为制造 403/409/503 验证行为）；
6. **安全回归**（保留现有 CI 安全矩阵）：拒绝操作核对数据库/存储无副作用；撤权在
   时限内生效；范围外/未定义 scope 整体拒绝。

### 5.3 呈现质量

1. 明暗双主题无硬编码色，文字对比度 ≥ 4.5:1；
2. **中英为重点视觉验收，不收缩产品语言范围**：实施必须**消费宿主现有 i18n 机制与
   全部已支持语言与公开翻译机制，不复制宿主私有语言源码**（原型 data-zh/data-en 仅为原型机制；上游已有 dark-2、跟随
   系统等主题机制全部保留）；专有名称恒英文在全部语言生效；
3. 控件几何：32px 齐高、同行对齐、操作右对齐自适应、tabs 与内容对齐、概览带上边距；
4. 窄屏 ≤1280 / ≤768：换行不破损、表格横滚、抽屉自适应；
5. 原生组件与原型像素冲突时，**以上游组件规范为准**（原型仅示意形态）。

### 5.4 冻结数据与通过判定

- 冻结输入按 §11 的实际文件 hash、提取命令与映射核对，不声称等于当前随机生成的
  安装计划。现有测试配置可按新模型更新，须记录新旧覆盖对应，不删安全断言、伪造
  预期或降低数量门来获得通过；
- 通过判定：5.1 对照表 + 5.2 浏览器证据（截图/录制）+ 5.3 双主题×双语矩阵 → 最终以
  最终提交的**插件 CI 全绿 + 根仓 Compose 组合验收报告（实际下载核对 digest/jar
  SHA-256/矩阵数量/零失败零跳过）**收口；任一层不满足不得宣称通过。

---

## 6. 实施约束

1. 组件：筛选用上游 KsFilter；图标/抽屉/表格对齐宿主设计体系；原生组件优先；
2. 宿主 KsButton `primary+link` 白字缺陷：插件 CSS 兜底，上游修复后移除
   （`implementation-gap-report.md` 已记录）；
3. API/存储变更按 F2/F5 归属在插件仓实施；F3/F4 前置契约在 overlay 立项发布，顺序见
   §1；`approved` 从插件业务输入/输出/安装计划移除，不默认 true 暗中保留；宿主
   active/pending/owner consent 是标准协议状态，必须保留，不绕过标准所有者确认；
4. 实施顺序及启动动作见 §10。可先设计插件模型/UI，但依赖新增宿主类型的编译、
   打包和交付必须等待正式发布，不从相邻源码补齐候选类型。

---

## 7. 需求编号清单（与 §12 用例对应）

> 公开行为、验收用例和最低 DOM 标识已在 §12 确定。实施时补所属仓测试文件和实际
> 报告，不再自行裁决缺失的产品规则。

| ID | 内容 | 依据 | 原型位置 |
|---|---|---|---|
| N1 | 顶层双 tab + 卡片/用户表 | §3.1 | 视图1/2 |
| N2 | 卡片数量徽章跳转 | §3.1 | 卡片 meta |
| N3 | 组创建抽屉 | §3.1 | group-drawer |
| N4 | 用户表 + 分页 + 行操作 | §3.1/§4.4 | users-table |
| N5 | 用户筛选/创建/修改/禁用/删除 | §3.1/§4.4 | users-* |
| N6 | 概览单一内容区 + 统计链接 | §3.2 | t-overview |
| N7 | scope 侧栏 + 详情 + 受限删除 | §3.2/§2.2 | t-scopes |
| N8 | scope 新建/编辑 | §3.2 | scope 表单 |
| N9 | 绑定的应用 / scope 授予 双深链 | §3.2 | scope 详情两区块 |
| N10 | 应用侧栏 + 删除语义 | §3.2/§4.2 | t-apps |
| N11 | 应用详情字段（key/描述/secret/支持tag） | §2.1/§2.6 | app-detail |
| N12 | 运行时权限表 + 分页 + 筛选 | §3.2 | perm-groups |
| N13 | 添加/编辑权限抽屉（激活条件下拉+tag） | §3.2 | app-dialog |
| N14 | 单一权限表承载当前 Kestra 实际策略，不设双分节 | §2.2/R21 | 应用权限表 |
| N15 | subject 表 + 涉及应用深链筛选 | §2.3 | t-grants |
| N16 | subject 添加/编辑抽屉（目录下拉） | §3.2 | subject-drawer |
| N17 | 抽屉全局规范（最大化/焦点/ESC） | §3.3 | 4 个抽屉 |
| N18 | 删除确认弹窗全局 | §3.3 | 各确认弹窗 |
| N19 | 权限矩阵 + 状态矩阵 | §4.5/§4.7 | — |
| N20 | 多对多迁移 | §4.6 | — |

数据提取按 §11 完整命令执行；公开行为及稳定 DOM 标识见 §12。实施 agent 只需
将已确定的规则映射到所属仓代码、API 文档和具体测试文件，不再自行选择产品语义。

---

## 8. 裁决总表

| ID | 裁决 | 来源 |
|---|---|---|
| R1–R12 | 见原型内嵌裁决集（key≡client_id、无批准语义、命名规则、多对多、推导视图、侧栏布局、key 主体、明细压缩、交互细节、subject 页签） | 维护者 2026-10-20/22 |
| R13 | scope 删除为**受限删除**：有引用拒删并列出阻塞引用；不级联 | 主控代行（维护者授权，2026-10-27）；修正原型演示偏差 |
| R14 | 本轮交付完整功能（F1–F6），允许必要后端/schema/宿主契约变更，按发布顺序 | 主控代行 |
| R15 | 权限为应用下独立实体（应用内 key 唯一），与 scope 多对多；旧嵌套数据展平迁移 | 主控代行（采纳评审 #8） |
| R16 | 保留真实资源策略管理的目标有效；双分节形态已被 R21 替代 | 历史主控裁决 |
| R17 | 支持范围推导公式与 ANY 激活、撤权时限、组外引用拒绝、涉及应用条件 | 主控代行（采纳评审 #5） |
| R18 | subject 三层分离；零 scope 保留；删 subject=撤销授予不删账号；禁用保留授予 | 主控代行（采纳评审 #3） |
| R19 | 应用 key≡client_id 约定仅限登录/ID 侧；access token 资源 audience 维持现状 | 主控代行（采纳评审 #6） |
| R20 | secret **头尾掩码显示**（维护者最终裁决 2026-10-27，推翻此前"已设置"态；实施需在重置时存储脱敏提示）；明文仅重置时一次性下发；public client 无重置入口 | 维护者最终裁决 |
| R21 | 当前 Kestra 应用权限表承载实际结构化 grants，单一维护入口；外部应用仍为自身声明，不执行外部代码 | **维护者最终裁决 2026-10-27**（亲自纠正主控代行 R16 的双分节错误；不可再翻案） |
| R22 | READ/MANAGE 不互含，现有域及范围保留，不新增隐式管理域 | 本次主控裁决，§4.7 |
| R23 | 支持集取全部权限并集；只在有效集变化时撤权，60秒界限，纯元数据不误撤权 | 本次主控裁决，§2.3；60秒为维护者可调参数，并非既有冻结要求 |
| R24 | 用户删除与插件全组授予清理同连接事务原子完成 | 本次主控裁决，§4.4；维护者可复核设计，不是唯一可能架构 |
| R25 | 普通secret原子轮换；配置登录client走部署维护准备/激活/回退，禁止在线自锁 | 本次主控裁决，§2.6；维护者可复核设计，维护CLI形态属于产品选择 |
| R26 | 本轮schema2升级设置独立必需 declaration-upgrade 门 | 本次主控裁决，§4.6 |
| R27 | 组key沿用id、不重命名安装组；无组级Audience；账号创建有一次性临时密码及首次强制修改 | 本次主控裁决，§12 |
| R28 | 先调查与所属仓设计，再正式宿主→插件→root发布验收 | 本次主控裁决，§10 |
| R29 | 冻结原型事实，完整数据提取，明确深链/筛选/分页/CAS与DOM标识 | 本次主控裁决，§11–12 |

---

## 9. 附录

### 9.1 参考入口

原型（裁决集+20 处属性）/ `docs/application-group-target-model.md` /
`implementation-gap-report.md` / `scripts/application-project-fixture.mjs` /
宿主 README（F3/F4 契约入口）。

### 9.2 原型已知偏差（以本文为准，不复制进实现）

1. 内存数据刷新复原是演示机制，实施必须真实持久化，成功后更新，失败无副作用。
2. 筛选构建器、protoTodo、独立主题/语言按钮及宿主外壳不照搬；使用公开 KsFilter、
   宿主偏好与 UI SDK，保持原型业务交互。
3. 当前 Kestra 权限表按 R21 实现真实 grants 编辑；原型字符串摘要不作运行时解析输入。
   外部应用的说明不成为 Kestra 资源策略，不保留双分节编辑。
4. secret 头尾提示只在生成/轮换时从新值取得，旧记录缺提示显示“已设置，提示不可用”，
   不能从哈希伪造头尾。掩码提示可持久化但不得保存完整明文。
5. 原型 R1 的 access audience、R11 即时删除和 R3 非持久关系泛化按本文覆盖；subject
   授予是持久关系，标准 OAuth consent 与其分离。
6. 原型缺一次性初始凭据和强制修改、完整应用登记及权限错误态，按本文补齐；概览无组级 Audience。
7. 删用户不能仅清理可见数组，必须同事务清理所有组；所有关键操作受管理员保护。
8. **分页规格（已同步）**：旧原型默认10条、选项10/20/50，已改为page1/size25、
   选项10/25/50/100，与§12.3一致。此为原型偏差修复记录，不允许实现回退旧规格。

---

## 10. 全新实施 AI 执行入口（R28）

1. 动态核对 OS、shell、目录和 Docker，完整读根 AGENTS.md/README、本文、原型、目标
   模型及 `docs/rbac-ui-contract.md`；再读 overlay/plugin 各自 AGENTS.md/README、
   overlay `docs/r-oidc-server.md`、plugin `docs/application-groups.md`、
   `docs/management-api.md`、`docs/authorization-flow.md`。历史 project 文档只用于定位。
2. 执行根 `git status --short`、`git log -5 --oneline`、`git submodule status`；分别
   检查两子仓 HEAD、远端、工作树、当前 CI、镜像和 jar。保护用户改动，不使用旧会话
   记忆证明当前版本，不读取/改写/删除/提交 `.env.bak-round-ap`。
3. 第一项产出是更新已有 `implementation-gap-report.md` 本轮差异表，不另建重复进度
   文件：`N/T ID → 目标行为 → 当前源码/失败证据 → 所属仓 → 公开契约及正式输入
   → 测试/发布门 → 状态`。包括单权限表运行评估、映射升级、描述字段、counts、secret、
   用户删除、approved 去除、初始化、投影、撤权、管理员保护，不能只调查 UI。
4. 差异报告后给实施方案与风险排序再大规模编码。主控把业务设计写入 plugin 自足文档，
   通用事务生命周期、标准 client 查询/secret 机制提案写入 overlay。宿主不得承载组
   CRUD 或组表，独立构建不得读取根需求、相邻源码或候选产物。已确定取舍直接实施。
5. 先完成 overlay 本地门→提交推送→独立 CI→正式镜像发布；实际下载本提交报告。
   插件从正式 digest 提取公开类型和 UI SDK，再独立编译/UI/存储/升级测试与发布 jar。
   本轮新增宿主类型未发布前可设计插件，不得用候选 jar 补齐正式编译输入。
6. 插件必须在独立克隆执行 README 入口，下载成功 CI artifact，核对薄 jar、bean 索引、
   provenance、Java/UI/真实 PostgreSQL 报告。root 选择正式组合，本地完整 new-install
   全绿后才触发对应 CI。失败下载报告，按所属仓修复并复验，不直接重跑掩盖失败。
7. 最终报告实际下载核对最终三仓提交、digest、jar hash、矩阵、失败/跳过、profile、
   历史排除与 cleanup。全部必需门通过，三仓 HEAD/远端一致，才可声明交付。

默认一个主 Compose 和一个 PostgreSQL；错误 issuer 用例可按需增加辅助 JVM，共用
PostgreSQL 的独立测试数据库，不是产品多 issuer 功能。缺插件/关闭功能只在对应阶段
启动，阶段后按本次 owner label 清理容器/网络/卷/辅助数据库，保留 `.work` 和正式 jar，
不动用户部署数据。schema1 历史迁移仅显式 legacy-migration；本轮 declaration-upgrade
是额外必需门。测试/README/公开契约同步实际状态，不把候选写成已发布能力。

## 11. 冻结原型与可复现数据（R29）

基线来源为提交 `82f5657`，经2026-10-27本次反向评审同步后的
`docs/prototype-application-groups.html`，当前冻结文件 SHA-256：
`089b9a8093223580d7618925a282f7e9fd239cb10c167bb078b5d5e0f08e5140`。
实际 12 条历史 ruling、20 处字段提示；不为计数增删语义。原型只有少量 data-test，
不能当成完整验收清单。执行以下完整命令核对，
只解析 JSON，不执行原型脚本或读取本地部署：

```bash
python3 - <<'PY'
from pathlib import Path
import hashlib, json, re
source = Path('docs/prototype-application-groups.html').read_bytes()
assert hashlib.sha256(source).hexdigest() == '089b9a8093223580d7618925a282f7e9fd239cb10c167bb078b5d5e0f08e5140'
text = source.decode('utf-8')
data = json.loads(re.search(r'const DATA\s*=\s*(\{.*?\});', text, re.S).group(1))
rulings = json.loads(re.search(r'<script[^>]*type="application/rulings\+json"[^>]*>(.*?)</script>', text, re.S).group(1))
assert len(rulings['rulings']) == 12 and text.count('data-field-note=') == 20
assert [len(data[key]) for key in ['scopes', 'applications', 'declarations', 'userDirectory', 'impl']] == [19, 1, 19, 22, 18]
assert len(set(data['userDirectory'])) == 22
output = Path('.work/access-control-ui-requirements')
output.mkdir(parents=True, exist_ok=True)
(output / 'prototype-data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print('PASS prototype hash, rulings, notes and baseline counts')
PY
```

若维护者后续改原型，显式更新 hash、差异及预期，不自动接受全部变更。变更记录：2026-10-27 应用侧栏标题行增加"＋"登记入口（详情区表单，scope 同款模式），data-field-note 19→20；同日移除侧栏内联登记表单（校验逻辑并入 scope 模式表单，data-test=application-register）。原型 DATA
含人工演示组 key、admin 和资料占位符，并不等于当前带随机密码的 `planFixture` 输出；
不得继续以省略命令声称重现。组 key 不得为适配原型而重命名现存安装组。

### 本次冻结变更记录（2026-10-27）

| 变更 | 原因与新预期 |
|---|---|
| 删除概览Audience行 | §2.5无组级统一Audience；概览仅保留共享Issuer，不能显示应用audience |
| 应用详情增加资源Audience只读行 | §3.2展示所选应用的audiences列表；切换应用不得复用上一个应用值 |
| 应用侧栏增加登记已有应用内联表单 | §12.3禁止第五抽屉；输入clientId和描述，已登记/未注册client拒绝，成功新增并选中空支持应用 |
| 统一所有原型分页默认值与选项 | §12.3规定page1/size25，允许10/25/50/100；权限、用户、subject列表共同采用 |

以上四处变更的旧冻结hash为
`7bb5c48639f78c018971bb7b768625f463a421c8a6251f60330ed8f7829f929a`；新hash见本节
当前冻结值和上方校验命令，两者必须一致。历史rulings仍12条，data-field-note仍19处，
DATA快照计数不变。登记示例`demo-registered-client`存在于原型独立的标准注册模拟表，
初始未加入组，不计入DATA的1个应用；其resource Audience为示例URL、类型为public。
真实实现必须通过宿主已发布协议契约校验当前注册状态，不能读取此模拟表充当验收。

| 输入 | 转换与核对预期 |
|---|---|
| group/groups | 专用空库安装计划中 1 个内置组；UI key 对应现有 id，不改用户真实安装 |
| scopes | 19 个角色；每个 key/name/description 集合逐项相等，不只比总数 |
| applications/app | 1 个真实注册 client；clientId 原值对应，测试 audience 按实际服务 URL；去插件 approved，不绕过协议注册 |
| declarations | 19 条旧声明转换为独立权限和 scope 关系；与 impl 的关系按显式升级映射计划核对 |
| userDirectory/userMeta | 22 个标准用户，名字/邮箱“—”视为空资料展示，不保存占位符；密码来自隔离测试配置 |
| user | 1 个持久组 subject，授予 3 个 scope；用户总数与组成员数不同 |
| impl | 18 个真实策略记录的历史参考，不把摘要文本当可执行 grants；无实际映射的声明以空grants非执行状态保留；允许此类实体存在，但不得变成资源授权 |

实施 agent 在编码前从该快照输出逐 key 映射预期，并用生产入口重建专用空库。新模型
测试须另加 2 组、2 应用、同名 scope 不同组、超过 25 条记录、单/多角色及零授权账号、
READ-only/MANAGE-only、禁用用户、public/confidential client、空关联、一权限双 scope、
两权限同 scope。不能用原型单组单应用数量替代这些边界，不手写 token 或 SQL 授权。

## 12. 确定的接口行为、导航和验收

本节是待实施目标，不是已发布接口。具体版本化 DTO、schema 和代码设计归所属仓；
下面的行为必须写入其 README/公开契约，不要求独立仓构建依赖本文。

### 12.1 字段与授权关系

- 组 wire/storage 沿用 `id`，UI 称“组 key”。安装内唯一，退役 ID 不重用；普通组创建
  初始为空，组删除仍要求无 scope/应用/subject。原型 `kestra-group` 不要求改名生产组。
- 组/应用 description 新增且可空，最长 4096 Unicode code point；displayName 和
  scope name 最长 256，scope name 必填且组内精确唯一。scope key 沿用现有 1–64
  小写规则，组 id 沿用现有 1–128 格式；不隐式折叠大小写或翻译管理员输入。
- 权限公共字段 `key/name/scopeKeys`，key 使用小写字母开头、后续小写字母/数字/连字符，
  长 1–128，应用内唯一且不可改；name 必填最长 256，不要求唯一。scopeKeys 不重复、
  只引用本组现存 scope，可空。服务端返回 implementationKind，拒绝客户端切换类型。
- Kestra 权限体为结构化 grants/managementGrants，沿用现有 typed schema、精确
  namespace/resource/id/action、tenant=main 和失败关闭校验；可增加 description，
  不以 key/name 文本推断动作。external 权限体 details 为最多 16384 字符纯文本，可空；
  不解析 HTML、YAML、表达式，不能写入本实例执行 grants。单次管理 JSON ≤1 MiB。
- 新建当前 Kestra 权限允许先保存空 grants，但它不能提供业务或管理授权；有效
  scope 没有启用的完整实际策略时，资源请求失败关闭，混入该 scope 的旧已验证拒绝
  用例不能被删掉。权限启用状态、资源范围与管理目标沿用原有运行时约束；不能因
  展示表合并扩大任何旧未获准操作。
- Kestra 权限另有 `enabled`（创建默认 true）、`grants` 与 `managementGrants`。enabled
  只控制该权限的实际执行效力，不偷偷改变登记的支持集；支持仍由全部实体 scopeKeys
  并集计算。权限停用后真实资源与管理员判断忽略其 grants，并按真实策略撤权时限
  生效；外部声明不引入执行开关。迁移时保留原有 disabled 的实际效力，不默认启用。
- 单权限更新同时包含 name/scopeKeys 与上述完整内容字段，缺必需字段拒绝而不清空
  既有策略；外部体只允许 details，不接受 grants/managementGrants/implementationKind
  写入。具体读 DTO 可另带只读 revision/parentRevision，不允许客户端控制 epoch。
- 有效组与标准 client 才可签发；去插件 approved 不删除组 active 或宿主 client
  active/pending/owner 检查。协议 endpoint、issuer 严格校验及签名 claim 保持。
- subject 身份用 `(issuer,subject)`，内置账号当前 subject 恰为用户名；不按 email/name
  匹配。添加候选为启用且未加入本组的真实用户，已有禁用 subject 仍显示但无涉及应用。
- scope 删除检查权限激活、用户授予及残留实际策略引用，不留下悬空 grants。阻塞引用
  只返回有 READ 的信息；仅 MANAGE 者得 conflict，不从错误体获取其他人名称。
- 当前 Kestra 权限的读取/编辑分别需要 LOCAL_POLICY.READ/MANAGE；若本次变更还改变
  应用支持集，必须同时 IDENTITY.MANAGE。只有修改 grants 不改变支持集时不额外要求
  IDENTITY；只有 IDENTITY 不能编辑或读取实际 grants。scope 关联概览可显示有权读取
  的应用 key，但不借其暴露未获 LOCAL_POLICY.READ 的权限名称/明细。

### 12.2 API、修订与一致性

根路径 `/api/v1/main/extensions/rbac`、标准认证与 CSRF 保留。client 路径沿用规范
`~`+base64url，scope 路径直接使用稳定 key，不改 client_id 协议值。保留组、scope、
用户及 `/scope-grants/detail?subject=...` 公开入口；以下为变更目标：

| 入口 | 必需行为 |
|---|---|
| `/application-groups`、`/{id}` | 原组CRUD新增 description、显式 builtIn、有权读取的 counts |
| `/{id}/applications`、`/applications/{clientKey}` | 登记真实标准client，输入clientId/description/audiences；不接收approved或supportedScopeKeys写入，返回派生支持集 |
| `/{id}/applications/{clientKey}/permissions`、`/permissions/{key}` | 独立权限CRUD，内容按implementationKind；单对象全量PUT，不替换整应用 |
| DELETE `/users/detail?subject=...` | 强账号修订；标准账号与全组授予同事务删除，见§4.4 |
| POST `/users` | 输入username/name/email；宿主生成临时凭据，一次性响应且首次强制修改；不能通过GET重取 |
| `/{id}/applications/{clientKey}/credentials` | 只读client类型、secretSet、maskedHint、credentialRevision、rotationMode；不返哈希/旧明文 |
| POST `/{id}/applications/{clientKey}/credentials/rotate` | 强凭据修订；普通confidential一次性新值，public拒绝，当前登录client返回maintenance_required且不修改 |

表中以 `/{id}` 开始的相对子路径均接 `/application-groups`。新权限实体替代旧 scope-declarations 与重复
runtime-permissions 写入口；两套旧写路由不注册，无兼容转发。真实授权评估改用当前
Kestra 权限实体的 typed 投影。consent 按请求且可获 scope 展示角色名与关联权限
key/name/可读摘要，同 scope 不重复，不泄露未申请 scope；协议展示接口可投影为按
scope 分组的只读结构，不要求物理表仍按 scope 嵌套，更不能保留旧重复 key 限制。

读取需READ；写入需MANAGE及必要的双域权限。MANAGE-only可提交已知输入和revision，
成功仅返回 `{key或id,revision,parentRevision}`/ETag，不回传对象、策略或计数；secret
响应为明确例外。提供已知目标的 mutation-metadata capability，只返回其获准动作与
修订，不返回目录内容。创建对象返回其提交的标识与回执，不能借创建获得READ。

更新/删除强 If-Match 对应被改对象 revision：缺428、格式错400、过时412；唯一键
冲突409，非法引用400，scope有引用409 `scope_in_use`，无权限403，未知合法目标404，
关闭功能404，依赖不唯一/故障503。权限创建用应用revision，组子项创建沿用组revision。
原子推进对象/必要父快照及epoch，派生支持不先写再补偿；metadata-only不误撤权。
支持变化才受60秒撤权门；实际grants变更也必须使旧允许策略缓存60秒内失效，不能
因此自动扩大token scope。仅name/details/description修改原凭据继续有效。

锁顺序沿用公开安全锁→插件目录→策略/权限→标准身份行；READ_COMMITTED。同连接
检查当前操作者/管理员，不commit/rollback/close宿主借用连接，不开第二连接检查。
并发“删scope/加引用”“移出应用/改权限”“两个管理员互删或停用”“两次secret轮换”
只能得到有效串行结果或冲突，失败无副作用。轮换不自动重试，响应丢失只可生成新版本。

### 12.3 导航、筛选、统计与失败状态

保留主路由 application-groups、users；组详情四页签路径为组根、scopes、applications、
scope-grants，scope/app选择写入其子路径。侧栏只切内容与规范URL，不进详情抽屉；
详情初始只读，显式编辑后保存/取消回只读。应用侧栏增加“登记已有应用”内联表单，
不新增第五个抽屉，标准redirect/type/owner仍由宿主管理。

深链query约定permissionKey、filterSubject、重复scopeKeys、page/size。subject跳应用
保留来源与scope集合，READ后重新校验当前授予，不继续采用过期范围；scopeKeys内ANY，
不同chip间AND，同字段多chip也AND。权限key精确相等、name大小写敏感包含、scope集合
相交；用户/subject主体精确相等。非法query显示可清除错误，不写数据或跳外站；合法
无结果显示空态。深链与手工chip共存、可单删，清除所有同步query，刷新/前进后退/复制
URL还原状态；切组清旧组过滤，切应用清不存在权限条件。

默认page1,size25，可选10/25/50/100，过滤或size变化回第一页；删除末页末行退最后
有效页；删当前选中项按key升序选下一项、无则上一项、全空则空态。key/subject按Unicode
码点稳定排序。Total在授权及筛选后、分页前计算；枚举只含获准真实记录，超量搜索分页，
不能静默截断。侧栏也支持搜索分页；禁用用户可在用户列表定位但不作新subject候选。
cards/counts使用同组快照，subject计数为组成员记录数，含零scope和禁用，不等于用户
总数或授予条数。未加载、0、故障分别显示，读取错误不伪装空态。跨页核对catalog/group
revision，不拼漂移快照；统计/枚举也独立READ授权。

关闭抽屉、遮罩、ESC、取消、切页签/侧栏、浏览器返回，存在草稿时均须丢弃确认；
取消后保留草稿，保存中禁闭和重复提交。成功才更新列表及派生值；409/412保留草稿，
用户显式刷新再编辑，不自动覆盖；403清失权敏感内容并可退出换号，503可显式重试，
POST/secret不自动重发。关闭焦点回原触发元素，已删除则回列表/侧栏标题，图标删除
不能只靠hover，键盘focus也可操作且有可访问名称。

### 12.4 验收用例索引（覆盖N1–N20）

| 用例 | 覆盖 | 必需正反断言 |
|---|---|---|
| T1 | N1–N6 | 冻结数据逐key核对；卡片/徽章/统计各自真实点击；内置拒删，普通空组可删且id不复用 |
| T2 | N7–N9 | key不可改、name冲突；任一应用/用户/实际策略引用拒删无副作用；无引用删除持久且选中回退 |
| T3 | N10–N14 | P1→s1,s2、P2→s2；删P1的s2支持不变，删P2才撤s2；空关联；metadata不扩权，修改Kestra typed grants真实改变允许/拒绝 |
| T4 | N12–N16 | ANY/AND、手工及深链chip、返回刷新、过期授予、多页Total、跨组/跨应用范围、非法与空态 |
| T5 | N4/N5/N15/N16 | 新用户临时密码一次性展示、首次强制修改后实际登录；零scope保留；删subject不删账号；禁用保留授予；删用户全组清理而执行/审计保留 |
| T6 | N5/N19 | 参与者写入后抛错、宿主删账号失败、并发管理员互删/停用：全部回滚或最后管理员拒绝 |
| T7 | N11/N19 | public无入口且直调拒绝；普通secret新值成功旧值失败；修订/CSRF/失权拒绝；掩码刷新、明文一次、响应丢失不补发 |
| T8 | N11/N19 | 配置登录client在线拒绝；prepare不影响登录、cancel、维护activate、新配置真实登录及失败回退，最终单一有效secret |
| T9 | N14/N19 | IDENTITY/LOCAL_POLICY分离；READ-only/MANAGE-only/零授权；只写不读无泄露；联合支持变更要求双域；counts/枚举无越界 |
| T10 | N17/N18 | 四抽屉/确认框的焦点、ESC、最大化还原、丢弃、保存中禁闭、删除取消及失败无副作用 |
| T11 | N1–N19 | 全部现有语言×light/dark/dark-2/system；系统明暗切换、中英重点样式、1280/768/390宽度、键盘/错误/刷新/实际计算样式 |
| T12 | N20/F2–F6 | 新装、schema2升级/冲突/幂等/回滚；旧凭据不自动扩权、60秒撤权、MCP允许/拒绝/refresh、缺插件/关闭功能、最终CI及cleanup |

T3增加“把外部说明改成管理员描述仍无本实例权限”反例；T9保留多角色互不包含资源
范围、精确namespace、同scope完整授权与禁止跨scope拼接。T11使用所选正式宿主MCP
Servers/Namespaces等实测参照；截图不替代实际请求、持久结果与计算样式。新旧用例
数量因目标变化可增加，必须先映射后更新数量门，不把删除、未运行或历史排除算通过。
主profile为new-install，14项schema1历史排除明确列出；declaration-upgrade另报且必须
通过。失败也保留已执行行和文档/请求来源，不能整体忽略console。最终对应提交的
overlay/plugin/root CI成功且报告实际下载核对，必需项零失败零跳过零未运行才交付。

### 12.5 稳定业务标识

生产新增data-test至少包含以下语义，重复项用data-group-id/data-client-key/
data-scope-key/data-permission-key/data-subject精确关联，不把凭据写进属性：

```text
access-control-root, tab-application-groups, tab-users, group-card,
group-count-scopes, group-count-applications, group-count-subjects, group-detail, group-edit,
scope-sidebar, scope-item, scope-detail, scope-add, scope-save, scope-delete,
application-sidebar, application-item, application-register, application-detail,
application-permissions, permission-row, permission-add, permission-edit, permission-delete,
application-supported-scopes, application-credentials, credential-rotate, credential-once,
subject-list, subject-row, subject-add, user-list, user-row, user-create, user-delete,
drawer-group, drawer-user, drawer-permission, drawer-subject, drawer-maximize, drawer-close,
discard-confirm, delete-confirm, filter-chip, list-total, request-error, conflict-refresh
```

使用公开组件允许其内部DOM变化，不要求复制原型CSS/标签树。语义角色/可访问名称仍
必须正确，不能只凭data-test存在判通过。交付对照表列N/T ID、实际标识、目标API、所属
仓测试文件、实际报告及发布状态。页面可见、200或按钮点击本身不等于保存或授权成功。

