# composer-draft-transition · 历史记录

自功能卡 [docs/features/composer-draft-transition.md](../features/composer-draft-transition.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-10-18：滑动改为在发送那次提交内直接开始，不再由定时器放行；会话标题与对话内容以 swap 淡入；上一条回复的操作行保持到新回复完成。首次发送几何回归 5/5、草稿滚动 e2e、ui-chat / ui-conversation 1953 项测试通过；真实 Web 逐帧截图确认不再停在半空、操作行不随发送消失。更早记录见 Git 历史。 |

## 正文历史段落

本次复现记录：输入卡先从 y=496 跳到 y=900，随后在 y=900 / y=876 间回弹；修复后各帧单向到达终点，统计行不再导致 24px 跳动。桌面点击、减少动态效果、390px 窄视口 Enter、多行草稿与第二次发送均覆盖。新增过渡逻辑和测试的定向 lint 通过；包含 `InputBar.tsx` 的检查仍报其未改动区域原有缩进问题。本次未生成安装包，未运行全量 Web、覆盖率或 doc-sync。
