# Proactive Assistant Ecosystem Research

Research date: 2026-11-05

## Shortlist

| Project | License | Reuse in Whale Isle |
| --- | --- | --- |
| [Pizza Bot](https://github.com/pizza-bot-app/pizza-bot) | Apache-2.0 | Local-first Inbox/Action projections, client-independent run manager, SSE/event replay, folder grants, redacted logs |
| [LangGraph](https://github.com/langchain-ai/langgraph) | MIT | Checkpointed graphs, interrupt/resume HITL, durable state and long-term memory |
| [Temporal](https://github.com/temporalio/temporal) | MIT | Event history, deterministic replay, timers, signals, retries, years-long workflows |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Apache-2.0 | Waitpoints, retries, queues, cron, realtime run updates, tracing |
| [Hatchet](https://github.com/hatchet-dev/hatchet) | MIT | Postgres-backed task runtime, schedules, durable waits, concurrency controls |
| [OpenBot](https://github.com/regnull/openbot) | MIT | Actor/inbox model, tool-level approval pauses, SSE task view |
| [Open Agent Email](https://github.com/openagentemail/openagentemail) | Apache-2.0 | Task state machine, parent/child links, approval audit records, webhook retries |
| [AgentOps](https://github.com/AgentOps-AI/agentops) | MIT | Run/agent/tool spans, cost, latency, error and evaluation telemetry |
| [agent-autonomy-levels](https://github.com/cjohannsen81/agent-autonomy-levels) | CC-BY-4.0 framework; Apache-2.0 tools | Machine-readable autonomy controls, evidence, expiry, promotion/demotion |

## Design lessons

1. Keep a single durable run manager independent of UI and model bindings.
2. Treat Inbox and Outbox as projections over an event log.
3. Use explicit states: submitted, queued, running, waiting for input, waiting for approval, resumed, completed, failed, cancelled.
4. Persist checkpoints before waits and after side effects. Retries require idempotency keys.
5. Resume the exact run after HITL approval. An approval record alone must never execute an action.
6. Give each tool call a capability scope, data classification, risk level, approval requirement, and evidence.
7. Make autonomy machine-enforced, not a UI label. Store a per-run certificate with evidence, expiry and revocation triggers.
8. Support cron, one-shot, webhook and source-event triggers with concurrency, backoff, rate limits and fairness.
9. Reconnect clients by sequence cursor and replay; client disconnect must not stop a run.
10. Emit redacted structured traces for run → agent → tool → approval → delivery.

## License cautions

Use permissively licensed components or borrow patterns. Inngest server is SSPL/DOSP and Restate is BSL, so do not embed either without a separate license review.