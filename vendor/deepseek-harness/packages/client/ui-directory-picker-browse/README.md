---
description: "In-app directory-browsing surface: the Miller-column Select Workspace Directory dialog that fills workspace directory flows; for users and maintainers of the Web picking experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-directory-picker-browse

English | [中文](README.zh.md)

## Summary

Local and Remote tabs keep the same title-row position when the local-only Home action disappears.

This package provides the in-app directory-browsing surface for the Web GUI: a Select Workspace Directory dialog that lists, navigates, and creates folders through the local Host, with no operating-system chooser involved. It fills the two directory-flow slots declared by `ui-workspace`, composing the client side of the browse picking interaction in one cordis.yml row. Choose it when the browser is remote or in-process and no local OS chooser exists; local deployments may prefer the [`-native`](../ui-directory-picker-native/README.md) surface.

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

Mount this plugin alongside `ui-workspace` and the host backend [`dsh-host-directory-picker-browse`](../../host/directory-picker-browse/README.md); one cordis.yml row then composes the whole browse picking interaction. When a workspace flow opens a directory request, the user sees the in-app dialog: a header with the path breadcrumb and an editable path zone, then a single full-width level until a row is selected, after which the row splits into level and children columns.

### Navigating and creating

Step through folders, edit the path directly, or filter the last pane by prefix; a Host-flagged hidden entry stays hidden until the footer toggle reveals it. **New folder** opens a nested create dialog targeting the selected folder and selects what it creates; **Open** adopts the selected folder, falling back to the listed level. Confirming a directory is the picked path; dismissing the dialog is the cancellation.

### Remote tab

Each flow entry also declares a `<flow>.remote` child slot so a remote-workspace plugin (for example an SSH workspace provider) mounts a remote pane inside the same dialog, reached through a **Local / Remote** tab strip in the title row. The strip appears only while the hole is occupied; an empty hole leaves the local browser as the whole dialog. The remote occupant receives the picking conversation (`open`, `active`, `busy`, `onPicked`, `onCancel`, `onError`) through `renderSlot` and reports a LOCAL path — its mirror workspace — so the owner's adoption path needs no remote awareness. The pane stays mounted once visited so its machine state survives tab switches and dialog closes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The dialog is a 680×500 Miller-column view (clamped on short or narrow viewports), driven by the host `listDirectory` and `createDirectory` primitives through `ctx.workspaces`. Both registrations install as one transactional effect through nested `ctx.slots.inject()` calls, because either declaring entry may activate later or replace its declaration; the dialog's copy lives in this package's own locale namespace so the two dictionaries land as a unit. Each registration declares its own `<flow>.remote` child in the same call — the registry rejects a child key declared twice, so the two holes are distinct keys per parent — and binds an occupancy `HostObservable` into the `useRemoteFlow` selector hook, which is what hides the tab strip while no remote occupant is mounted. Browse failures stay inside the dialog's own alert surfaces, so this occupant never drives the owner's `onError` arm. The node half is an empty `apply` that keeps the plugin on the host roster.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the picking surface is not enough. They move from the browser half to the host backend and the slots it fills.

- [dsh-host-directory-picker-browse](../../host/directory-picker-browse/README.md) — the directory-listing backend this surface drives.
- [ui-workspace](../ui-workspace/README.md) — declares the directory-flow slots and owns the picking conversation.
- [ui-directory-picker-native](../ui-directory-picker-native/README.md) — the native OS-chooser alternative for local deployments.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the directory browser is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current browse surface. They are current package constraints, not a general file-browser comparison or a task backlog.

- **No search, no multi-select, and no rename or delete** — the dialog lists and creates directories; a target is reached by navigating, editing the path, or filtering the last pane by prefix.
- **Hidden-entry filtering is client-side** — the Host always lists hidden entries and flags them, so the toggle changes only what the dialog renders.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
