---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-managed-team-control

[English](2026-10-08-managed-team-control.md) | 中文

## 概述

增加受宿主管理的 Team 策略、闲置容量、消息撤销、委派身份和失败成员重试事件。 同时补齐运行时已有的会话展示、用户提问、视觉事件，以及用户编辑和子智能体运行/环境的可选字段目录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-managed-team-control
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "31858c7c8c4cc335d076aa32349d70256f033f79c87d33fc84ff8239d5ca25e9"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "3b6b51701f59a26c0cfcd7f3deb223f169f95aadb865b60d6da30db55631ad06"
    decision: same-version
  - root: "event:session/presentation"
    previous: null
    after: "237e49fe1d2e4dd2331898913e479dae743ee16adb552828d1da912266ef501f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "36944672d7586dc459a01a947a4f29d291d0ee37869f1a2dc000a1adf37b4e71"
    decision: same-version
  - root: "event:subagent/descriptor"
    previous: "2026-09-11-initial"
    after: "816be6644aed581eb3a9b54af9c80c05ba34382c02750419a8c8251a6b9a3cd2"
    decision: same-version
  - root: "event:team/control"
    previous: null
    after: "982518a7ea243d9121e5e9ddf9241855a0735eb14acfec79b3e8e37cfe35a109"
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
    after: "ed18ebc43a0d24dbbb88e2ad8381aec5db3eaf67cfb1c31ccf804452dd742b9c"
    decision: same-version
  - root: "event:vision/describe"
    previous: null
    after: "9a583868538944b8387243cbee5b2becd7f835d802ca3c209448548e36b5b89f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增 team/control 事件使用版本 1；已有版本 2 的成员、任务、消息事件及 Session 格式 4 均保持不变。普通未绑定 Team 保持原有行为；绑定宿主缺失时保留记录并拒绝执行。 其余目录项记录已有运行时词汇，不是破坏性迁移，也不表示本次 Team 修改新增了这些功能。

<a id="verification"></a>
## 验证

原生 Team 与工作区定向检查通过。真实 Harness 宿主在脚本外部模型适配器下通过任务完成、同成员续接、同伴消息、依赖解锁、取消和重启；不代表真实供应商或打包桌面验收。

<a id="dev-note"></a>
## 开发备注

无。
