# Playground「运行 task」按钮卡灰缺陷 — 现象、根因与上游修复跟踪

- 状态：**旧 v2.0.5 已复现；当前正式 v2.0.11 的同序列行为待复测**。
- 历史影响版本：上游 `2.0.5`。本文旧根因与取证不代表当前部署状态。
- 当前判定规则：实际执行下述交互序列，以保存、执行和按钮恢复结果裁决。
  特定修复提交是否包含、单文件是否相同，只是调查输入，不能证明已修或未修。
- 已撤销此前仅按源码比较作出的“v2.0.11 未修复”结论；也不预先认定升级已修复。
- 历史模式 A 取样为同库关闭 RBAC，不等同正式模式 A 不装载插件的完整验收。

---

## 1. 现象

在 Flow 编辑器开启 Playground（`?playground=on`）后，把光标落在某个 task 上会浮出「运行 task」按钮。

**故障表现**：该按钮变为不可点击的灰色状态（`disabled`），并且此后**在任意 flow** 的 Playground 中都不再恢复，直到重新加载页面/重启浏览器。

**触发路径（用户实测，100% 复现）**：

1. 进入「新建 flow」页面（`/ui/main/flows/new`），**保存之前**开启 Playground；
2. 选中某个 task → 出现「运行 task」按钮，此时**按钮可点击**；
3. 点击 → 弹出确认框：「在创建 flow 时无法运行 playground。启动 playground 运行将创建 flow。」；
4. 点确认（此时会自动保存该 flow 并跳转到编辑页）；
5. 跳转完成后，该 flow 的 Playground「运行 task」按钮**从此变灰、无法点击**；
6. 再打开任何一个已存在的 flow 并开启 Playground，按钮**同样为灰**（直到刷新页面）。

`KESTRA_RBAC_ENABLED=true`（模式 B）与在同库直接切为 `false`（模式 A）**表现完全一致**，因此这不是权限问题。

## 2. 根因（前端状态机缺陷，代码级）

文件：`ui/src/stores/playground.ts`（上游 2.0.5，本仓未做任何改动）。

```ts
// 202-217（2.0.5）
const readyToStartPure = computed(() => {
    const executionReady = !latestExecution.value || !nonFinalStates.includes(executionState.value)
    const flowValid = !(flowStore.haveChange && flowStore.flowErrors)
    return executionReady && flowValid
})
const readyToStart = ref(readyToStartPure.value)   // ← 手动 ref，独立于 computed
watch(readyToStartPure, (newValue) => {            // ← 只在 pure 值“发生变化”时才写入
    if (newValue) { setTimeout(() => { readyToStart.value = newValue }, 1000) }
    else { readyToStart.value = newValue }
})
```

```ts
// 260-279（2.0.5）
async function runUntilTask(taskId?: string, runDownstreamTasks = false, customFormData?) {
    if (readyToStart.value === false) { return }     // ① 闸门
    if (flowStore.haveChange && flowStore.flowErrors) { return }
    readyToStart.value = false                       // ② 运行前先置灰
    if (flowStore.isCreating) {
        toast.confirm(t("playground.confirm_create"), async () => {
            await flowStore.saveAll()
            navigateToEdit(taskId, runDownstreamTasks)   // ③ 保存后跳转路由
        })
        return                                       // ④ ★ 直接 return，没有把 ② 置的 false 复位
    }
    ...
}
```

失效链：

1. 步骤 ② 把 `readyToStart` 置为 `false`；
2. 走 `isCreating` 分支后 **④ 直接 `return`**，且 `toast.confirm` 的回调里只做保存 + 跳转，**没有任何地方把 `readyToStart` 恢复为 `true`**；
3. `readyToStart` 是**手写 `ref`**，不随 `readyToStartPure` 自动求值；而 `watch` 只在 `readyToStartPure` **值发生变化**时才写入。
4. 跳转后新 flow 是有效的、也没有进行中的执行，`readyToStartPure` 依旧为 `true`——**没有变化**，watch 不触发，`readyToStart` 就永久停在 `false`。
5. `playground` 是 Pinia 全局单例，跨路由共享，所以在同一个浏览器会话内**所有 flow** 的按钮都保持灰。

补充说明：新建 flow 时若 `haveChange && flowErrors` 曾让 `readyToStartPure` 从 `true` 变 `false`、保存后又变回 `true`，watch 会重新写入 `true`——这也解释了为什么该缺陷表现为"有时复现、有时不复现"，但用户复核的这条固定路径（新建→运行→确认）是**稳定复现**的。

## 3. 为什么自动化脚本一开始"测不出来"

自动化验证是直接打开**已保存**的 flow 编辑页并读取按钮 `disabled`，从未走过"新建 flow → 点运行 → 确认 → 跳转"这条状态迁移路径，因此 `readyToStart` 一直保持初值 `true`，按钮自然可用。**这是取样路径不对，不是缺陷不存在。** 教训：验证交互类缺陷必须复刻用户的状态序列（含确认弹窗与路由跳转），不能只读最终静态页面的属性。

## 4. 上游已修复（对比 `kestra-io/kestra` `develop`）

上游当前 `ui/src/stores/playground.ts` 已改为：

```ts
const executionSettled = ref(readyToStartPure.value)
watch(readyToStartPure, (newValue) => { ... })          // 保留 1s 收敛
const starting = ref(false)
const readyToStart = computed(() =>                     // ← 不再手写 ref
    !starting.value && readyToStartPure.value && executionSettled.value
)
```

```ts
async function runUntilTask(...) {
    if (readyToStart.value === false) { return }
    if (flowStore.haveChange && flowStore.flowErrors) { return }
    if (flowStore.isCreating) {
        starting.value = true
        let outcome
        try { outcome = await flowStore.saveAsDraft() }   // ← 直接保存草稿，不再 toast.confirm
        finally { starting.value = false }                // ← ★ 无论成败都复位
        if (isSuccessfulFlowSaveOutcome(outcome)) {
            await navigateToEdit(taskId, runDownstreamTasks)
            enabled.value = true
        }
        return
    }
    starting.value = true
    try { await startRun(taskId, runDownstreamTasks, customFormData) }
    finally { starting.value = false }
}
```

上游对应修复：

| 上游 PR / Issue | 提交 | 日期 | 内容 |
|---|---|---|---|
| #20369 | `a5aa7806` | 2026-10-05 | `fix(flows): playground run task stuck disabled when no execution starts` |
| #20370 | `0e7d0cc9` | 2026-10-05 | `fix(flows): playground run saves a draft instead of publishing` |

（`0e7d0cc9` 移除了新建 flow 场景下的 `toast.confirm`，改为直接 `saveAsDraft()` 并用 `finally` 复位 `starting`。）

## 5. 定性

| 维度 | 结论 |
|---|---|
| 是否本仓定制引入 | **否**。`kestra-overlay/patches` 中检索 `stores/playground` / `playground` 命中 0 条，Playground 相关前端文件全部为上游原样 |
| 是否与 RBAC 有关 | **否**。模式 B（`KESTRA_RBAC_ENABLED=true`）与模式 A（同库切 `false`）表现一致；`createExecution` 等接口在两种模式下均为 200 |
| 是否上游缺陷 | **是**，上游 2.0.5 的 `readyToStart` 状态复位缺失 |
| 修复方式 | **不本仓修复**；跟随升级上游，纳入含 `a5aa7806`、`0e7d0cc9` 的版本即可解决 |

## 6. 临时规避（仅用于当前验收期间）

- 触发后**刷新页面**（或新开浏览器标签）即可恢复，因为 Pinia 重建、`readyToStart` 回到初值；
- 或先保存 flow（离开"新建"状态）再开启 Playground 运行。

## 7. 升级后的验收清单

1. 新建 flow、**不保存**，开启 Playground → 选中 task → 「运行 task」可点击；
2. 点击后按目标版本实际交互继续；若出现保存确认框则确认。记录保存、跳转和执行请求，不能把特定文案、无确认框或草稿实现作为唯一成功条件；
3. 跳转后的编辑页中，执行终态后「运行 task」与「运行所有Tasks」恢复可用，并实际再次运行成功；
4. 在**同一会话内、不刷新**再打开另一个已保存 flow 的 Playground，按钮仍可用且实际运行成功；
5. 刷新页面后行为一致；
6. 模式 A 不装载插件，模式 B 装载正式插件并使用 `company` 及子空间的普通授权，分别执行上述 1–5 步。记录正式镜像 digest、jar hash 和实际执行结果，不靠首装身份直接放行。

## 8. 附：取证记录

- 模式 B（`KESTRA_RBAC_ENABLED=true`）：
  - 已保存 flow：`button "运行 task" disabled=false`，`playground.readyToStart=true`；
  - 编辑 YAML 触发 `GET /api/v1/main/flows/validate` → `200`，`flowErrors=null`，按钮仍可用；
  - 点击「运行所有Tasks」→ `POST /api/v1/main/executions/company.team/flow_9710998?kind=PLAYGROUND&breakpoints=&revision=1` → `200`，执行 `SUCCESS`。
- 模式 A（同库切 `KESTRA_RBAC_ENABLED=false`）：
  - 同一 flow、同一账号：`button "运行 task" disabled=false`，`readyToStart=true`；
  - 编辑后同样 `haveChange=true`、`errors=null`、按钮可用。
- 结论：**只有走"新建 flow → 运行 task → 确认 → 跳转"这一状态序列才会把 `readyToStart` 卡在 `false`**，两种模式一致。
