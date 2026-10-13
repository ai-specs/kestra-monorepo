# Monorepo 组织约定

本仓负责跨项目版本组合、`docker-compose.yml`、部署配置和集成验收。
`kestra-overlay` 与 `kestra-plugin-*` 是独立 Git 仓库，以 git submodule 引用；
各仓实现、构建和发布归各仓，提交后再更新本仓 gitlink。

新增独立扩展仓统一使用 `kestra-plugin-*` 名称。RBAC 业务权限模型属于
`kestra-plugin-rbac`；overlay 只承载其必要的扩展 SPI、授权激活点和 jar 承载机制。
修改 submodule 内容时遵守该仓自己的 AGENTS.md。

部署凭据放在被忽略的 `.env`；jar 放在被忽略的 `deployment/libs` 或
`deployment/plugins`。不要提交凭据、jar、上游源码或本地验证树。

交付须验证独立仓构建及 monorepo Compose 配置，并以真实镜像检验跨仓授权行为。
安全行为测试必须包含拒绝和无副作用断言。CI 失败或覆盖缺口未闭环时不得宣称完成。

交付顺序固定为 overlay 镜像构建、扩展契约检查及 CI 通过 → 扩展仓独立构建 jar →
本仓 `docker-compose.yml` 组合与验收。overlay CI 不读取或构建业务扩展仓，
跨仓集成脚本放在本仓 `scripts/`。镜像固定 CI 验收后的 commit hash 标签或 digest，
不要用滚动复用的上游版本标签作为新改动验收依据。

对外交付前，必须以独立 checkout 执行 README 的构建命令，验证无需相邻源码仓、
未提交文件或历史工作目录。插件只能消费已发布的宿主编译产物或镜像。
部署步骤和开发辅助步骤分别写明；历史验收记录不作为部署版本锁。
同一版本/hash 信息不另建重复记录文件。CI 产物必须有可直接获取的入口。

技术说明借鉴 ASD-STE100 的受控语言理念：一个术语只表达一个概念，动作须写明对象。
固定使用“编译插件 jar”“构建 overlay 镜像”“创建容器”“重启容器”“重启 JVM”
和“装载 jar”。禁止用“重建 Kestra”统称不同操作。
描述状态必须注明通过的检查，例如“镜像 CI 通过”或“Compose 验收通过”，不单写“就绪”。
用户操作指令每步写明命令、对象与预期结果；将必须条件与可选步骤分别写明。
