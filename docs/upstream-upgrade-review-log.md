# 上游升级评审记录

本文件是辅助 agent 向主控转交评审意见的固定通道。每轮升级一节，每次提交单独成一个 commit。
意见不构成裁决。主控核对证据后自行决定是否采纳，可以在“主控处置”一节写结论。

## 2026-11-24：v2.0.5 → v2.0.11

- 主控：Codex。辅助：ZCode。
- 核对时点：19:17。主控当时的进度是开发树的 63 个补丁已逐个提交，webserver 编译通过，
  定向测试从 5 个失败降到 2 个（`targeted-02`），`targeted-03` 正在运行。
- 辅助只做只读核查。辅助没有修改三仓的补丁、脚本、工具和主控的未提交文件。
  辅助在三仓里只提交了本文件，没有推送，没有触发 CI。

### 1 独立核实且与主控一致的事实

| 事项 | 主控的结论 | 辅助独立核算 |
|---|---|---|
| v2.0.11 标签指向的提交 | `dde805a2…` | 相同 |
| 上游变更文件 | 522（完整 `git diff`） | 522 |
| 补丁触达文件与上游重叠 | 43 | 43 |
| 真实冲突的补丁 | 9 个已逐个适配 | 相同的 9 个；另有 0240、0340、0393 放宽上下文即可应用 |
| 评估脚本的输出 | 6 应用、1 失败、56 阻塞 | 不矛盾：56 个是阻塞，不是独立冲突 |

辅助在 19:14 看到过 `McpSessionLifecycleTest` 的 5 个失败。辅助读了 `mcp-session-final.diff`
和测试里的仓库替身，没有发现归属判断、队列监听或监听器注销上的问题，没有额外线索。

### 2 建议主控核对的事项

**A. 模式 B 的执行操作回归（建议本轮处理）**
上游给 `ExecutionController.awaitBlockingAction` 增加了显式的 `tenantId` 参数（提交 7890163、2e4cb8b）。
方法注释写明原因：读过请求体的调用方可能运行在没有绑定服务请求的线程上。
0280 规定缺少授权上下文必须失败关闭。
建议在模式 B 下回归创建、重放、重启、暂停、恢复和终止操作，确认不会被误拒。
证据：上游 `ExecutionController.java` 在 v2.0.5 与 v2.0.11 之间的差异。

**B. 翻译指纹（建议本轮处理）**
上游改了 `ui/scripts/translations/` 下的 6 个文件，包括 `generate.ts`、`generateTranslations.ts`、`usageRules.ts`。
0220、0340、0390、0391、0405 同时改了语言文件，0391、0405 改了 `fingerprints.json`。
overlay 的 `AGENTS.md` 规定不得手工伪造生成指纹。
建议在新基线上用上游的工具重新生成指纹，再运行 `translations:check`。

**C. `test:unit` 的参数叠加（建议本轮处理）**
上游把 `test:unit` 改成带 `--reporter=default --reporter=junit --outputFile.junit=…` 的命令。
`scripts/build.sh` 与 `scripts/local-ci.sh` 调用它时又追加
`--reporter=default --reporter=json --outputFile=build/reports/ui-extension-tests.json`。
建议确认 JSON 报告仍然生成，`check-ui-extension-tests.py` 仍能读取。

**D. 插件与根仓的钉版（宿主正式发布后处理）**
- 插件 `build.gradle` 写死了 `micronaut-platform:4.10.18` 和 `jackson-dataformat-yaml:2.22.1`。
  上游 v2.0.11 是 `4.10.22` 和 `2.22.3`。
- 根仓 `scripts/` 有 24 个硬编码数量门，例如 `sdkGate.passed=949`、`current.checks=64`、
  `pluginUiExpectedIds.length=960`。语言文件集和 design-system 组件源码在这次升级里基本没变，
  这些数字预计不变，以实际结果为准。

**E. `local-ci.sh` 与 `build.sh` 不会拉取新标签**
两个脚本只在验证树不存在时克隆。BASE 改成 v2.0.11 后，旧的 `.work/verify` 没有新提交，`reset` 会失败。
主控现在用的是独立的 `.work/upstream-2.0.11/dev`，不受影响。后面如果改用 `local-ci.sh`，需要新建验证树。

**F. manifest 与 README 的状态对账**
`patches/manifest.tsv` 的 63 行里有 20 行、`README.md` 有 37 行仍标着“候选、未发布”，
而提交 `434955d` 的 CI `45104521508` 已经成功。同步文档时建议一并纠正，
避免把已发布的补丁当成候选处理。

**G. 命名空间匹配的写法（低优先级，可以不改）**
上游新增了 `CaseSensitiveMatch`，把子树匹配改成区分大小写的写法。这个类只对 MySQL 方言生效，
其他方言原样输出。overlay 的精确匹配和 0401 的 DNF 路径仍用 `column.eq` 与 `column.startsWith`
（`AbstractJdbcRepository.java` 第 127–131 行、`AbstractJdbcLogDataStore.java` 第 612–616 行）。
在 PostgreSQL 上两种写法行为相同。overlay 的自有迁移只有 postgres 版本，所以当前没有实际影响。

**H. `IMAGE_BASE`**
建议这次升级不改。当前钉住的摘要与上游的 `latest-slim` 已经不同，需要更新时单独提交并核验双架构。

### 3 可以结案的项

**plugin-auto-install 迁移。** 上游只把 `V2_0_11PluginAutoInstallMigration.migrate()` 的方法体
包进了 try/catch，让迁移不再抛异常。`isEnabled()` 仍是第一道判断。
部署基线关闭自动安装时直接跳过，没有新的副作用。

### 4 需要维护者裁决

- **目标版本。** v2.0.12 已在 11-20 发布，但没有标为 Latest。它比 v2.0.11 多 155 个变更文件，
  含租户守卫、命名空间正则转义、Element Plus 复选框传值等修复。
- **Playground 缺陷。** 根仓 `docs/playground-run-task-stuck-disabled.md` 写着“跟随升级上游即可解决”。
  这个修复只在 v2.0.12 里，`ui/src/stores/playground.ts` 在 v2.0.11 与 v2.0.5 完全相同。
  文档引用的两个提交在 develop 上，不在任何 release 标签里。

### 5 对可复用评估工具的建议（不影响本轮）

`scripts/assess-upstream-upgrade.py` 的来源管控很严谨。补上下列能力后，下一轮可以一次看全冲突面。

| 能力 | 作用 | 参考函数 |
|---|---|---|
| 继续模式 | 失败的补丁用 `--reject` 应用，失败文件归类为“上游改动”或“连锁” | `trial_apply`、`collect_rejects` |
| 补丁块内被上游改动的行 | 找出文本能应用但语义漂移的位置 | `in_hunk_changes` |
| 吸收证据 | 统计补丁新增的行有多少已经在上游 | `absorbed_ratio` |
| 编译漂移候选 | 找出上游改写的方法声明 | `api_drift` |
| 接口面与构建变化 | 路由、过滤器、迁移、依赖钉版、npm script | `route_changes`、`gradle_pins` |
| 生成带编号的待办 | agent 的直接输入 | `build_checklist` |

本轮实测：51 个补丁干净，3 个放宽上下文可应用，9 个需要人工推导，24 个被拒绝的补丁块。

提示词建议独立成文，不由脚本生成，这样修改提示词不必改动脚本和它的测试。
升级提示词的草稿在 `.work/upgrade-2.0.11-assist-review/UPGRADE-PROMPT.md`。

### 6 交付一致性检查

`.work/upgrade-2.0.11-assist-review/upgrade-delivery-check.py` 是只读检查，一条命令核对 16 项：
overlay 的 BASE 与 HEAD、三个发布标签的摘要、插件的宿主契约与依赖钉版、
根仓的镜像摘要与子模块指针、本机环境。它需要 GHCR 登录和 `gh` 认证。

```bash
python3 .work/upgrade-2.0.11-assist-review/upgrade-delivery-check.py kestra-overlay kestra-plugin-rbac .
```

辅助在当前正式交付上校准过：14 项通过，2 项失败。失败的原因是三仓有未提交的进行中改动，
不是现有交付不一致。

### 7 辅助没有做的事

- 没有运行编译和测试。
- 两个参考脚本没有单元测试。评估脚本需要联网并配置代理。
- 没有修改主控的任何文件。

### 8 参考文件的 SHA-256

目录：`.work/upgrade-2.0.11-assist-review/`（未入库）。

| 文件 | SHA-256 |
|---|---|
| `upgrade-assess.py` | `b7c50eec5b45369bf92612dd81d43815eae3435a307afb91f12a9fc09d4b71eb` |
| `upgrade-delivery-check.py` | `8a4d11c7376f696f467e9e130a6003d0313739da006a0d3c5016f26f239327c9` |
| `UPGRADE-PROMPT.md` | `aa4042486a2d851419aa6f715317af274a0019836398fe73baaa69fbb71bec3f` |
| `assess-v2.0.11/assess.json` | `6a8293b0bca0466486b9d66fb131966daa70ed06afcbbb30fd23e3102eb64dc2` |
| `assess-v2.0.11/assess.md` | `cdd0a528586dea638e5c88cf1ebec9ce9ad466643f270416b6da6b59bc7ba5c1` |

### 9 主控处置

| 编号 | 处置（采纳、不采纳、待定） | 理由或证据 |
|---|---|---|
| A | | |
| B | | |
| C | | |
| D | | |
| E | | |
| F | | |
| G | | |
| H | | |
| 第 3 节 | | |
| 第 5 节 | | |
| 第 6 节 | | |
