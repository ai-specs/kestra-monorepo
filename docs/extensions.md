# 扩展功能集清单

本文件是 `kestra-monorepo` 的跨仓扩展目录。它适用于当前扩展和未来新增的
`kestra-plugin-*` 项目，不把当前唯一已接入的 RBAC 扩展当作通用业务模板。

## 当前清单

| 扩展功能集 | 仓库 | 接入通道 | 当前状态 | 详细说明 |
|---|---|---|---|---|
| RBAC / 应用组授权 | `kestra-plugin-rbac` | classpath jar、宿主管理 UI SDK | 已接入并通过当前正式组合验收 | [插件 README](../kestra-plugin-rbac/README.md)、[应用组模型](../kestra-plugin-rbac/docs/application-groups.md) |
| AMIS Apps | `kestra-plugin-amis-apps`（尚未创建） | 待裁决的扩展入口 + classpath jar | 需求已定稿，待宿主契约探针和实施 | [需求基线](amis-apps-requirements.md) |

当前没有其他已发布扩展功能集。未来项目必须在独立仓完成自身 CI、正式产物和公开
契约后，才可以加入“已接入”状态；候选项目应标为“候选”或“调查中”，不得写成
可部署能力。

## 文档归属与清单维护

- 部署组合与新增扩展的步骤见 [根仓 README](../README.md#接入其他扩展功能集)。
- 宿主公开机制见 [overlay README](https://github.com/ai-specs/kestra-overlay/blob/main/README.md#通用扩展接入指南)。
- 业务模型、权限、API、配置与迁移见清单对应的扩展仓文档。

新增项目在本表补充名称、仓库、接入通道、状态和详细文档入口即可，不复制三层
README 的操作说明。正式产物和部署版本由根仓现有选择入口维护，不在此重复固定
commit、digest 或 jar hash。候选和调查项必须显式标记，未经独立发布及组合验收
不得标为已接入。
