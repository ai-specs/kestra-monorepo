# 应用项目 UI 术语优化

状态：第一项问题的**术语裁决已由维护者确认**；替换文案与各页面的概念引入顺序属于
实施方建议，**待维护者裁决**；UI 文案实现与真实浏览器复验**未开始**。

本文只记录应用项目管理页面（`/ui/main/extensions/rbac/**`）的用户可见术语与说明文案。
本文不改变 OAuth2 scope、完整 grant、命名空间、资源、动作、ID 限制、两侧独立保存的
设计意图或任何授权计算规则；这些继续由 `kestra-plugin-rbac/docs/application-projects.md`
定义。

本文分三层记录，不得混用：

- **已裁决**：维护者已明确的结论，实施必须遵守。
- **事实清单**：当前代码与页面的实际状态，用于界定影响面。
- **实施方建议**：尚未经维护者确认的替换方案，不得当作结论写入 UI。

## 1. 第一项问题（2026-10-20，维护者提出）

页面路由：

```text
/ui/main/extensions/rbac/projects
```

该页面当前是**应用项目列表页**，顶部显示提示（翻译键 `independentSaves`）：

```text
zh_CN：身份目录与本地权限分别保存，任何一侧保存都不会自动同步另一侧。
en   ：Identity directory and local permissions are saved separately. Neither save synchronizes the other.
```

维护者指出两个问题：

1. **“身份目录”叫法不合适，太拗口。** 这个概念就是 `scope`，直接使用 `scope` 这个专用
   名词即可。
2. **“本地权限”叫法不恰当。** “本地”只能相对于项目里的某个具体应用而言；没有具体应用
   在场，就谈不上“本地”，更谈不上“本地权限”。

并且，项目列表页当前只是一个项目列表，尚未引入 scope、应用、授权内容等任何其他概念；
在这个页面提示“身份目录”“本地权限”都不合理。

### 1.1 设计意图本身未被否定

实施方在对话中对“两侧分别保存”的解释——scope 的定义与授予（谁能取得哪个 scope）
和 scope 在本实例中的授权内容（该 scope 能对哪些资源做什么）是两套独立配置、保存一侧
不会替管理员完成另一侧、完整授权需要两侧同时成立——维护者未提出异议。

本次裁决针对的是**用词**与**出现的页面位置**，不是这一设计。

## 2. 已裁决（维护者确认）

### 2.1 不再使用“身份目录”，统一使用 `scope`

用户可见文案中不再出现“身份目录”“共享身份目录”及其英文 “identity directory”
“shared identity directory”。该概念统一称为 `scope`。

本裁决是术语级裁决，适用于所有页面，不限于项目列表页。

### 2.2 不再使用“本地权限”作为术语

用户可见文案中不再把 scope 的授权内容称为“本地权限”（英文 “local permissions”）。
理由：“本地”需要一个具体应用作为参照；项目管理页面没有这个参照。

本裁决同样是术语级裁决。替换用什么词见 §4（待裁决）。

### 2.3 项目列表页不提前解释尚未出现的概念

`/ui/main/extensions/rbac/projects` 当前只展示应用项目。该页面不应出现“身份目录”
“本地权限”，也不应提前解释该页面尚未引入的概念（scope 授予、client 成员、subject
分配、grant 保存流程等）。

“两侧分别保存”的提示应移到**概念已经出现**的页面（见 §4.3 建议），而不是放在列表页。

## 3. 事实清单：影响面

两个术语不只出现在横幅一处。以下取自
`kestra-plugin-rbac/ui/src/translations/zh_CN.json`（英文对应 `en.json`，共 13 个语言
文件须同步）。本节只列事实，不代表每条的替换文案已定。

### 3.1 含“身份目录”的翻译键（9 处）

| 键 | zh_CN 现文案 |
|---|---|
| `identityDirectory` | 共享身份目录 |
| `saveIdentity` | 保存身份目录 |
| `identitySaved` | 身份目录已保存；本地权限未同步修改。 |
| `directoryStale` | 身份目录已变化或不可用。请重新加载并核对后保存。 |
| `independentSaves` | 身份目录与本地权限分别保存，任何一侧保存都不会自动同步另一侧。（**第一项问题**）|
| `reconciliationReview` | 请按当前目录上界检查每个 scope 的完整业务 grants 和管理 grants。确认不会修改共享身份目录。 |
| `reauthenticationRequired` | 身份目录已变更或当前会话已失效。继续前必须通过宿主重新登录；仅重新加载不会恢复权限。 |
| `localRecoveryOnly` | …恢复不授予身份目录、账号、client 或授予管理权。… |
| `newLocalBindingHelp` | …保存不会修改身份目录，也不会向用户授予 scope。 |

### 3.2 含“本地权限 / 本地绑定 / 本地 grants / 本地 scope”的翻译键（约 15 处）

| 键 | zh_CN 现文案 |
|---|---|
| `localPolicy` | 本地权限 |
| `completeGrants` | 完整本地 grants |
| `saveLocal` | 保存本地权限 |
| `localSaved` | 本地权限已保存；身份授予未同步修改。 |
| `localStatus` | 本地绑定（项目列表“Local binding”列） |
| `deleteLocal` | 删除本地绑定 |
| `configureLocalFirst` | 请先配置项目的本地绑定。 |
| `stateDisclaimer` | 此处显示当前身份记录和本地绑定，… |
| `reviewedBinding` | 我已检查全部本地绑定。 |
| `reconciliationSaved` | 本地绑定确认已保存。… |
| `addLocalScope` | 添加本地 scope 绑定 |
| `newLocalBinding` | 新增本地绑定 |
| `newLocalBindingHelp` | 选择已有共享 scope，配置其完整本地权限。… |
| `independentSaves` / `identitySaved` / `localRecoveryOnly` | （同时含两个术语，已列于 3.1） |

### 3.3 当前页面结构

项目列表页（经真实浏览器核对，2026-10-20）：Projects / Users 两个 tab；表格列为
Project ID、Display name、Trusted issuer、Active、**Local binding**、Actions；顶部有
“Policy source: database · Policy revision: N”与 `independentSaves` 横幅。
其中 “Local binding” 列同样落在 §2.2 裁决范围内。

## 4. 实施方建议（待维护者裁决）

以下为实施方拟定的替换方向，**未经确认，不得直接写入 UI**。每条经维护者确认后
移入 §2。

### 4.1 “身份目录”侧的具体表达

- 泛指该侧对象时：`scope`。
- 指“谁可以取得哪个 scope”时：`scope 授予`（用户）、`scope 成员`或`获准的 client`
  （client）。
- `identityDirectory`（tab/区块标题）→ 建议 “Scope” / “scope”。
- `saveIdentity` → 建议 “保存 scope” / “Save scopes”。
- `directoryStale` / `reauthenticationRequired` 中的“身份目录已变化”→ 建议
  “scope 定义或授予已变化”。

### 4.2 “本地权限”侧的具体表达

“本地”不再使用。建议按**对象本身**命名，而不是按“相对于谁”命名：

- `localPolicy` → 建议 “scope 的授权内容” / “Scope grants”。
- `completeGrants` → 建议 “完整 grants”（去掉“本地”）。
- `localStatus`（列名）→ 建议 “授权配置”（值：已配置并启用 / 未配置 / 已禁用）。
- `saveLocal` / `localSaved` / `deleteLocal` / `newLocalBinding` / `addLocalScope` /
  `configureLocalFirst` / `reviewedBinding` / `reconciliationSaved` 中的“本地绑定”
  → 建议统一为 “scope 授权配置”或更短的 “grants 配置”。

在 scope 详情页，授权内容直接按实际字段说明：命名空间范围、资源类型、动作、是否含
子命名空间、资源 ID 限制、管理目标（若该页确有管理 scope）。

### 4.3 “两侧分别保存”提示的去处与文案

- 项目列表页：**删除** `independentSaves` 横幅。如需引导，用只描述本页行为的一句，
  例如 “选择项目后查看并维护该项目的 scope。”——最终以页面实际可执行操作为准，
  不提示本页不存在的操作。
- 项目详情 / scope 详情页（两侧对象都已出现）：保留“分别保存、互不同步”的提示，
  改用新术语，例如 “scope 的授予与 scope 的授权内容分别保存，保存任一侧不会自动
  同步另一侧。”

### 4.4 概念引入顺序（建议）

1. 项目列表：应用项目；进入项目的入口。
2. 项目详情：项目 ID、issuer、audience、启用状态、修订。
3. scope 列表：scope 名称、说明、启用状态、授权摘要。
4. scope 详情：同一 scope 内的命名空间、资源、动作、子命名空间、资源 ID 限制。
5. 成员 / client / 用户：scope 授予、client 批准、subject 分配，标明其属于哪一侧保存。

页面不得把一个 scope 拆成“命名空间选择器”和“动作角色”两个独立来源，也不得用术语
暗示不同 scope 可以拼接出新权限。

## 5. 术语优化不改变的授权语义

- scope 是独立授权单元，必须包含完整的资源范围和动作条件。
- scope 授予（身份侧）不等于该 scope 在本实例已配置授权内容；两侧都成立才允许。
- 未知、停用、空 grant 或无效 scope 失败关闭；已知但未配置授权内容的 scope 混入
  token 时整体拒绝。
- 不同 scope 不在运行时拼接命名空间、资源 ID 或动作。
- UI、REST、MCP 使用同一 scope 解释。

## 6. 验收要求（文案落地后）

- 全部 13 个语言文件中，§3 列出的键不再含“身份目录 / identity directory”
  “本地权限 / local permissions”及未经裁决的“本地”表述。
- 项目列表页不出现 §2.3 禁止的概念提示；页面文案与本页实际可执行操作一致。
- 项目详情、scope 详情页使用 scope、命名空间、资源、动作的准确名称；首次出现 scope
  时给出可理解的一句说明。
- 中英文、明暗主题、窄屏、拒绝状态下术语一致。
- 以真实浏览器核对页面文本、保存结果与拒绝提示；翻译键存在不能代替页面检查。
- `check-translations.mjs` 完整性检查通过，且不以此替代上条。

## 7. 与其他文档的关系

- `kestra-plugin-rbac/docs/application-projects.md`：继续定义 scope、完整 grant、
  两侧独立保存与授权边界；本文不改写它。
- `docs/rbac-ui-contract.md`：定义页面的授权行为契约；本文只定义用词与说明顺序。
- 后续若页面引入新的授予 / 成员对象，先在本文 §2 追加裁决、§3 补事实，再改 UI。

## 8. 待办

- [ ] 维护者裁决 §4.1–4.4 的替换文案与引入顺序（或提出替代方案）。
- [ ] 维护者提出第二项及后续问题，按本文三层结构追加。
- [ ] 实施：按裁决修改 13 个语言文件与相关组件；真实浏览器复验；更新本文状态。
