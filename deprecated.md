# 已归档的历史验收记录

> 本文件归档历史版本的验收快照、commit hash、CI run ID 和镜像 digest。
> 这些记录仅用于追溯当时版本的验证状态，**不代表当前部署**。
> 当前版本以 git log 和最新 CI 为准。

---

## 2026-11-02 根仓组合验收

- 根仓 commit: `bd8d969491426303e75bddd6bd26187121da499a`
- Workflow: Monorepo Compose acceptance
- Run ID: 41508289317
- 结果: ✅ success
- 耗时: ~60 分钟
- 覆盖: REST 56 探针、UI 验收、组合检查

---

## 2026-10-31 根仓本地运行记录

- 根仓 commit: `3717e52`
- 结果: REST 56 通过，UI 135 通过，2 项诊断失败，零未运行
- 组合阶段约 63.5 分钟，133 个具名 UI 用例合计 34.3 分钟
- 该次运行不能记为整体验收通过

---

## 2026-10-31 正式宿主 v3

- 宿主 commit: `253e5e9e0dc270ae638d9dd1d9fd04948da5477a`
- 宿主 CI: 41224044004（五 job 成功并完成推广）
- 镜像 digest: `sha256:9f36f43a42151e4dde11ed31d630c6a0dccab50f57dbf9426f30b0af53d907e4`
- 正式双架构 executable SHA-256: `f189928270dc700cf095164dd6c1c736c0654a98dade11526faa90e27ddd1993`
- 插件 commit: `33f2c0905d83acf1ce6309b412d3e01712e4d015`
- 插件 CI: 41229212687（成功）
- 插件 jar SHA-256: `f079051489e5f4519df811bed2a7c8bcff7e220a6a5db13824d2c931f702ee16`
- 覆盖: SDK 949、几何 64、UI 105、后端 412、MCP 四份专项、两模式 20 报告

---

## 2026-10-29 宿主原生筛选修复

- 宿主 commit: `1e3632e`
- 宿主 CI: 40822882820
- 镜像 digest: `sha256:9e2667744f9f0515a9902aa3d83bca3a3433aa9b752ec72fd8c07f3c539acdd0`
- 插件 commit: `70cb552`
- 插件 CI: 40908627243
- 插件 jar SHA-256: `b4866c5b6e184a0ef08804ea8976948edadeb5cb6e9d57375b9e224833ac0800`

---

## 2026-10-22 应用组重构状态

- 宿主 commit: `c2390ff`
- 宿主 CI: 39712369397（全部通过并发布）
- 插件 commit: `6f23eeb`
- 插件 CI: 39715045248
- 覆盖: Java 218、PostgreSQL 76、前端逻辑 39
- 根仓本地空库 new-install: REST 56、安全 15、MCP 11、UI 99，零失败零未运行

---

## 2026-10-19 应用项目授权交付（旧模型）

- 根仓 commit: `85eb764c5656ccc4056c235072dfb83e830f9964`
- 根仓 CI: 39263232685
- 宿主 commit: `e10448596ca7fc4564be4621dd60757d6adcc31d`
- 宿主镜像: `ghcr.io/ai-specs/kestra-overlay@sha256:a20b950733fb85216d2155107c9c3423ffce1b5041faa5d4e475836c7e037ae8`
- 插件 commit: `fa18839a4f0ecbf41a68a198c6a927963113637`
- 插件 CI: 39246508084
- 插件 jar SHA-256: `c5c5acebd6d22e3b8c76ec9a5366cde8e55ff82995a204802899fb75c89a2b7b`
- 覆盖: REST 56/56、MCP 11/11、安全 14/14、迁移 14/14、主题语言 52/52、组合 UI 98/98

---

## 归档说明

- 以上记录来自原 README.md 的历史验收章节。
- 每次发版后，新的验收记录应追加到本文件顶部，而不是写入 README.md。
- README.md 只保留当前可用的操作指南。
