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
| `KESTRA_IMAGE` | 已发布的 overlay 镜像 digest（.env.example 已填入当前正式版本） |
| `KESTRA_OIDC_BOOTSTRAP_USERNAME` / `PASSWORD` / `EMAIL` | 可选；不填则首次启动后在 UI 手动创建账号 |

> 镜像来自私有 GHCR 包，拉取前需 `docker login ghcr.io -u <你的GitHub用户名>`，凭据需有 `read:packages` 权限。

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

### 模式 B：使用 RBAC（当前手动流程）

`.env` 中 `KESTRA_RBAC_ENABLED=true`。当前需要手动完成以下步骤：

1. **下载插件 jar**：从 `kestra-plugin-rbac` 仓库的 CI 成功构建中下载
   ```bash
   gh run download -R ai-specs/kestra-plugin-rbac <成功构建的run-id> \
     --name kestra-rbac-authorizer --dir /tmp/kestra-rbac-artifact
   ```
   ```powershell
   # Windows PowerShell
   gh run download -R ai-specs/kestra-plugin-rbac <成功构建的run-id> `
     --name kestra-rbac-authorizer --dir $env:TEMP\kestra-rbac-artifact
   ```

2. **放置 jar**：将 jar 复制到 `deployment/libs/kestra-rbac-authorizer.jar`

3. **修改 .env**：
   ```
   KESTRA_RBAC_ENABLED=true
   KESTRA_OIDC_UI_SCOPES=openid,profile,email,kestra:application-group-scopes
   ```

4. **初始化数据库**：在 JVM 运行时执行插件安装 CLI（详见插件 README）
   - `ApplicationGroupDirectoryCommand preview/apply`
   - `ApplicationGroupPolicyCommand initialize`

5. **重启容器**：`docker compose up -d`

> ⚠️ 如果未完成第 4 步就启用 RBAC，所有请求将被 fail-closed 拒绝，页面无法登录。

启用后管理页面位于 `/ui/main/extensions/rbac`。

### 目标体验：自动化 RBAC 初始化（规划中）

> **状态：提案，未实现**
>
> 目标是让模式 B 的流程自动化：`/oidc/setup` 页面自动检查 jar 是否存在、
> 缺失时阻断并提示、创建账号时自动完成数据库初始化，无需手动执行 CLI
> 和重启容器。

详细的改造方案、三个项目各自的改造面和技术决策点见：
[docs/rbac-onboarding-experience.md](docs/rbac-onboarding-experience.md)

| 项目 | 改造职责 |
|---|---|
| kestra-overlay | setup 页面 jar 检查、RBAC 提示、初始化钩子 |
| kestra-plugin-rbac | 暴露运行时初始化 API、幂等状态查询 |
| kestra-monorepo | README 文档、.env 模板 |

---

## 终端代理（如拉取境外仓库需要）

如果你的网络需要代理才能访问 GitHub / GHCR，按你的 shell 配置：

```bash
# macOS / Linux (zsh/bash) — 加入 ~/.zshrc
function proxy_on() {
    export http_proxy=http://127.0.0.1:7897
    export https_proxy=http://127.0.0.1:7897
    export all_proxy=socks5h://127.0.0.1:7897
    echo "✅ 终端代理已开启"
}
function proxy_off() { unset http_proxy https_proxy all_proxy; echo "❌ 终端代理已关闭" }
```

```powershell
# Windows PowerShell — 加入 $PROFILE
function proxy_on {
    $env:http_proxy  = "http://127.0.0.1:7897"
    $env:https_proxy = "http://127.0.0.1:7897"
    $env:all_proxy   = "socks5h://127.0.0.1:7897"
    Write-Host "✅ 终端代理已开启"
}
function proxy_off {
    Remove-Item Env:http_proxy, Env:https_proxy, Env:all_proxy -ErrorAction SilentlyContinue
    Write-Host "❌ 终端代理已关闭"
}
```

> 端口 `7897` 对应 Clash Verge Rev 默认混合端口。其他代理工具按实际端口修改。

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
| [docs/rbac-onboarding-experience.md](docs/rbac-onboarding-experience.md) | RBAC 首次安装体验改造提案（规划中） |
| [docs/rbac-acceptance.md](docs/rbac-acceptance.md) | 组合验收记录（历史） |
| [implementation-gap-report.md](implementation-gap-report.md) | 实施差异报告（历史） |
| [deprecated.md](deprecated.md) | 已归档的历史验收记录 |
