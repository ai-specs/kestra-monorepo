# Kestra monorepo

本仓组织 [Kestra](https://kestra.io) 部署及独立扩展项目，提供统一的 Docker Compose 配置。
本仓是可复用的部署与组合验收层，不限定于某一个扩展功能集。扩展的业务模型、
API、页面、配置和维护流程由对应 `kestra-plugin-*` 独立仓的 README 定义。

| 项目 | 职责 |
|---|---|
| [kestra-overlay](https://github.com/ai-specs/kestra-overlay) | Kestra OSS 增强镜像、内置 OIDC 与 MCP、外部扩展承载 |
| [kestra-plugin-rbac](https://github.com/ai-specs/kestra-plugin-rbac) | 外部细粒度授权 jar、应用组管理、应用声明元数据与 Kestra 实际策略 |

上表是当前已接入项目清单，不是扩展能力的封闭清单。RBAC 是当前第一个已验证的
扩展功能集，不是开发或部署其他扩展的前置依赖。

| 目标 | 阅读入口 |
|---|---|
| 不启用 RBAC，先部署宿主 | 下方快速开始与模式 A |
| 使用当前 RBAC 组合 | “选择是否启用 RBAC”及插件 README |
| 接入新的扩展功能集 | “接入其他扩展功能集”及 overlay README 的通用扩展接入指南 |
| 升级共同使用的宿主 | “已有安装升级与恢复验收” |

当前扩展清单与状态见 [扩展功能集清单](docs/extensions.md)。清单只记录接入状态、
仓库和正式产物入口；业务规则不复制到本 README。

---

## 快速开始

### 1. 克隆仓库

```bash
# macOS / Linux
git clone --recurse-submodules git@github.com:ai-specs/kestra-monorepo.git
cd kestra-monorepo
```

```powershell
# Windows PowerShell
git clone --recurse-submodules git@github.com:ai-specs/kestra-monorepo.git
cd kestra-monorepo
```

> 已有工作树缺少 submodule 时，运行 `git submodule update --init --recursive`。

### 2. 配置环境变量

```bash
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

编辑 `.env`，至少修改：

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 数据库密码，自行生成 |
| `KESTRA_OIDC_UI_CLIENT_SECRET` | OIDC UI client secret，自行生成 |
| `KESTRA_IMAGE` | overlay 镜像 digest（.env.example 已填入当前已验证的正式版本） |
| `KESTRA_OIDC_BOOTSTRAP_USERNAME` / `PASSWORD` / `EMAIL` | 可选；不填则首次启动后在 UI 手动创建账号 |

> 镜像来自私有 GHCR 包，拉取前需 `docker login ghcr.io -u <你的GitHub用户名>`，凭据需有 `read:packages` 权限。

### 关于 KESTRA_IMAGE

`KESTRA_IMAGE` 使用镜像 digest（`@sha256:...`）而非 tag，确保每次部署可复现。

`.env.example` 中固定的是本仓选定的正式宿主 digest，不自动跟随
宿主最新发布。更新前必须核对所有已启用扩展的公开契约、正式编译输入及组合结果：

```bash
# 查看 overlay 仓最新成功的 CI run
gh run list -R ai-specs/kestra-overlay --workflow <workflow-name> --limit 5

# 从成功 run 的产物中提取镜像 digest
gh run view -R ai-specs/kestra-overlay <run-id>
```

> ⚠️ 不要随意改用 `latest` tag 或未验证的候选 digest。digest 与插件 jar 的兼容性由 CI 验证保障。

### 3. 启动服务

```bash
docker compose up -d
```

### 4. 访问

打开浏览器访问 <http://localhost:8080/ui/>，完成首次安装。

---

## 目录结构

```
kestra-monorepo/
├── docker-compose.yml      # 编排：postgres + kestra
├── .env.example            # 环境变量模板
├── deployment/
│   ├── plugins/            # 任务插件（Kestra 自动加载）
│   └── libs/              # 应用 classpath 扩展（如 rbac jar）
├── kestra-overlay/        # submodule：宿主镜像
├── kestra-plugin-rbac/    # submodule：RBAC 插件
├── docs/                   # 需求与契约文档
└── scripts/                # 验收与辅助脚本
```

---

## 数据持久化

| 容器 | 持久卷 | 内容 |
|---|---|---|
| postgres | `postgres-data` | 数据库文件 |
| kestra | `kestra-data` | 内部存储（storage/queue） |

任务插件文件放在 `deployment/plugins/`，已登记的 classpath 扩展放在 `deployment/libs/`。
仅替换 jar 后需 `docker compose restart kestra` 重启 JVM；配置变更使用
`docker compose up -d` 更新容器配置。

## 接入其他扩展功能集

1. 将独立 `kestra-plugin-*` 仓作为本仓 submodule，并在
   [扩展清单](docs/extensions.md)登记状态和文档入口。业务及公开配置由扩展仓定义；
   接入通道、classpath 登记与 SPI/SDK 要求以宿主
   [扩展接入指南](https://github.com/ai-specs/kestra-overlay/blob/main/README.md#通用扩展接入指南)为准。
2. 取得与所选正式宿主兼容、已通过独立 CI 的扩展产物，核对 provenance 和 hash；
   按扩展说明为 Compose 增加挂载、配置或服务，同步非秘密环境变量说明。
   当前 Compose 只预置已接入组合，不提供任意 jar 自动发现或自动安装。
3. 为新组合增加生产流程验收，验证装载、真实登录、保存读回、允许/拒绝与副作用，
   以及适用的停用、缺组件、撤权和迁移；验证与其他已启用扩展同时运行的行为。
   本仓负责组合，宿主和扩展各自负责公共机制及业务/UI 的独立验收。

当前没有通用的任意扩展发布选择器。下方 `select-application-project-release.py`
及应用组验收脚本专用于 RBAC；新扩展必须提供自己的正式产物核验与集成用例，
不能将 RBAC 矩阵通过写成新扩展已验收。

---

## AMIS Apps：正式产物部署（P0 已交付）

AMIS Apps 的 P0 已通过根仓 `6030704` 的完整 44 项生产组合与全部 CI
`45865697765`，主控已实际下载核对报告。P1–P4 尚未交付，完整扩展接入状态仍待 P4。
独立宿主、插件 CI 或产物核验通过不能代替本仓后续阶段的组合通过。
以下步骤用于消费已经发布的正式产物，不使用候选值兜底；阶段交付仍须本仓组合验收。

文档按三层分工：本节负责镜像、jar、Compose 和更新；宿主
[扩展接入指南](https://github.com/ai-specs/kestra-overlay/blob/main/README.md#通用扩展接入指南)
负责公开承载机制；[AMIS Apps README](kestra-plugin-amis-apps/README.md)
负责 Flow、页面/schema、API 及权限契约。本节不复制权限模型或业务声明。

### 1. 核验正式选择并下载

正式选择由 `deployment/amis-apps-release.json` 维护，包含三个独立项目的提交、
不可变宿主和 AMIS artifact 镜像 digest、宿主 executable 与两个 jar 的 SHA-256，
以及精确 Java 测试数。缺失或与 root 已提交 gitlink、
`.env.example` 不一致时，预备器必须失败，不得手填示例 hash 绕过。

在本仓根目录执行。需要 Node.js 24、Python 3、JDK 25、Git、GitHub CLI、Docker
及 probe 编译脚本所需的 `curl`、`sha256sum`；公开 overlay/RBAC Actions 下载使用
已有 GitHub CLI 登录权限。私有 AMIS 只从正式 OCI 包下载，须先配置 GHCR
`read:packages` 访问权限（本地可执行 `docker login ghcr.io`），不克隆私有 AMIS 源码。

```bash
# macOS / Linux；每次使用尚不存在的输出目录，保留旧证据。
mkdir -p .work
node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
writeFileSync('.work/amis-install-options.json', JSON.stringify({
  directory: resolve('.work/amis-install-inputs'),
  selectionFile: resolve('deployment/amis-apps-release.json')
}), {mode: 0o600, flag: 'wx'});
JS
node scripts/prepare-amis-apps-acceptance.mjs .work/amis-install-options.json
```

预备器核对正式 OCI 的 source/publisher 和完整报告，下载并核对公开 RBAC 产物，
拉取固定宿主镜像，仅创建未启动容器提取 executable，随后移除该容器并编译根仓 probe。
它不启动 PostgreSQL 或 Kestra，不创建业务数据。成功结果保存在
`.work/amis-install-inputs/runner-options.json`；`prepared: true` 只表示输入准备通过。

### 2. 安装已核验 jar 并启用

首次部署先按快速开始准备 `.env` 的数据库密码及 UI client secret。下列命令再次核对
实际下载字节，将 AMIS jar 放入 Compose 已挂载的 `deployment/libs/`，并打印所选宿主：

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdirSync, copyFileSync} from 'node:fs';
const prepared = JSON.parse(readFileSync('.work/amis-install-inputs/runner-options.json'));
assert.equal(prepared.prepared, true);
const selected = prepared.selected;
const selection = JSON.parse(readFileSync('deployment/amis-apps-release.json'));
assert.equal(selected.hostImage, selection.hostImage);
assert.equal(selected.amisJarSha256, selection.amisJarSha256);
assert.equal(createHash('sha256').update(readFileSync(selected.amisJar)).digest('hex'), selection.amisJarSha256);
mkdirSync('deployment/libs', {recursive: true});
copyFileSync(selected.amisJar, 'deployment/libs/kestra-amis-apps.jar');
console.log('KESTRA_IMAGE=' + selected.hostImage);
JS
```

将打印的完整 `KESTRA_IMAGE=…@sha256:…` 写入 `.env`，设置
`KESTRA_AMIS_APPS_ENABLED=true`（默认 `false`）。不要使用 `latest` 或复用旧版本标签。
Compose 将 `deployment/libs/` 只读挂载到 `/app/libs`；AMIS jar 必须位于
`deployment/libs/kestra-amis-apps.jar`，不能放进任务插件目录。

| 模式 | jar 与配置 | 登录和授权准备 |
|---|---|---|
| A | `KESTRA_RBAC_ENABLED=false`；不安装、也不保留可装载的 RBAC jar | 使用宿主生产登录，仍执行认证和 CSRF 检查 |
| B | `KESTRA_RBAC_ENABLED=true`；安装同一 selection 对应的 RBAC jar | 通过既有 `kestra-ui` 运行时权限表，显式授予 AMIS entry 与目标 Flow 所需权限并关联用户 scope；按插件 README 配置 |

模式 B 使用上一步预备器取得的对应 RBAC jar，不能混用其他版本：

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, copyFileSync} from 'node:fs';
const {prepared, selected} = JSON.parse(readFileSync('.work/amis-install-inputs/runner-options.json'));
const selection = JSON.parse(readFileSync('deployment/amis-apps-release.json'));
assert.equal(prepared, true);
assert.equal(selected.hostImage, selection.hostImage);
assert.equal(selected.rbacJarSha256, selection.rbacJarSha256);
assert.equal(createHash('sha256').update(readFileSync(selected.rbacJar)).digest('hex'), selection.rbacJarSha256);
copyFileSync(selected.rbacJar, 'deployment/libs/kestra-rbac-authorizer.jar');
JS
```

模式 A 不执行上述 RBAC 复制命令；从模式 B 切换时，先将原 RBAC jar 移出挂载目录保存，
再更新配置。首装管理员不会自动获得 AMIS 入口能力，不能用管理员登录成功推断授权已配置。
按插件 README 保存 Flow 和 schema 后，使用其规范页面书签，经生产登录访问并验证提交结果。

```bash
docker compose pull kestra
docker compose up -d
```

变更 `.env` 或挂载配置后使用 `docker compose up -d` 更新容器；仅替换 jar 时必须执行
`docker compose restart kestra` 重启 JVM，才能装载新字节。保留所用 selection、provenance
和 hash；关闭 AMIS 时设置 `KESTRA_AMIS_APPS_ENABLED=false` 并更新容器。

### 3. 根仓组合验收入口

`scripts/run-amis-apps-p0.mjs` 消费 0600 options JSON：从预备器结果取得 `selected`、
`probeJar` 和 `rootDirectory`，另指定新的 `.work` 输出目录、端口 `18129`、
正式 `scripts/amis-apps-expected-http.json` 的 `expected`，以及真实浏览器适配参数。
CI 使用 Playwright 1.61.1 的绝对 module 路径，零授权拒绝文案取
`expected.zeroGrantDenialText`。expected 文件以宿主公开行为和独立基线调查固定预期，
不得从本次被测响应自动生成通过条件。
预备器的 `runner-options.json` 是输入准备结果，不能直接当作完整 runner 配置执行。

runner 创建自身独占的单个 PostgreSQL，串行验证 A/B，并在 `finally` 清理所创建资源；
不要让它与已有测试 Compose 并行运行。它不是用户部署启动命令。
根仓验收检查生产登录、真实保存读回、授权/撤权、拒绝无副作用及故障恢复；
独立插件负责主题/语言/窄屏等浏览器矩阵，本仓核验其正式报告，不重复完整视觉矩阵。
P0 基线必须完整保留 44 项。选择阶段为 `P1` 时，先执行同一正式 jar 的 P0 回归，
再执行 `scripts/run-amis-apps-p1.mjs` 的 A/B 共 24 项生产流程；不能用插件的控件
transport 报告代替本仓生产执行。P1 runner 同样消费 0600 options JSON，字段为
`directory`、`selected`、`probeJar`、`port` 和 `browser`，其中 `selected` 与 P0
来自同一次正式预备结果，`directory` 必须是新的根仓 `.work` 子目录。CI 依此顺序
串行执行，两门之间清理上一套 Compose，不并行启动第二个 PostgreSQL。

P1 根报告将真实浏览器凭据提交和签名身份，与独立数据库执行库存、输入、原生输出读回、
AMIS 结果及拒绝后至少 5 秒的内容摘要绑定。正式检查必须给
`scripts/check-amis-apps-p1-report.mjs` 传入报告、独立预期输入 JSON 和证据目录；
缺少附件、摘要不符、未运行或失败均不能通过。`scripts/stage-amis-p1-evidence.mjs`
只隔离可上传证据，不决定业务验收结果，也不发布私密配置或原始凭据。
只有所选阶段全部正式输入及对应根仓矩阵通过最终提交的 CI，才能更新阶段结论。

---

## 选择是否启用 RBAC

本仓支持两种部署模式，通过 `.env` 中的 `KESTRA_RBAC_ENABLED` 切换。
模式 A/B 只描述当前组合是否启用 RBAC，不是对所有未来扩展的分类。
两种模式使用相同的 `kestra-overlay` 镜像和宿主补丁。模式 A 不要求装载
`kestra-plugin-rbac` 插件 jar；模式 B 装载该 jar 并开启 RBAC。
模式 A 不是未应用 overlay 补丁的上游镜像。宿主修复必须兼容两种模式。

### 模式 A：不使用 RBAC（当前默认）

`.env` 中 `KESTRA_RBAC_ENABLED=false`（默认值）。

启动后流程：
1. `docker compose up -d`
2. 访问 `/oidc/setup` 创建管理员账号
3. 访问 `/oidc/login` 登录
4. 进入 `/ui/main/dashboards` 正常使用

无需任何额外操作。Kestra 标准 OIDC 认证可用，但不提供细粒度资源授权。

### 模式 B：使用 RBAC（自动首装）

Compose 默认关闭上游匿名用量与 UI 事件上报，使用
`kestra.anonymous-usage-report.enabled: false` 和
`kestra.ui-anonymous-usage-report.enabled: false`。这两个配置不影响 RBAC 授权或生产登录。

本仓当前选定插件提交 `3dc9999`，成功 CI run `45807161173`，正式 jar SHA-256：
`f549f3d66bd94169e2c828d4022e941f43fbfa73b312d2e7c05b240deb23849e`。
先安装并登录 GitHub CLI（`gh auth login`），账号须能读取插件仓 Actions artifact：

```bash
# macOS / Linux；在本仓根目录执行
mkdir -p .work/rbac-release deployment/libs
gh run download 45807161173 -R ai-specs/kestra-plugin-rbac \
  --name kestra-rbac-authorizer --dir .work/rbac-release
cp .work/rbac-release/build/libs/kestra-rbac-authorizer.jar deployment/libs/kestra-rbac-authorizer.jar
# macOS
shasum -a 256 deployment/libs/kestra-rbac-authorizer.jar
# Linux
sha256sum deployment/libs/kestra-rbac-authorizer.jar
```

```powershell
# Windows PowerShell；在本仓根目录执行
New-Item -ItemType Directory -Force .work/rbac-release, deployment/libs | Out-Null
gh run download 45807161173 -R ai-specs/kestra-plugin-rbac `
  --name kestra-rbac-authorizer --dir .work/rbac-release
Copy-Item .work/rbac-release/build/libs/kestra-rbac-authorizer.jar deployment/libs/kestra-rbac-authorizer.jar
(Get-FileHash deployment/libs/kestra-rbac-authorizer.jar -Algorithm SHA256).Hash.ToLower()
```

将命令输出与上方 SHA-256 比较；不匹配时不要启动。下载目录已存在文件时，先确认它们
是否属于同一正式 run，不覆盖其他版本。已有部署替换 jar 前保留旧正式文件和数据备份。

使用本仓选定的正式 overlay 镜像与兼容插件 jar。空数据库首次部署只需：

1. 从下方明确列出的成功插件 CI run 下载正式 artifact，将其中的
   `build/libs/kestra-rbac-authorizer.jar` 放到本仓 `deployment/libs/kestra-rbac-authorizer.jar`。
   按下方已核对的 SHA-256 验证文件；不编译宿主或插件。
2. 在 `.env` 中设置 `KESTRA_RBAC_ENABLED=true`。默认 UI scopes 保持原值，宿主自动补充应用组选择 scope。
3. 运行 `docker compose up -d`，打开 `http://localhost:8080/ui/`。
4. 在首装页阅读“已启用细粒度访问控制”提示，填写账号并创建。账号、应用组、初始权限及首账号授予在一个事务中完成，不需要 JSON 或 Java CLI。
5. 使用新账号登录，进入 dashboard；从导航进入访问控制管理，复核初始 `main` 应用组及 `admin` scope。

RBAC 首装授权、权限表达式、账号生命周期和管理页面行为由插件仓维护；本仓只保留部署步骤与组合验收入口。详见 [插件 README](kestra-plugin-rbac/README.md) 和 [RBAC 首次安装体验](docs/rbac-onboarding-experience.md)。

缺 jar 时，首装页显示明确的下载与放置位置并阻止创建半成品账号。补放 jar 后运行
`docker compose restart kestra`，原页面会自动等待恢复并重新获取表单；不会存储密码或自动重放创建请求。
正常在启动前已放好 jar 的首装全程无需重启。

已经完成安装的数据库不会再次开放首装或自动补授管理员。不得删除安装凭据或清空用户来重复首装；已有部署按插件公开维护流程处理，先保护原数据。

> 当前正式宿主 `1765441` 的 CI `45795525445` 五个 job 成功，镜像由 `.env.example` 固定。
> 插件 `3dc9999` 消费该正式宿主输入，CI `45807161173` 成功且实际 artifact 已下载审计；
> 后端337、PostgreSQL115（含声明升级9）、生命周期30、页面960均通过，部署前核对 jar 哈希。
> 根仓 CI 独立验证正式组合的生产流程、授权范围与副作用；不能用独立仓 CI 代替。
> AI 入口需要显式租户 READ/EXECUTE；普通资源的全域读取不隐含执行、输出或租户级功能授权。

权限模型和表达式规则不在部署 README 重复维护，统一以插件 README 的“权限表达式规则”为准。

---

## 验收测试

以下是当前 RBAC 组合的完整验收入口，不是任意扩展的通用验收命令。
macOS / Linux 执行；GitHub CLI 须能读取对应两个独立仓的 Actions：

```bash
# 安装与 CI 相同的浏览器驱动；Linux 系统依赖可使用 install --with-deps chromium。
npm install --prefix .work/ci-browser playwright@1.61.1
.work/ci-browser/node_modules/.bin/playwright install chromium
export NODE_PATH="$PWD/.work/ci-browser/node_modules"
# 使用尚不存在的目录，避免覆盖旧报告。脚本按当前 submodule HEAD 选择成功的正式 CI。
mkdir -p .work/compose-release
sed -n 's/^KESTRA_IMAGE=//p' .env.example > .work/compose-release/image
python3 scripts/select-application-project-release.py .work/compose-release
KESTRA_IMAGE=$(cat .work/compose-release/image)
JAR_SHA256=$(python3 -c 'import json; print(json.load(open(".work/compose-release/release-evidence.json"))["jarSha256"])')
./scripts/blackbox-application-projects.sh --run --browser ci \
  --image "$KESTRA_IMAGE" \
  --jar .work/compose-release/plugin-artifact/build/libs/kestra-rbac-authorizer.jar \
  --sha256 "$JAR_SHA256" --release-evidence .work/compose-release/release-evidence.json \
  --root "$PWD" --overlay "$PWD/kestra-overlay" --plugin "$PWD/kestra-plugin-rbac"
```

此入口要求三仓干净，使用正式镜像与实际下载的正式 jar；只运行一套验收 Compose。
开始前停止已有本地测试 Compose，保留其卷；不要同时运行另一套 PostgreSQL。
macOS 长时间本地验收时，在验收命令前加 `caffeinate -dimsu`，使防睡眠只持续到该命令结束。
本机睡眠会暂停浏览器和 Docker，恢复后产生的传输超时不能作为授权通过或失败的证据。
`.work/compose-release` 已有下载时，改用新目录并相应替换上述路径，不删除旧证据。
默认执行 `new-install` 及必需的 schema2 declaration-upgrade 门；没有显式选择
`legacy-migration` 时，不运行 schema1、旧凭据与物理回滚，也不将其计为通过。

> 该脚本为 bash 脚本，Windows 上需在 Git Bash 或 WSL 中运行。需要 Docker Compose 2.24.4+、JDK 25、Node.js 24、Python 3、GitHub CLI。

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/application-group-target-model.md](docs/application-group-target-model.md) | 应用组概念模型 |
| [docs/rbac-ui-contract.md](docs/rbac-ui-contract.md) | RBAC UI 授权契约 |
| [docs/access-control-ui-requirements.md](docs/access-control-ui-requirements.md) | 访问控制管理 UI 需求规格 |
| [docs/rbac-onboarding-experience.md](docs/rbac-onboarding-experience.md) | RBAC 首次安装使用流程与验收条件 |
| [docs/amis-apps-requirements.md](docs/amis-apps-requirements.md) | AMIS Apps 扩展功能集需求基线 |
| [docs/upstream-upgrade-acceptance.md](docs/upstream-upgrade-acceptance.md) | 上游升级、正式输入与模式 A/B 一致恢复验收 |
| [docs/rbac-acceptance.md](docs/rbac-acceptance.md) | 组合验收记录（历史） |
| [implementation-gap-report.md](implementation-gap-report.md) | 实施差异报告（历史） |
| [deprecated.md](deprecated.md) | 已归档的历史验收记录 |

### 已有安装升级与恢复验收

上游版本升级除默认新安装门外，还必须执行已有安装的真实升级与一致恢复。
影响评估脚本、固定升级规则和 AI 任务模板归宿主仓 `scripts/assess-upstream-upgrade.py`、
`AGENTS.md` 与 `docs/upstream-upgrade-agent.md`。评估输出只提供证据，不替代主控逐项裁决。
运行入口、正式产物验证和模式 A/B 输入见
[上游升级组合验收](docs/upstream-upgrade-acceptance.md)。该入口使用已有 PostgreSQL
中的独立测试数据库，不修改用户部署，不把只更换旧镜像称为回滚。
当前 v2.0.13 正式宿主由 `.env.example` 固定，插件采用上方模式 B 的正式输入。
历史 `feb817c` / `71ec20c` 升级记录不作为本轮版本锁。根仓 CI 分别执行生产组合 job 和独立升级 job；
升级 job 以已发布的 v2.0.11 组合为起点，串行执行模式 A、B 的真实升级与一致恢复。
必须核对对应最终提交下载报告中的19阶段、发布输入和资源清理；脚本或离线测试
存在不能替代真实结果。升级前已有的全部适用 CI 门必须通过，新增 bug 回归不能
代替原有回归。

Playground 卡灰的 v2.0.11 复现记录保留为历史。当前 v2.0.13 的结论按正式镜像及
插件的真实浏览器交互、执行结果和按钮恢复判定，见
[Playground 缺陷说明](docs/playground-run-task-stuck-disabled.md)。升级 CI 成功不能
单独证明某一缺陷已修复。
