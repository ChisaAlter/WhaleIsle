---
description: "Codex-style sidebar skin for the DeepSeek Harness Web GUI: a Projects + Recents browser and a New chat row that starts a real session with no project in a freshly minted working directory, reclaimed again the moment the chat is abandoned unused."
kind: "package-reference"
---

# dsh-plugin-codex-ui

English | [中文](README.zh.md)

A Codex-style sidebar skin for the DeepSeek Harness Web GUI.

It replaces the shipped browsing region with two collapsible sections — **Projects**
and **Recents** — under a single **New chat** row that starts a session *without*
choosing a project, allocating a fresh working directory for it exactly the way the
Codex app does.

```
DeepSeek Harness                           ⇤      ← brand row (shipped shell, renamed)
＋ 新对话                                          ← starts a real chat in a fresh temporary directory
─────────────────────────────────────────────
项目                                        ＋      ← section title; click it to fold
    📁 pi                                     ← one row per project, no chevron
    📁 dsh-plugin-codex-ui
最近
    20260912-135505-27c0                       ← project-less chats only, title only
    …                                         显示更多
─────────────────────────────────────────────
⚙ 设置                                             ← shipped settings foot
```

Both sections fold, each fold survives a reload, and clicking a project folds its own
chats out beneath it.

Section titles and rows read the way the Codex sidebar does: a section title is a small
quiet label on the same left inset as the row glyphs under it, a row is a 32px line whose
title owns the full width — no chevron, no relative time — and the row glyphs and titles
carry the dark `label-primary` text while a section title and a collapsed section's count
stay `label-tertiary`. Hover is a background change, not a colour change, and the current
chat is marked by its filled pill.

## What it changes

| Surface | Change |
| --- | --- |
| Sidebar brand name | Shows **DeepSeek Harness** instead of the local build badge. |
| Sidebar browsing region | Replaced by this plugin's Projects + Recents browser. |
| Global panel rows | Hidden. This skin has no Pull requests / Scheduled / Plugins rows. |
| Shipped New Session button | Hidden while the column is expanded, replaced by this skin's **新对话** row. The collapsed rail keeps the shipped icon button. |
| `--dsh-sidebar-inline-padding` | Tightened from 12px to 10px. |

Everything else is the shipped shell: the brand row, the collapse animation, the
36px rail, and the settings foot are all untouched.

## Install

Requires the `web` profile of DeepSeek Harness (Node ≥ 20) and `pnpm` on `PATH`, because
`dsh plugin` forwards to pnpm inside the profile directory.

```sh
# from GitHub
dsh plugin --profile web add github:ice-ai-lab/dsh-plugin-codex-ui

# or from a local checkout
dsh plugin --profile web add /absolute/path/to/dsh-plugin-codex-ui
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` appends it to
`dsh.profile.bundles` automatically and the layer applies on the next boot.

**Then restart `dsh web`.** The client half is composed into `window.__DSH_BOOT__`
at boot time, so a page refresh alone will not pick it up.

To remove it:

```sh
dsh plugin --profile web remove dsh-plugin-codex-ui
```

## The two gestures that are not just styling

### Start a chat with no project

**新对话 starts a real chat with no project.** It asks the node half for a fresh working
directory, registers that directory as a Workspace, creates the session in it and opens
it — the shipped New Session order, with a directory the reader never had to pick. The
composer that comes up is the shipped one and fully live: the model picker, the permission
chip, `+`, `@`, and the context meter all work from the first keystroke.

There is no mock composer and nothing is deferred, because a chat you can choose a model in
has to exist, and a session cannot exist without a working directory. The directory is
created when the chat is.

That is what the cleanup is for. The last chat this row minted is remembered, and reclaimed
the moment the reader moves on without using it: the session is archived, its Workspace
registration dropped, its directory removed. Ten clicks in a row leave one directory, not
ten. A chat that was **used** is never reclaimed — messages make it an ordinary chat, and
typed text keeps it (and keeps its row listed, so the text stays reachable) until it is
sent or cleared. Anything this skin minted and then lost track of — a crash between minting
and recording, a record lost with the browser's storage — is swept on the next load: a
directory under this skin's root that no workspace and no chat refers to, or a minted
workspace holding nothing but untouched chats, older than a grace period, goes.

Why the registration matters: a session rooted only at a working directory and owned by
no workspace is treated by the conversation as *incomplete* — the composer goes inert
behind "choose a workspace to start" and the model picker goes with it. Going through a
workspace yields a chat byte-for-byte the same as one started inside a project, the only
difference being which workspace it names.

Keeping that workspace out of **Projects** is then this skin's job, not a side effect:
the node half reports the directory root it mints under, and any workspace inside that
root counts as project-less, so its chat lands in **Recents**, which is where a chat
with no project belongs.

### Projects

**Projects** lists the working directories registered in the DSH workspace registry.
A project row is just a folder glyph and a name — no chevron: the folder itself carries
the fold state (closed when the chats are hidden, open when they are showing), so the
row reads as one mark instead of two.

Clicking a project folds out its chats; the row's `＋` starts a new chat inside it;
the 🗑 removes the registration only (the directory and the session logs stay).

Add one with the section's `＋` (or the `选择项目` button in the empty state): it asks
the Host for its directory chooser straight away, with no form in between, and adopts
whatever comes back. Cancelling the chooser is not an error and changes nothing.

That chooser is the Host's own directory-picking capability — the same one the shipped
"choose a workspace" gesture uses. If a composition omits the directory-picking
packages, adding a project is unavailable, and the skin says so inline rather than
silently doing nothing.

### Recents

**Recents** lists the chats that belong to **no** project — the ones this skin starts
from **新对话**, plus any session the registry accounts to nothing. A project's own
chats are reached by folding that project open, so listing them here too would show the
same chat twice under two headings.

A chat moves from Recents into its project as soon as it is accounted to one, and it
keeps a working directory of its own throughout — nothing is moved on disk.

A session row carries a hover-revealed 🗑, and what it does is **archive** the chat —
`archiveSession` is the only session removal the Host has. The chat leaves every grouping
surface and its log file stays on disk. Archiving is one-way: no unarchive exists in the
client API, in the Host commands, or in the shipped UI. So the control is deliberately two
steps — the trash turns that row into the question `Archive “<title>”?`, naming the chat it
would retire, and only the answer archives it. A one-click, one-way, hover-revealed control
at the exact right edge of a row you are aiming at is a trap; a question is not.

That the row disappears immediately is this skin's own doing: the session list does not
carry the archive set, so the set is read from the Workspace projection and subtracted
here — exactly as the shipped browsing region does.

## Where project-less working directories live

```
$DSH_HOME/codex-workspaces/<YYYYMMDD-HHmmss>-<hex>/     # $DSH_HOME defaults to ~/.dsh
```

Deliberately **not** the `scratch` directory other sidebar skins use: two plugins
sharing one root would let either one's cleanup delete the other's live session
directories.

Nothing prunes this directory automatically, and none of it shows as a project —
project-less chats appear under **最近**, which is the intended shape. Delete a
directory by hand once you no longer want its chat.

One consequence worth knowing: every **新对话** click mints a new directory *and*
registers it, so the workspace registry gains one row per project-less chat — a new
chat means a new working directory, the way the Codex app does it. Those rows stay out
of **Projects** but they are real registrations; removing one (🗑 works on projects
only, so use the shipped workspace UI or `workspace.json`) removes the registration and
keeps the directory and the chat log.

## Customising

**The wordmark.** `lib/client.js` defines `BrandName`; change the string it returns.

**Not hiding the global panel rows.** Delete this line from `CSS` in
`lib/client.js`:

```css
nav[class*="_panelList"] { display: none !important; }
```

It exists because a dynamically loaded client plugin may register a global panel
row (that is how a Pull requests / Scheduled / Plugins row reaches the sidebar).
The default composition registers none, so with the rule in place the sidebar simply
shows Projects and Recents; with it removed, any panel row a plugin contributes
becomes reachable again.

## What this skin does not do

The shipped browser also offers session search, rename, fork, drag reordering, and
subagent lineage. This skin deliberately ships none of them — it is a skin, not a second
browser. (Removing a chat it does ship, because a list you cannot prune is not a list you
own.) If you need the rest, remove the plugin. (Setting `SHADOW_PRIORITY` in
`lib/client.js` above `0` hands both claimed cells back to the shipped
implementations, which switches the skin off without uninstalling it.)

## How it works

* **The node half** (`lib/index.js`) exposes two `exact` routes over the harness web
  server — allocate a working directory (and report the root plus everything already
  minted under it), and delete directories this plugin allocated. Names are entirely
  server-generated, deletion accepts names only, and every name is validated as a single
  path segment and re-checked for containment after resolution. No caller-supplied path
  ever reaches the filesystem. The listing is what the browser half's load-time sweep
  reads to tell a directory nothing refers to from one live work sits in.
* **The browser half** (`lib/client.js`) claims two `single` slots:
  `sidebar.brand.name` for the wordmark and `sidebar.workspaces` for the browsing
  region. A `single` slot is claimed rather than composed — the registry refuses a
  second registration at the same priority — so this skin registers at
  `SHADOW_PRIORITY` (`-10`), and the lowest priority renders. If the plugin is
  unloaded, or this entry ever abdicates after a render crash, the shipped browser
  takes the cell back with no reload.
* **The subtractions are CSS**, not shadowed components. Removing the shipped panel
  rows and the shipped New Session button is a subtraction, and shadowing the whole
  `sidebar` slot to achieve it would mean reimplementing the brand row, the collapse
  animation, the rail, and the settings foot — four shipped behaviours this skin has
  no opinion about.

## Verify the source

```sh
npm run check          # node --check on both halves of the plugin
```

## Ecosystem

This plugin is published the way the harness asks third parties to publish: the repository
carries the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic for discoverability,
and installation goes through `dsh plugin add github:…` rather than a pull request to the
core repository, which
[does not accept external PRs](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md).

## License

MIT
