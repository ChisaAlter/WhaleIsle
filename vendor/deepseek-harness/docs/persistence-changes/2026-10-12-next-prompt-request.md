---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-next-prompt-request

English | [中文](2026-10-12-next-prompt-request.zh.md)

## Summary

Adds one omission-safe conversation/next-prompt-request audit event for the built-in next-message suggestion request. Separately refreshes eight previously unrecorded schema differences inherited from baseline 1ea535956424c1af35806fed9065af0b3c1608ef: four appearances of optional user source edit metadata and the existing session/presentation, user-questions/asked, user-questions/answered, and vision/describe events. Their owning implementations are unchanged by this feature.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing Session records remain readable. The new audit is a log-only event written with the existing envelope's ignorable marker, so an older reader that does not know this type may skip it without changing chat surfaces, main model history, or turn state. It records the exact auxiliary model request and adds no new main user or assistant message. No Session header or event-envelope schema changes. The eight inherited differences are acknowledged from already-present baseline source, separately from this new event; the fixed classifier permits their optional property additions and ordinary event additions at the same writer version. Old records that omit the optional edit metadata or added events remain valid. This record does not establish support for those inherited events in older readers: a reader may reject an unknown required event under the existing envelope contract.

<a id="verification"></a>
## Verification

Before artifact generation, the next-prompt Host behavior suite passed 16 tests, the core Session log-only metadata suite passed 2 tests, and the targeted Host TypeScript check passed. These checks cover exact auxiliary request audit data, unchanged main history/surfaces, optional log metadata, and older-reader omission safety. The eight inherited baseline behaviors were not revalidated, and these checks do not establish real desktop UI acceptance. Generated catalog freshness and complete persistence-history checks are recorded in the development result after generation.

<a id="dev-note"></a>
## Dev Note

None.
