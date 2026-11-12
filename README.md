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

本仓当前选定插件提交 `a4a725c`，成功 CI run `43213408320`，正式 jar SHA-256：
`42b901a4b51ea53b9540aeeb87a7056ee7a223ff2ca286aee14265bbdda4bb0c`。
先安装并登录 GitHub CLI（`gh auth login`），账号须能读取插件仓 Actions artifact：

```bash
# macOS / Linux；在本仓根目录执行
mkdir -p .work/rbac-release deployment/libs
gh run download 43213408320 -R ai-specs/kestra-plugin-rbac \
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
gh run download 43213408320 -R ai-specs/kestra-plugin-rbac `
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

首账号通过初始策略中的 `BUSINESS_INSTANCE.READ/MANAGE` 获得明确业务实例权限，
按固定资源与动作映射执行；`company` 及子空间是默认示例与模式 A/B 的共同测试范围，
不是该账号全部业务权限的上限。管理授权、精确动作与修改方法见插件 README。
账号名不产生管理员权限，普通后续账号不自动继承首账号授权。

缺 jar 时，首装页显示明确的下载与放置位置并阻止创建半成品账号。补放 jar 后运行
`docker compose restart kestra`，原页面会自动等待恢复并重新获取表单；不会存储密码或自动重放创建请求。
正常在启动前已放好 jar 的首装全程无需重启。

已经完成安装的数据库不会再次开放首装或自动补授管理员。不得删除安装凭据或清空用户来重复首装；已有部署按插件公开维护流程处理，先保护原数据。

> 宿主 c4a1eb22/CI41628600618、插件 6ec194ad/CI41638334994 已分别通过独立发布门。
> 当前宿主 `c3fe848` 的 CI `43202366854` 与插件 `a4a725c` 的 CI `43213408320`
> 均成功。正式镜像已发布，插件 jar 须从上文 artifact 入口下载核对。本次根仓最终组合与对应提交 CI 结果另行验收；
> 历史组合记录不能替代本次新增执行订阅流程。

普通资源 grants 按其命名空间、资源及动作求值；显式业务实例管理 grants 按固定映射求值。
管理员可以在访问控制页面复核和修改初始策略，撤销相应授权后不保留首账号特权。
详细边界与验收条件见 [RBAC 首次安装体验](docs/rbac-onboarding-experience.md)。

---

## 验收测试

完整组合验收入口：

```bash
./scripts/blackbox-application-projects.sh --run --browser ci \
  --image "$KESTRA_IMAGE" \
  --jar deployment/libs/kestra-rbac-authorizer.jar \
  --root "$PWD" --overlay "$PWD/kestra-overlay" --plugin "$PWD/kestra-plugin-rbac"
```

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
