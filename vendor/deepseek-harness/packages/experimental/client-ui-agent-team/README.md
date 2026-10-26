---
description: "Use and debug the experimental Web Agent Teams roster, shared task board, and teammate navigation panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-agent-team

English | [中文](README.zh.md)

## Summary

This package adds an Agent Teams action to the Web conversation header and the same Team as a right Sidebar page, where a user can inspect the current roster, inspect the shared task board, and navigate into a teammate's conversation. It reads the Lead Session's `agentTeam` projection from the shared Session store, where Host projection frames keep it current without a refresh control, and keeps ordinary child-history navigation on the stable addressed-subagent path. Choose it through the published experimental Agent Teams bundle. The browser projection does not extend the stable API Proxy, store Team state, or register model-facing input.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable this package through [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.md), which supplies the Team service, tools, and Web UI together. The Web Client loader mounts the `/client` export; the root Host export is inert, and the package has no user configuration fields.

### Inspect and navigate the roster

The panel shows the Lead Session's roster and task board from the shared Session store. Task and roster updates appear while the panel stays open. Opening the panel performs no projection requests. The panel shows a loading notice while the conversation or Session list is loading, and an unavailable notice when no Team value is present afterward.

Roster rows show durable names and phases. Provisioning and running members use the shared ongoing loader, inactive members use a person icon, and failed members use error. Live Session status supplies running activity; the shared `modelSelection` projection supplies a model when available. Inactive means no turn is running, not that assigned work is complete. The current conversation carries a Current chat tag and cannot be selected. Selecting the Lead from a teammate conversation opens the Lead Session directly. Selecting an active teammate opens its ordinary continuable child address. The Host validates the parent, child, and mode when history opens; later human prompts use the same addressed-subagent conversation.

Project conversations use a fixed-width Team entry with a permanent count slot. It counts distinct roster members with a live turn or an owner-confirmed running or stopping background command, excluding the Coordinator. The visual count caps at `99+`; the accessible name retains the exact count. Loading, unavailable activity, and rejected Team records show `?` instead of a confirmed count. The Project entry opens a popover only when clicked; hover shows a short Tooltip, and leaving the pointer does not close the popover. Closing it, clicking outside, or pressing Escape dismisses it.

### Keep the Team beside the conversation

When the right Sidebar is composed, the package registers the `agent-team` page kind (`TEAM_SIDEBAR_KIND`). The page renders the same roster and task board as the header panel, with members stacked in the narrow column. In a Project popover, Keep observing explicitly opens this existing Sidebar page; Return to popover closes that Team tab and reopens the header popover. Returning from a docked observer collapses the current Session's expanded Sidebar when only guide tabs remain; other content tabs and floating observers keep their existing layout. Both presentations share the Project's scope selection, history search, pagination, expanded task descriptions, and reading position. Closing a Project popover retains its hidden content tree. Registration and activity updates never open the Sidebar. The popover and Sidebar keep long content inside their own scroll bodies.

Selecting a teammate in the Sidebar opens its addressed conversation as a `subagentchat` Sidebar tab in the Team page's pane, so the Lead conversation stays in view and the Team is one tab away; selecting the Lead opens the Lead Session. Opening failures use the shared Toast overlay. After it fades, the original member button retains an error outline and the reason in its Tooltip and title; retrying that button clears the marker only when opening succeeds. The marker preserves the button's layout. Another plugin can open the page for a Session through `sidebarRight.openTabIn(sessionId, TEAM_SIDEBAR_KIND)`.

### Scope the Current view to the owner's work

The package provides `ctx.agentTeamScopes`. A conversation owner calls `set(leadSessionId, taskIds)` with the task ids of its current work, most relevant first, and `set(leadSessionId, undefined)` to clear them. In a Project Lead, the Current view of the header panel and the Sidebar page then lists only those tasks, live members and their owners, so members and open tasks from earlier or cancelled work stay under All records. Without a scope, the Current view keeps its live-work rule.

The same service exposes `activitySource` and `setActivity(leadSessionId, facts)`, independently of `source` and task scopes. `facts` contains `state` (`ready`, `loading`, or `unavailable`) and `runningJobSessionIds`, the Session ids whose owned background commands are running or stopping. The owner supplies these JSON facts from its authoritative activity read, retaining last-confirmed ids when that read is unavailable; `undefined` clears the entry. The header and Sidebar receive it through the injected `useTeamActivity` hook. A confirmed Job keeps its member visible and running even after the member's turn ends. A failed member retains its failure phase and separately shows the running command. Unconfirmed facts remain in the details as last-confirmed records and do not produce a confirmed header count. This service stores no durable Team or Project business state.

### Inspect the task board

Ready pending tasks use idle, blocked pending tasks use warning, in-progress tasks use ongoing, and completed tasks use done.

The read-only task board shows task identity, owner, blockers, readiness, advisory write scopes, and overlap warnings. Descriptions longer than two lines have an expand toggle. Section headings show member and task counts; an empty board shows a short description, and a lone member with no tasks uses a single-column panel. Team agents create and update tasks through their tools; the panel provides no task mutation controls. When the projection reports a rejected persisted Team record, the panel shows that failure above the last valid roster and tasks.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export registers its locale dictionaries and one conversation-header slot through Cordis effects, plus the Sidebar page type and body when `sidebarRight` and `sidebarRightTabs` are present; it mounts no Remote namespace. Disposing the plugin fiber removes every registration.

The panel renders outside the conversation container and stays within the viewport. Member cards use the shared elevation stroke for their outlines in resting, selected, and hover states. In ordinary conversations, hovering the trigger opens the panel after 150ms; leaving both trigger and panel closes it after a 120ms grace period. Clicking pins that popover and moves focus into it. In a narrow header, the ordinary trigger becomes an icon and opens only on click. Project triggers retain their count at narrow widths and always require a click.

The component derives every row from the `useSessions`, `useSessionStatus`, and `useSession` seats: the Lead identity comes from the current Session's subagent address, the Team view from `projectionsBySession[lead].values.agentTeam`, member activity from Session status with the list summary as fallback, and the model from `projectionsBySession[member].values.modelSelection.next`. Explicit runtime inactivity overrides an older running summary. Each roster row selects its own running state. Narrow injected callbacks open a roster Session or the existing Team Sidebar. A shared session-scoped view store connects the two registered Project presentations. Switching conversations closes the popover and clears a navigation failure while retaining that conversation's view selections.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Locale, navigation, and slot registrations |
| [`src/client/TeamAction.tsx`](src/client/TeamAction.tsx) | `TeamBody`: projection-derived roster and task board; `TeamAction`: the header popover around it |
| [`src/client/TeamSidebar.tsx`](src/client/TeamSidebar.tsx) | Sidebar page around `TeamBody` with Toast navigation failures and return-to-popover action |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese panel copy |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams bundle](../agent-team-profile/README.md) — the published opt-in bundle that mounts this Client plugin.
- [Agent Teams service](../agent-team/README.md) — authoritative roster, task, and projection behavior.
- [Conversation UI](../../client/ui-conversation/README.md) — the stable header slot and addressed-subagent navigation surface.
- [Experimental packages](../README.md) — incubation status and publication policy.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser projection registers no model-facing input.

#### KV Cache effect

No direct effect; the Team tools and ordinary conversation submission own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No mailbox timeline** — the projection view carries roster and tasks only; peer messages are not shown.
- **Late plugin activation** — after enabling Agent Teams in an already-open conversation, reload the page to receive its Team projection.
- **Model availability** — a model appears only when the shared store has a durable selection or request for that member. Missing cold-cache values stay absent until normal Session loading or a live update supplies them.
- **Ordinary child continuation** — a human message sent after navigation uses the stable addressed-subagent prompt path, not the Team peer mailbox.
- **No lifecycle or workspace controls** — the panel cannot spawn, rename, delete, or interrupt teammates, and write scopes remain advisory metadata.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
