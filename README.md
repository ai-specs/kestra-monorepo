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

Compose 将可信 OIDC `admin` 映射到 `deployment-admin`，并通过
`instance-admin-roles: [deployment-admin]` 授予实例管理员权限。首次安装创建的用户
具有可信 `admin` 角色。RBAC 开启后，该用户可以访问宿主已有的全部业务 API，
不受 namespace 范围、普通角色 API 白名单和保守表达式策略限制。
实例管理员仍须通过认证、CSRF 与独立的 MCP OAuth scope 检查；授权 jar 缺失时仍失败关闭。
这项授权不会增加宿主没有实现的 EE 功能，也不会改变 OIDC client 的用户归属。

可信 `reader`、`writer` 分别映射到普通部署角色，其权限域为
`KESTRA_RBAC_NAMESPACE`（默认 `examples`）及其子 namespace。
reader 配置 Flow、Execution、Namespace、Log、Metric、Trigger、KV 和 Namespace File
的只读权限。writer 配置 Flow 创建、更新、执行、删除，以及 KV/file 写入权限。
Compose 同时启用 typed 宿主适配配置；实际 RBAC 总开关仍由 `KESTRA_RBAC_ENABLED` 控制。
普通角色未支持的 API 返回 403。当前固定组合的普通角色与管理员真实浏览器、Compose
及根仓 CI 验收通过，版本和检查范围见验收记录。
修改角色或权限配置后运行 `docker compose up -d` 更新容器配置。

上游版本未更新时，`v2.0.5-no-plugins` 会被后续 overlay 构建复用。
本仓组合部署固定 commit hash 标签或 digest，避免本地旧镜像缓存造成版本混淆。
交付顺序为 overlay 镜像 CI 与扩展契约检查通过、插件独立构建 jar、本仓 Compose 组合验收。

OIDC/MCP 接入说明见 [镜像说明](kestra-overlay/README.md)。RBAC 安装与权限模型见
[授权插件说明](kestra-plugin-rbac/README.md)。

历史测试使用的镜像、插件 commit、jar hash 和结果见
[RBAC 验收记录](docs/rbac-acceptance.md)。该记录不验证当前 `.env.example` 的组合。
当前 typed 组合的本地真实浏览器与 Compose CI 结果也记录在同一文档。
更换镜像或 jar 后必须重新执行受影响验收，历史结果不验证其他组合。

将 `KESTRA_IMAGE` 导出为 `.env.example` 中的固定 digest，核对 jar SHA-256，
再运行组合验收。需要 Docker、JDK 25、Node.js 和 ego-browser；复用本次创建的浏览器任务空间：

```bash
./scripts/blackbox-rbac.sh "$KESTRA_IMAGE" deployment/libs/kestra-rbac-authorizer.jar <jar-sha256>
BB_RBAC_EGO_SPACE=<本次浏览器任务空间ID> ./scripts/blackbox-namespace.sh "$KESTRA_IMAGE" deployment/libs/kestra-rbac-authorizer.jar <jar-sha256>
```

测试使用独立 Compose 项目和受控账号，不使用用户部署数据。普通角色矩阵覆盖 reader、
writer、多角色和 exact namespace；管理员检查包含 RBAC 开启、关闭、CSRF、缺 jar 和真实
菜单/页面/写操作。根仓 CI 固定相同角色页面用例，使用真实 Chromium，并要求夹具无跳过。

构建插件并安装到部署目录：

```bash
cd kestra-plugin-rbac
./scripts/prepare-host.sh
./gradlew clean check
cd ..
cp kestra-plugin-rbac/build/libs/kestra-rbac-authorizer.jar deployment/libs/
```

将 `.env` 中 `KESTRA_RBAC_ENABLED` 设为 `true`，确认 namespace 与权限配置后运行
`docker compose up -d`。这使用已经发布的镜像启动容器，不构建镜像。普通角色未支持的业务路径会返回 403；实例管理员可访问宿主已有业务 API，具体规则见插件 README。

也可以直接下载插件 CI 的构建产物，解压后将 `kestra-rbac-authorizer.jar` 放入
`deployment/libs/`，无需本地安装 JDK 或编译：

```bash
gh run download -R ai-specs/kestra-plugin-rbac <成功构建的 run-id> \
  --name kestra-rbac-authorizer --dir /tmp/kestra-rbac-artifact
cp /tmp/kestra-rbac-artifact/build/libs/kestra-rbac-authorizer.jar deployment/libs/
```

下载目录包含 jar、编译契约 provenance 与测试报告；取其中的 jar 放入部署目录。
选择的插件构建须声明兼容 `.env` 所指定镜像，查看该构建对应的 `host-contract.properties`。
仅替换 jar、没有修改配置时，执行 `docker compose restart kestra` 重启容器中的 JVM，
让它装载新 jar。这不会重新编译 Kestra，也不会构建或发布 overlay 镜像。
