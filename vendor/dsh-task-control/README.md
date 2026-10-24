# dsh-task-control

Desktop-owned Harness plugin: admission lock + work inspection + loopback
control route for quit/update protection in Whale Isle.

## Control route

`POST|GET /dshd-task-control/<op>` with `Authorization: Bearer
$DSHD_TASK_CONTROL_TOKEN` (injected by the shell into the Host child env; an
empty token keeps the route closed).

| op | body | effect |
| --- | --- | --- |
| `status` | — | lock + pending snapshot |
| `inspect` | — | `{ activeWork, scheduledWork, coverage, hostGeneration, observedAt }` |
| `acquire` | `{owner, kind, ttlMs, drainTimeoutMs}` | refuse new work, drain admitted, verify generation; `dshd/drain-timeout` replies carry `pendingCount` + `pendingLabels` identifying what stayed open |
| `renew` | `{lockId, owner, ttlMs}` | extend expiry |
| `release` | `{lockId, owner}` | unlock; re-drives schedule runtime |
| `cancel` | `{lockId, owner, reason}` | unlock + emits `dsh-task-control/cancel` |

While locked: webServer routes (incl. pre-registered and upgrades) answer 503,
`connection/request` answers 503, `sessionController.resolveAgent` returns a
`session/agent-busy` error result, and `jobs.start` rejects.

## Coverage semantics

Socket work counts exclude destroyed transports and known loopback peers
(127/8, ::1 and IPv4-mapped IPv6). External or unknown peers remain counted.
Agents, jobs and admitted requests are inspected independently, including work
originating over local connections. This filter changes reporting, not admission.

`coverage.*` ∈ `ok | intentional-disabled | unavailable`. Schedule coverage is
`intentional-disabled` when the desktop declares it off (`DSHD_SCHEDULE_ENABLED`
unset). `unavailable` blocks unattended commits.

See `docs/features/task-protection.md` and
`docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md`.
