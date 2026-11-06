# Proactive Assistant Foundation

## Goal

Whale Isle should grow from a conversation client into a local-first personal assistant that can discover work, plan it, execute it with bounded autonomy, pause for human decisions, and deliver verified results.

This document records the first architecture baseline. It is intentionally runtime-neutral so the durable engine can evolve without coupling the UI to a specific agent framework.

## Core boundary

The system has four layers:

1. **Sources**: Gmail, calendar, chat, documents, GitHub, local workspaces, and scheduled/event triggers.
2. **Durable runtime**: runs, checkpoints, tool calls, approvals, retries, dependencies, and audit history.
3. **Projections**: Inbox, Outbox, task board, activity feed, notifications, and delivery records.
4. **Clients**: desktop, Android/Web remote view, CLI, and future integrations.

The durable runtime is the source of truth. Inbox and Outbox are queryable projections, never the only copy of a task.

## Task lifecycle

`discovered → triaged → queued → planning → running → waiting_input | waiting_approval → resumed → verifying → delivered | failed | cancelled`

Every transition is append-only, carries a correlation ID, actor, timestamp, policy decision, and idempotency key. External side effects must be wrapped in an idempotent activity record before they are retried.

## Autonomy levels

- **L1**: extract and summarize; never take external action.
- **L2**: analyze and propose; reversible local preparation is allowed.
- **L3**: create intermediate artifacts and run bounded read-only or local work; approval required before external side effects.
- **L4**: execute a bounded plan independently; pause for sensitive, external, irreversible, or high-impact steps.
- **L5**: complete an explicitly authorized task end to end, verify the result, and publish a delivery record.

The level is evaluated per task and per tool call. A task cannot inherit a higher level from a parent task.

## Inbox and Outbox

- **Inbox** contains discovered items, unresolved risks, opportunities, and decisions.
- **Outbox** contains proposed external messages, publications, account changes, permissions, payments, and other actions requiring approval.
- An Inbox item becomes a task only after deduplication and triage.
- An Outbox item has a preview, target, data classification, risk, proposed action, evidence, expiry, and approval history.
- Approval resumes the exact waiting run; it never restarts the entire plan.

## HITL rules

Human confirmation is mandatory for sensitive data transmission, external communications, irreversible deletion, security/account changes, payments, legal commitments, and high-impact decisions. The UI must show the exact action, destination, data, consequence, and available alternatives.

## Recovery and observability

Runs continue across client disconnects. Reconnection replays events from a sequence cursor. Checkpoints are written at safe boundaries, before waiting, and after each side effect. Expose structured redacted traces for run → agent → tool → approval → delivery, with latency, retry, token/cost, and error metrics.

## First vertical slice

The first production slice should implement:

1. A durable task record and transition log.
2. Inbox projection with deduplication and L1–L5 policy.
3. Outbox approval records that resume a paused run.
4. One safe source adapter (GitHub read-only) and one scheduler trigger.
5. A task detail panel showing status, evidence, approvals, retries, and delivery.
6. Crash/reconnect tests and one end-to-end task from discovery through approved delivery.

## Reuse guidance

Borrow patterns rather than hard-coupling the product:

- Pizza Bot: local-first Inbox/Action semantics and client-independent run manager.
- LangGraph: interrupt/resume and checkpointed HITL graphs.
- Temporal: event history, deterministic replay, timers, and signals.
- Trigger.dev: waitpoints, retries, queues, and realtime run updates.
- OpenBot: actor/inbox model and tool-level approval pauses.
- AgentOps/OpenTelemetry: trace and cost schema.

All dependencies must be checked for license compatibility before vendoring.