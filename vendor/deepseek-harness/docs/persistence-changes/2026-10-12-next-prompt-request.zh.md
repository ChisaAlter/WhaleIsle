---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-next-prompt-request

[English](2026-10-12-next-prompt-request.md) | 中文

## 概述

为内置下一句提示的辅助请求新增一个可安全忽略的 conversation/next-prompt-request 审计事件。另行刷新从基线 1ea535956424c1af35806fed9065af0b3c1608ef 继承的八项尚未记录的 schema 差异：可选的用户来源 edit 元数据在四处出现，以及已有的 session/presentation、user-questions/asked、user-questions/answered 和 vision/describe 事件。本功能没有修改这些事件所属的实现。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-next-prompt-request
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "eabade5690523a8f31fa8b8fdd243189b65c14c52dc36522a1ce6e471cd2523c"
    decision: same-version
  - root: "event:conversation/next-prompt-request"
    previous: null
    after: "bc40864062585404fff441efdeb08a41f9859715ab0c07db8b5f13a78c8aee78"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "b89ce48d66b0fce0b214804555cecb50e16990e37e20ae22f1939c45526d2ac6"
    decision: same-version
  - root: "event:session/presentation"
    previous: null
    after: "e68e6b664a773b610ccd2bfb3000109f1b40d67d750b682d83e71c59a9c66d43"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "f58b486bba996d4cd4fbe6367f578814a128adcf7fdacaebcb2b9687899504ba"
    decision: same-version
  - root: "event:user-questions/answered"
    previous: null
    after: "1e7e1ad80310f0d661764b3ad503f55479b7ec571a3b841a7d264f7e2c025bc6"
    decision: same-version
  - root: "event:user-questions/asked"
    previous: null
    after: "cbb0383bc08f6a75971e44895bb86a00f0262fadd4ab9a25240e484a283a0bcb"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "dbebd8a2305d5eebb9bfba97b46544b14c32dccb159df33f52fd6d73b9ed66f7"
    decision: same-version
  - root: "event:vision/describe"
    previous: null
    after: "9a583868538944b8387243cbee5b2becd7f835d802ca3c209448548e36b5b89f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 Session 记录保持可读。新审计事件仅写入日志，并使用已有事件信封的 ignorable 标记；不认识该类型的旧读取方可以跳过它，不影响聊天画面、主模型历史或回合状态。该事件记录辅助模型请求的精确输入，不新增主对话的用户或助手消息。不改变 Session header 或事件信封 schema。八项继承差异依据基线中已有的源码独立记录，与本次新事件分开说明；固定分类器允许这些可选属性和普通新增事件沿用当前写入版本。不含可选 edit 元数据或新增事件的旧记录仍然有效。本记录不证明旧读取方支持这些继承事件；按照已有事件信封约定，读取方可能拒绝未知的必要事件。

<a id="verification"></a>
## 验证

生成产物前，下一句提示的 Host 行为测试通过 16 项，核心 Session 日志元数据测试通过 2 项，定向 Host TypeScript 检查通过。这些检查覆盖辅助请求审计的精确数据、主历史和聊天画面保持不变、可选日志元数据及旧读取方安全忽略事件。没有重新验证八项继承的基线行为，这些检查也不能证明真实桌面 UI 验收通过。生成后的目录新鲜度和完整持久化历史检查记录在本次开发结果中。

<a id="dev-note"></a>
## 开发备注

无。
