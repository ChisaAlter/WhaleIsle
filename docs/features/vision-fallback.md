# Feature: Vision fallback

| Field | Value |
| --- | --- |
| **id** | `vision-fallback` |
| **status** | `active` |
| **last verified** | 2026-09-23 |

历史验证与变更记录见 [docs/history/vision-fallback.md](../history/vision-fallback.md)。

## User paths

1. 模型设置选择识图 provider/model 后，纯文本主模型可接收上传图片及 read_image 的图片结果。
2. 主请求发出前，识图服务生成描述并记录 vision/describe；后续请求与历史重放复用已记录描述。
3. 未配置时仍执行原图片能力限制；原生支持图片的主模型不调用辅助识图模型。

## Invariants

- 原始图片和事件不改写；识图描述先记录再进入主请求。
- 识图失败、超时或取消不伪装为成功，不用占位文本替代失败的识图调用。
- 模型设置始终提供识图模型选择器；新版配置表单使用 `llm-vision-fallback` 条目中的 live `provider` / `model` 字段。合并前 `settings.yaml` 的 `vision-fallback` 节在一次性导入时映射到该条目；已被旧版改名为 `settings.yaml.imported` 但未导入的选择也只补录一次，已有任何显式 profile override（包括关闭识图的空值）优先于备份，不在用户随后关闭识图时复活。已有选择与 API Key 不要求用户重填。
- 保留附件格式、大小、权限以及模型路由检查。

## Allowed touch

- vendor/deepseek-harness/packages/llm/llm-vision-fallback/ 与相关依赖声明
- vendor/deepseek-harness/packages/settings/settings/（仅旧 `vision-fallback` 键的一次性导入映射）
- vendor/deepseek-harness/packages/client/ui-settings-models/（仅识图模型控件及测试）
- vendor/deepseek-harness/packages/core/agent-loop/ 请求组装和测试
- vendor/deepseek-harness/packages/api/session-controller/ 图片准入和测试
- vendor/deepseek-harness/packages/fs/tool-fs/ 图片准入和测试
- vendor/deepseek-harness/packages/subagent/subagent/ 图片准入和测试
- 对应包 README、架构文档、Agent Notes 和 keyless snapshot
- 本卡与 docs/features/README.md

## Gates

- 无密钥的真实服务组合：上传/工具图片、文本主模型、原生图片模型、描述重放、取消和失败。
- 模型设置与 API 图片准入测试；发布前真实 API 与安装包验收另记。

## Sources

- Decision: none
- Implementation entry: `vendor/deepseek-harness/packages/llm/llm-vision-fallback/`
