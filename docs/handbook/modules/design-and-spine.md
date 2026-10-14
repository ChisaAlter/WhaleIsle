# 模块：设计语言与 Feature Spine

## 职责与非目标

**职责：** 说明视觉强制规则、文档分层、Agent 如何安全改产品。  
**非目标：** 不在此重复 design-language 全文。

## 用户路径（作者 / Agent）

1. 改 UI 前读 [design-language.md](../../design-language.md) 与 [motion.md](../../motion.md)。  
2. 改产品行为前读 [../handbook 对应模块](../README.md) + [Feature Card](../../features/README.md)。  
3. 会话声明 `Touching: <id>`；diff 落在卡的 Allowed touch。

## 架构要点

Whale Isle 是应用的对外主名，中文「鲸屿」为辅助名；DeepSeek Harness 只出现在来源说明与底层服务语境。桌面与 Web 侧栏品牌由官方构建中的 `ui-brand-official` 两个槽位提供：标志槽位提供收起态透明头像，名称槽位显示展开态头像；右侧首行随界面语言交换名称顺序和主副字级：中文模式「鲸屿」为主且「屿」为蓝色；英文模式「WHALE ISLE」为主且「ISLE」为蓝色，另一名称在后为小字，下一行是「BASED ON DEEPSEEK HARNESS」。收起态头像位于左上角展开按钮内，悬停或键盘聚焦时切换为面板图标。源图 `assets/whale-head.png` 也用于应用图标和安装器。合同见 [desktop-branding](../../features/desktop-branding.md)。

| 层 | 用途 |
| --- | --- |
| Handbook | 蓝图 / 流程 / 模块当前态 |
| Feature Spine | 短契约，防回归 |
| superpowers specs | 设计过程 |
| `.cursor/rules` | always-on 短不变量 |

## 实现入口

- [AGENTS.md](../../../AGENTS.md)
- [docs/features/](../../features/README.md)
- [.cursor/rules/wallpaper-gallery-product.mdc](../../../.cursor/rules/wallpaper-gallery-product.mdc)

## 不变量

- 启动页仪器例外不外溢。  
- 手机 Web / Android 色板抄 `--dsw-alias-*`，不扩散 `--boot-*`。  
- 无卡则先补卡或声明「不改产品契约」。

## 门槛

- UI 改动：遵守 design-language 自检；相关 feature gates / QA ID

## 延伸阅读

- [../features/README.md](../../features/README.md)
- [vendor/deepseek-harness/docs/web-styling.md](../../../vendor/deepseek-harness/docs/web-styling.md)
