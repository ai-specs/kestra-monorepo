# Kestra monorepo

本仓组织 [Kestra](https://kestra.io) 部署及独立扩展项目，提供统一的 Docker Compose 配置。

| 项目 | 职责 |
|---|---|
| [kestra-overlay](https://github.com/ai-specs/kestra-overlay) | Kestra OSS 增强镜像、内置 OIDC 与 MCP、外部扩展承载 |
| [kestra-plugin-rbac](https://github.com/ai-specs/kestra-plugin-rbac) | 外部细粒度授权 jar、应用组管理、应用声明元数据与 Kestra 实际策略 |

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

`.env.example` 中固定的 digest 对应 `kestra-overlay` 仓库最近一次 CI 全绿并完成推广的构建。随 overlay 仓迭代，新的验证通过后更新此值：

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

插件文件放在 `deployment/plugins/`，classpath 扩展放在 `deployment/libs/`。jar 或配置变更后需 `docker compose restart kestra` 重启 JVM。

---

## 选择是否启用 RBAC

本仓支持两种部署模式，通过 `.env` 中的 `KESTRA_RBAC_ENABLED` 切换。
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

本仓当前选定插件提交 `594cfec`，成功 CI run `45167220275`，正式 jar SHA-256：
`918b5eb892ee8511360288ceaa0aadc99b29128c2d35ae5a4f8deb44b6385fef`。
先安装并登录 GitHub CLI（`gh auth login`），账号须能读取插件仓 Actions artifact：

```bash
# macOS / Linux；在本仓根目录执行
mkdir -p .work/rbac-release deployment/libs
gh run download 45167220275 -R ai-specs/kestra-plugin-rbac \
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
gh run download 45167220275 -R ai-specs/kestra-plugin-rbac `
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

首账号通过普通资源权限明细获得 `company` 及子空间的写入权限，并通过
`namespace: "!company", descendants: true` 获得其补集的 READ/LIST 权限。
因此可以查看所有命名空间的 Flow、KV 等普通资源，但不得在 `company` 范围外创建、
修改或删除。补集是一条明确的允许范围，不是覆盖其他正向授权的全局拒绝。
`company2` 不属于 `company` 子空间。账号名不产生管理员权限，后续账号不自动继承授权。
旧 `BUSINESS_INSTANCE` 记录不再授予普通资源权限；已有部署必须显式复核普通资源 grants，
不会自动扩大授权。管理授权和精确动作见插件 README。

缺 jar 时，首装页显示明确的下载与放置位置并阻止创建半成品账号。补放 jar 后运行
`docker compose restart kestra`，原页面会自动等待恢复并重新获取表单；不会存储密码或自动重放创建请求。
正常在启动前已放好 jar 的首装全程无需重启。

已经完成安装的数据库不会再次开放首装或自动补授管理员。不得删除安装凭据或清空用户来重复首装；已有部署按插件公开维护流程处理，先保护原数据。

> 当前正式宿主 `434955d` 的 CI `45104521508` 五个 job 成功，镜像 digest
> `2ca77ebb0f2318f809741c89e5057e677555a010499645d7a731f22fa9f94aa9` 已推广并下载审计。
> 插件 `594cfec` 消费该正式宿主输入，CI `45167220275` 成功；本提交 artifact 须按上方命令下载，
> 后端324、PostgreSQL113、生命周期30、声明升级9及页面960全部通过；部署前核对 jar 哈希。
> 根仓 CI 独立验证正式组合的生产流程、授权范围与副作用；不能用独立仓 CI 代替。
> AI 入口需要显式租户 READ/EXECUTE；普通资源的全域读取不隐含执行、输出或租户级功能授权。

权限明细优先显示表达式，仅补集等容易误解的部分提供悬停或键盘聚焦解释。同一权限key的
明细在其他条件一致时合并显示；合并资源前缀要求后续动作集合与ID范围相同。原始多条grant
仍受支持，不改变保存格式或授权行为。

受限账号应通过已获授权页面的书签进入。登录前访问目标、认证重定向及回调目标必须实际
核对；不得通过登录后手动改路径掩盖丢失书签的问题。原 URI 保留机制已在宿主
`d3247f9` / CI `44407072165` 正式发布，列表有限能力已在 `86e4365` /
CI `44423330738` 正式发布。宿主首屏与详情修复及插件兼容输入均已发布；本仓 CI 仍须独立验证生产组合，
不能用宿主单仓成功代替。

普通资源 grants 按其命名空间、资源及动作求值。管理员可以在访问控制页面复核和修改
初始策略，撤销授权后不保留首账号特权。
详细边界与验收条件见 [RBAC 首次安装体验](docs/rbac-onboarding-experience.md)。

---

## 验收测试

完整组合验收入口（macOS / Linux；GitHub CLI 须能读取两个独立仓的 Actions）：

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
| [docs/rbac-acceptance.md](docs/rbac-acceptance.md) | 组合验收记录（历史） |
| [implementation-gap-report.md](implementation-gap-report.md) | 实施差异报告（历史） |
| [deprecated.md](deprecated.md) | 已归档的历史验收记录 |
