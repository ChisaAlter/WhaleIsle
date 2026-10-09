---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-managed-team-control

English | [中文](2026-10-08-managed-team-control.zh.md)

## Summary

Adds managed Team policy, cold capacity, cancelled mailbox entries, assignment identities and explicit failed-member retry events. The catalogue also catches up existing presentation, user-question and vision events and optional user edit/subagent run and environment fields already present in the runtime.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The new team/control event uses version 1. Existing version 2 roster, task and mailbox events and Session format 4 remain unchanged. Ordinary unbound Teams retain their behavior. Missing bound host policies deny execution while preserving history. These additional catalogue entries acknowledge existing runtime vocabulary; they are not destructive migrations or features newly introduced by this Team change.

<a id="verification"></a>
## Verification

Focused native Team and workspace checks passed. Real Harness host composition passed task completion, same-member continuation, peer messaging, dependency unblocking, cancellation and restart with a scripted external model adapter. This is not live-provider or packaged desktop acceptance.

<a id="dev-note"></a>
## Dev Note

None.
