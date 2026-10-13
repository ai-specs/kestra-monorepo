# Kestra monorepo

本仓组织 Kestra 部署及独立扩展项目，提供统一的 Docker Compose 配置。

| 项目 | 职责 |
|---|---|
| [kestra-overlay](https://github.com/ai-specs/kestra-overlay) | Kestra OSS 增强镜像、内置 OIDC 与 MCP、外部扩展承载 |
| [kestra-plugin-rbac](https://github.com/ai-specs/kestra-plugin-rbac) | 外部细粒度授权 jar、角色与权限配置 |

项目使用 git submodule 固定版本。克隆时运行：

```bash
git clone --recurse-submodules git@github.com:ai-specs/kestra-monorepo.git
cd kestra-monorepo
```

已有工作树使用 `git submodule update --init --recursive` 恢复本仓记录的版本。
独立扩展项目使用 `kestra-plugin-*` 名称，各自构建和发布。

复制 `.env.example` 为 `.env`，设置数据库密码、OIDC UI client secret，以及已通过
CI 的镜像 commit hash 标签或 OCI digest（`KESTRA_IMAGE`），运行：

```bash
docker compose up -d
```

访问 `http://localhost:8080/ui/` 完成首次安装。也可以在 `.env` 设置初始用户名与密码，
通过环境变量初始化；首次安装完成后变更初始化变量不会覆盖已有账号。
镜像来自私有 GHCR 包，拉取前需要使用具有 `read:packages` 权限的 GitHub 凭据登录。

数据库和安装凭据分别保存在 `postgres-data` 与 `kestra-data` 持久卷中。
任务插件放在 `deployment/plugins`，应用 classpath 扩展放在 `deployment/libs`。
jar 与配置变更需要重启。授权扩展的文件名和镜像兼容版本以插件项目说明为准。
`KESTRA_RBAC_ENABLED` 默认关闭，启用前需部署完整授权组件和权限配置。

Compose 提供显式的示例权限：可信 OIDC `admin`、`reader`、`writer` 角色分别映射到
部署角色，权限域为 `KESTRA_RBAC_NAMESPACE`（默认 `examples`）及其子 namespace。
reader 可读 flow，writer 可创建、更新和执行；admin 另可删除 flow 和管理 MCP server。
这些部署角色由 Compose 定义，首装 `admin` 声明只按这份配置取得权限。
其他 namespace 不自动开放；修改 `kestra.rbac` 配置后重启生效。
具体支持的 REST 路径、受限查询格式和输入/输出表达式范围以插件说明为准。

上游版本未更新时，`v2.0.5-no-plugins` 会被后续 overlay 构建复用。
本仓组合部署固定 commit hash 标签或 digest，避免本地旧镜像缓存造成版本混淆。
交付顺序为 overlay 镜像与契约就绪、插件独立构建 jar、本仓 Compose 组合验收。

OIDC/MCP 接入说明见 [镜像说明](kestra-overlay/README.md)。RBAC 安装与权限模型见
[授权插件说明](kestra-plugin-rbac/README.md)。

本次测试使用的镜像、插件 commit、jar hash 和结果见
[RBAC 验收记录](docs/rbac-acceptance.md)。`.env.example` 已固定该镜像 digest。

构建插件并安装到部署目录：

```bash
cd kestra-plugin-rbac
./scripts/prepare-host.sh ../kestra-overlay
./gradlew clean check
cd ..
cp kestra-plugin-rbac/build/libs/kestra-rbac-authorizer.jar deployment/libs/
```

将 `.env` 中 `KESTRA_RBAC_ENABLED` 设为 `true`，确认 namespace 与权限配置后运行
`docker compose up -d`。插件不支持的业务路径会返回 403，具体限制见插件 README。
