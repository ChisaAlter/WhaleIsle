---
name: dsh-pre-push-checks
description: Locate relevant Harness checks under the sole WhaleIsle maintenance policy; no independent push workflow.
---

# Harness checks inside WhaleIsle

[WhaleIsle maintenance](../../../../../docs/maintenance/README.md) is the sole project maintenance policy, including when working directly in this vendor directory. This skill supplies navigation only.

Inspect the owning module and outgoing diff to locate existing behavior, build and integration commands. Their selection, development order and completion conditions come from that policy. Use the host [verification entry](../../../../../.devin/skills/dshd-checks/SKILL.md) and [release operations](../../../../../docs/handbook/modules/release-process.md).

Development CI is enabled on PRs and main. No local-QA certificate, full doc-sync/lint ladder or candidate approval is required. Historical workflow instructions do not reinstate retired gates.
