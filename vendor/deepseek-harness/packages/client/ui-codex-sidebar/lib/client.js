/**
 * Browser half of `dsh-plugin-codex-ui`.
 *
 * Shipped in the built-bundle format the client module system serves from
 * `exports["./client"]`: the host composes it into `window.__DSH_BOOT__` and the
 * shell evaluates this factory lazily on first use. Only platform seed modules
 * are requested (`react`, `@deepseek-ai/dsh-client-ui-primitives`), so
 * `dsh.client.external` stays empty.
 *
 * What it registers:
 *
 *   - `sidebar.brand.name` — the Codex wordmark that replaces the shipped build
 *     badge in the sidebar's brand row;
 *   - `sidebar.workspaces` — the whole browsing region, rebuilt as two
 *     collapsible sections (Projects, Recents) under a single New chat row.
 *
 * Why `sidebar.workspaces` and not a seat of its own: the shell declares that
 * hole as the browsing region and this skin IS a different browsing region.
 * `sidebar.workspaces` is a `single` slot, so this registration shadows the
 * shipped browser rather than stacking beside it (the registry gives a
 * dynamically registered entry lower priority, and lower priority wins a
 * `single` cell) — and if this plugin is unloaded, or this entry ever abdicates
 * after a render crash, the shipped browser takes the cell back with no reload.
 * `sidebar.workspaces.directoryFlow` is deliberately NOT declared: this skin
 * adds projects through the Workspace Controller directly, so the composed
 * directory-picking packages have nothing to fill here.
 *
 * Why the shell chrome is edited with CSS and not shadowed: removing the
 * shipped global panel rows (Pull requests / Scheduled / Plugins) and the
 * shipped New Session button is a *subtraction*, and the cheapest correct way
 * to subtract from another component's output is a stylesheet rule. Shadowing
 * `sidebar` wholesale would mean reimplementing the brand row, the collapse
 * animation, the rail, and the settings foot — four shipped behaviours this
 * skin has no opinion about. The two rules that do this are marked below.
 *
 * The New chat row replaces the shipped button because the gesture differs, not
 * the styling: the shipped one inherits the current or most recent workspace,
 * so with no project registered it can only drop the reader on the project
 * picker. This skin's row starts a session with no project at all: it asks the
 * node half for a fresh working directory, registers it, creates the session in
 * it and opens it — the same order the shipped button uses, with a directory
 * the reader never had to pick.
 *
 * The price of a real session from the first click is that an abandoned one
 * leaves a directory behind, so the gesture is paired with cleanup: the last
 * chat this row minted is remembered, and as soon as the reader moves on while
 * it still has no messages, that chat is archived, its workspace registration
 * dropped and its directory removed. Anything a crash strands is swept at the
 * next load by the same test the node half already reports — a directory under
 * this skin's root that neither a workspace nor a chat refers to.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-codex-ui',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let react = require('react');
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const {
      Tooltip,
      IconChevronDownOutline14,
      IconCloseOutline16, IconFolderClose16, IconFolderOpen16,
      IconNewChatOutline16, IconPlusOutline16, IconProjectAddOutline16,
      IconRefreshOutline16, IconTrashOutline16, IconWarningOutline16,
    } = primitives;

    /** Routes owned by this package's node half. */
    const SCRATCH_PATH = '/dsh-codex-ui/scratch';
    const SCRATCH_DELETE_PATH = '/dsh-codex-ui/scratch/delete';

    /** Copy namespace for this package's dictionaries. */
    const NS = 'codexUi';

    /** Stylesheet identity, so a re-registration does not stack duplicate tags. */
    const STYLE_ID = 'dsh-plugin-codex-ui/client.css';

    /** Persisted section fold state, so the sidebar opens the way it was left. */
    const SECTIONS_KEY = 'dsh-codex-ui.sections';

    /**
     * Persisted record of the project-less chat this row minted last: the one
     * whose directory has to be reclaimed if the reader never uses it.
     */
    const PENDING_KEY = 'dsh-codex-ui.pendingScratchChat';

    /**
     * How long a fresh project-less chat is left alone before the reader moving
     * away may unwind it. Creating the chat, registering its workspace and
     * selecting it are three separate store writes, and for a moment the
     * selection still names the previous chat: without this window the cleanup
     * would race the mint and delete the chat the reader is looking at.
     */
    const SCRATCH_SETTLE_MS = 5000;

    /**
     * How old a directory under this skin's root must be before the orphan sweep
     * may remove it. Long enough that a directory whose workspace registration
     * has not propagated yet is never mistaken for an orphan.
     */
    const SCRATCH_GRACE_MS = 15 * 60 * 1000;

    /** Recents shown before the reader asks for more. */
    const RECENT_DEFAULT = 8;

    /** How many more recents one "show more" reveals. */
    const RECENT_PAGE = 14;

    /** Sessions shown inside one expanded project before it only reports a count. */
    const PROJECT_SESSIONS = 5;

    /**
     * How long a directory-chooser round trip may stay unanswered before the
     * gesture gives up. A native dialog the operator never dismisses must not be
     * able to leave a control pending for the rest of the session.
     */
    const PICK_TIMEOUT_MS = 120000;

    /**
     * The priority this skin registers its two `single`-cell takeovers at.
     *
     * A `single` slot is claimed, not composed: the registry refuses a second
     * registration at the same priority outright ("register at a different
     * priority to shadow it"), so shadowing the shipped brand name and the
     * shipped browsing region has to be asked for explicitly. Among the
     * surviving entries the LOWEST priority renders, and every shipped entry
     * sits at the default 0, so a negative number is what takes the cell over.
     */
    const SHADOW_PRIORITY = -10;

    /** English dictionary (the key-set source of truth). */
    const en = {
      'new.label': 'New chat',
      'new.hint': 'Start without a project — a fresh temporary working directory is created for it',
      'projects.title': 'Projects',
      'projects.empty': 'No projects yet',
      'projects.add': 'Choose project',
      'projects.newChat': 'New chat in this project',
      'projects.remove': 'Remove project',
      'projects.sessionsEmpty': 'No chats in this project yet',
      'projects.more': '{n} more chats',
      'recents.title': 'Recents',
      'recents.empty': 'No recent chats yet',
      'recents.more': 'Show more',
      'recents.less': 'Show less',
      'sessions.remove': 'Remove chat (archive — the log file stays on disk)',
      'sessions.removeConfirm': 'Archive “{title}”?',
      'sessions.removeYes': 'Archive',
      'sessions.removeNo': 'Cancel',
      'sessions.removeFailed': 'Could not archive the chat: {message}',
      'add.failed': 'Could not open the directory chooser: {message}',
      'start.failed': 'Could not start a chat: {message}',
      'action.failed': 'That action failed: {message}',
      'dismiss': 'Dismiss',
      'loading': 'Loading…',
    };

    /** Simplified Chinese dictionary, the shape this skin is designed against. */
    const zh = {
      'new.label': '新对话',
      'new.hint': '不选择项目直接开始：会立刻为它新建一个临时工作目录',
      'projects.title': '项目',
      'projects.empty': '还没有项目',
      'projects.add': '选择项目',
      'projects.newChat': '在此项目中新对话',
      'projects.remove': '移除项目',
      'projects.sessionsEmpty': '该项目还没有对话',
      'projects.more': '还有 {n} 个对话',
      'recents.title': '最近',
      'recents.empty': '还没有最近的对话',
      'recents.more': '显示更多',
      'recents.less': '收起',
      'sessions.remove': '移除对话（归档：日志文件仍保留在磁盘上）',
      'sessions.removeConfirm': '归档「{title}」？',
      'sessions.removeYes': '归档',
      'sessions.removeNo': '取消',
      'sessions.removeFailed': '归档失败：{message}',
      'add.failed': '无法打开目录选择器：{message}',
      'start.failed': '无法开始新对话：{message}',
      'action.failed': '操作失败：{message}',
      'dismiss': '关闭提示',
      'loading': '加载中…',
    };

    /**
     * This skin's stylesheet.
     *
     * Colour and font values are the shipped theme's own alias tokens, so light,
     * dark, and any future theme apply without this file knowing about them.
     *
     * The last block is the only part that touches shipped chrome. Both of its
     * rules subtract rather than restyle, and both need `!important` to beat the
     * shipped component's own single-class selectors regardless of which
     * stylesheet the shell happened to append last:
     *
     *   - `nav[class*="_panelList"]` is the shell's global panel row list (the
     *     Pull requests / Scheduled / Plugins rows). This skin shows Projects
     *     and Recents instead, so the row list is removed in both the expanded
     *     column and the collapsed rail. The selector is not scoped to this
     *     plugin's marker attribute on purpose: the rail drops the marker, and
     *     the class suffix is unique to the sidebar's own CSS module.
     *   - `[data-dshcx] [class*="_newSession"]` is the shipped New Session
     *     button, which this skin replaces with its own New chat row while the
     *     column is expanded. The rail keeps the shipped button, because a
     *     36px icon is already the right shape there.
     */
    const CSS = `
.dshcx-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-right: var(--dsh-sidebar-inline-padding, 12px);
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}

/* The one gesture that needs no project. */
.dshcx-new {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  margin: 2px 0 6px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshcx-new:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshcx-new:disabled { cursor: default; opacity: .6; }
.dshcx-newicon { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); }
.dshcx-newlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshcx-spin { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); animation: dshcx-spin 1s linear infinite; }
@keyframes dshcx-spin { to { transform: rotate(360deg); } }

.dshcx-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-bottom: 8px; }
.dshcx-scroll::-webkit-scrollbar { width: 8px; }
.dshcx-scroll::-webkit-scrollbar-track { background: transparent; }
.dshcx-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
.dshcx-scroll:hover::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l2); }
.dshcx-scroll::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2); }

.dshcx-section { display: block; margin-bottom: 4px; }
.dshcx-section + .dshcx-section { margin-top: 6px; }
.dshcx-sectionhead { display: flex; align-items: center; gap: 2px; height: 26px; }
.dshcx-sectiontoggle {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 24px;
  padding: 0 6px 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.dshcx-sectiontoggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshcx-sectionlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshcx-sectioncount { flex: none; font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dshcx-headaction {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  opacity: 0;
}
.dshcx-sectionhead:hover .dshcx-headaction,
.dshcx-headaction:focus-visible { opacity: 1; }
.dshcx-headaction:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dshcx-rowwrap { position: relative; display: block; }
.dshcx-nested { padding-left: 18px; }
.dshcx-row {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshcx-row:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshcx-row:disabled { cursor: default; }
.dshcx-row-on { background: var(--dsw-alias-interactive-bg-active); font-weight: 500; }
.dshcx-rowicon { display: inline-flex; flex: none; }
.dshcx-rowlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
.dshcx-rowactions {
  position: absolute;
  top: 50%;
  right: 4px;
  display: none;
  align-items: center;
  gap: 2px;
  transform: translateY(-50%);
}
.dshcx-rowwrap:hover .dshcx-rowactions { display: inline-flex; }
.dshcx-rowaction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshcx-rowaction:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.dshcx-rowaction:disabled { cursor: default; opacity: .5; }
/* The confirm strip a session row becomes between the gesture and the archive:
   the row itself is the question and the two answers, so nothing new appears
   under the reader's cursor. */
.dshcx-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 6px 0 8px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dshcx-confirmtext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshcx-confirmbtn {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border: none;
  border-radius: 999px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dshcx-confirmyes { background: var(--dsw-alias-state-error-primary); color: #fff; }
.dshcx-confirmyes:hover:not(:disabled) { opacity: .85; }
.dshcx-confirmyes:disabled { cursor: default; opacity: .5; }
.dshcx-confirmno { background: transparent; color: var(--dsw-alias-label-secondary); }
.dshcx-confirmno:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshcx-confirmno:disabled { cursor: default; opacity: .5; }
.dshcx-confirmerror { flex: none; max-width: 45%; overflow: hidden; color: var(--dsw-alias-state-error-primary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dshcx-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }

.dshcx-empty { padding: 4px 8px 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dshcx-emptytext { margin-bottom: 6px; }
.dshcx-emptybtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dshcx-emptybtn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshcx-more { padding: 2px 8px 6px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dshcx-morebtn {
  display: flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dshcx-morebtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dshcx-alert {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 17px;
}
.dshcx-alerttext { flex: 1; min-width: 0; word-break: break-word; }
.dshcx-alertclose {
  display: inline-flex;
  flex: none;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

/* --- shipped chrome this skin subtracts (see the stylesheet note above) --- */
nav[class*="_panelList"] { display: none !important; }
[data-dshcx] [class*="_newSession"] { display: none !important; }
[data-dshcx] > *:has(> [class*="_newSession"]) { display: none !important; }
[data-dshcx] { --dsh-sidebar-inline-padding: 10px !important; }
[data-dshcx] [class*="_logoRow"] { height: 44px !important; margin-bottom: 4px !important; }
`;

    /** One readable line for any thrown value. */
    const messageOf = (error) => {
      if (error === null || error === undefined) return String(error);
      if (typeof error === 'string') return error;
      if (typeof error.message === 'string' && error.message !== '') return error.message;
      return String(error);
    };

    /**
     * Insert this plugin's stylesheet once.
     * @returns a disposer that removes the tag this call inserted.
     */
    const insertStyles = () => {
      if (typeof document === 'undefined') return () => {};
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']') !== null) {
        return () => {};
      }
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-plugin-codex-ui';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    };

    /** Read one persisted JSON value. */
    const readStored = (key) => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? undefined : JSON.parse(raw);
      } catch (error) {
        return undefined;
      }
    };

    /** Persist one JSON value. A private-mode or quota failure only costs persistence. */
    const writeStored = (key, value) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        // Deliberately swallowed.
      }
    };

    /** Drop one persisted value. Also swallowed: an absent key is the same state. */
    const clearStored = (key) => {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        // Deliberately swallowed.
      }
    };

    /**
     * The project-less chat the New chat row minted last, as persisted state.
     *
     * One chat deep, because the gesture mints a directory per click and unwinds
     * the previous one before the next exists. Persisting the record is what lets
     * a LATER page load clean up after a tab that closed on an untouched chat:
     * nothing else identifies a directory a crash strands.
     * @returns the record, or undefined when there is none.
     */
    const readPending = () => {
      const value = readStored(PENDING_KEY);
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        && typeof value.sessionId === 'string' && value.sessionId !== ''
        ? value
        : undefined;
    };

    /** Forget the recorded chat without touching anything it references. */
    const forgetPending = () => { clearStored(PENDING_KEY); };

    /**
     * Storage prefix the conversation package persists one chat's draft under.
     *
     * Deliberately the one place this skin reads another package's storage: a chat
     * holding typed text is NOT an unused chat, and every cleanup path has to be
     * able to tell. Nothing else about the draft is read or written, and a rename
     * on that side degrades to the empty string — the same answer as a chat
     * nobody typed into.
     */
    const CONVERSATION_DRAFT_PREFIX = 'dsh.conversation.';

    /**
     * The unsent text one chat is holding, as its own store persists it.
     * @param sessionId - the chat to read.
     * @returns the draft text, or '' when there is nothing to read.
     */
    const readDraftText = (sessionId) => {
      try {
        const raw = window.localStorage.getItem(CONVERSATION_DRAFT_PREFIX + sessionId);
        if (raw === null) return '';
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && typeof parsed.draft === 'string'
          ? parsed.draft
          : '';
      } catch (error) {
        return '';
      }
    };

    /**
     * Section fold state that outlives a reload.
     * @param key - storage key.
     * @param initial - the fold state used before anything is stored.
     * @returns the current state and a patch function.
     */
    const useStored = (key, initial) => {
      const [value, setValue] = react.useState(() => {
        const stored = readStored(key);
        return stored !== null && typeof stored === 'object' && !Array.isArray(stored)
          ? Object.assign({}, initial, stored)
          : initial;
      });
      const patch = react.useCallback((change) => {
        setValue((previous) => {
          const next = Object.assign({}, previous, change);
          writeStored(key, next);
          return next;
        });
      }, [key]);
      return [value, patch];
    };

    /** Last path segment, for labels that must stay short. */
    const baseName = (value) => {
      if (typeof value !== 'string' || value === '') return '';
      const parts = value.split(/[/\\]/).filter(Boolean);
      return parts.length === 0 ? value : parts[parts.length - 1];
    };

    /** Separator- and trailing-slash-insensitive spelling of a host path. */
    const pathKey = (value) => (
      typeof value === 'string' ? value.replace(/\\/g, '/').replace(/\/+$/, '') : ''
    );

    /** Whether a working directory sits inside a project directory. */
    const withinPath = (cwd, root) => {
      const child = pathKey(cwd);
      const parent = pathKey(root);
      if (parent === '' || child === '') return false;
      return child === parent || child.startsWith(parent + '/');
    };

    /** The label one session row shows: the durable title, then the projected one. */
    const sessionLabel = (row) => {
      if (typeof row.title === 'string' && row.title !== '') return row.title;
      if (typeof row.displayTitle === 'string' && row.displayTitle !== '') return row.displayTitle;
      return String(row.id);
    };

    /**
     * Whether one session belongs in a list — the shipped browser's own rule with
     * one addition, shared by both listing paths so they cannot disagree: the
     * store knows the row, it is not a subagent, and a BLANK row is listed while
     * it is the selection or while it holds unsent text.
     *
     * A blank session is an empty new session, and a project that showed every
     * abandoned one would fill up with empty chats. A chat the reader has typed
     * into is not abandoned, though, and hiding it would put its text beyond the
     * reach of the only surface that could ever send it — so it keeps its row
     * until it is sent, or until its text is gone and the cleanup reclaims it.
     * @param row - the list-store row, possibly absent.
     * @param id - the row's session id.
     * @param currentId - the selected session, if any.
     */
    const isListable = (row, id, currentId) => row !== undefined && row !== null
      && row.origin !== 'subagent'
      && !(row.blank === true && id !== currentId && readDraftText(id) === '');

    /**
     * Allocate one fresh working directory through this package's node half.
     * @returns the allocation payload, or a payload carrying `error`.
     */
    const allocateScratch = async () => {
      try {
        const response = await fetch(SCRATCH_PATH, {
          method: 'POST',
          headers: { accept: 'application/json' },
        });
        const payload = await response.json().catch(() => null);
        if (payload === null || typeof payload !== 'object') return { error: 'the server sent no usable reply' };
        return payload;
      } catch (error) {
        return { error: messageOf(error) };
      }
    };

    /**
     * Report the allocation root, and every directory currently minted under it.
     * @returns the payload, or {} when the node half did not answer.
     */
    const readScratch = async () => {
      try {
        const response = await fetch(SCRATCH_PATH, { headers: { accept: 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (payload === null || typeof payload !== 'object') return {};
        return payload;
      } catch (error) {
        return {};
      }
    };

    /**
     * Delete working directories this plugin allocated, by name.
     * @param names - single path segments returned by a previous allocation.
     */
    const deleteScratch = async (names) => {
      try {
        await fetch(SCRATCH_DELETE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ names }),
        });
      } catch (error) {
        // A failed rollback only leaves an empty directory behind.
      }
    };

    /**
     * One collapsible section header: a title and an optional action.
     *
     * No chevron: the title IS the control, and it sits on the same left inset as
     * the row glyphs below it, so the section reads as a heading rather than as a
     * row of its own. A collapsed section reports how much it is hiding instead.
     * @param props - label, fold state, count, toggle, and the action element.
     */
    function SectionHeader({ label, open, count, onToggle, action }) {
      return react.createElement('div', { className: 'dshcx-sectionhead' },
        react.createElement('button', {
          type: 'button',
          className: 'dshcx-sectiontoggle',
          title: label,
          'aria-expanded': open,
          onClick: onToggle,
        },
        react.createElement('span', { className: 'dshcx-sectionlabel' }, label),
        open ? null : react.createElement('span', { className: 'dshcx-sectioncount' }, String(count))),
        action === undefined || action === null ? null : action);
    }

    /**
     * One session row: title, a running dot, and the remove control.
     *
     * There is no relative time on the row: the title gets the whole width
     * instead, and when a chat was last touched is not what the reader is
     * scanning the list for.
     *
     * Removing a chat IS archiving it, because `archiveSession` is the only
     * removal the Host has. Archiving is one-way — no unarchive exists in the
     * client API, in the Host commands, or in the shipped UI — while the session
     * log itself stays on disk. So the control is deliberately two steps: the
     * trash turns the row into the question, naming the chat it would archive,
     * and only the answer archives it. A hover-revealed, one-click, one-way
     * control at the exact right edge of a row the reader is aiming at is a trap;
     * a question is not.
     *
     * The row is never `disabled` either: a gesture that hangs elsewhere must not
     * be able to take the whole list away from the reader.
     * @param props - row, selection, indentation, and the row's callbacks.
     */
    function SessionRow({ t, row, selected, nested, onOpen, onRemove }) {
      const label = sessionLabel(row);
      const detail = typeof row.cwd === 'string' && row.cwd !== '' ? row.cwd : '';
      const [asking, setAsking] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [failure, setFailure] = react.useState(null);
      const indent = nested === true ? ' dshcx-nested' : '';

      if (asking) {
        return react.createElement('div', { className: 'dshcx-rowwrap' + indent },
          react.createElement('div', { className: 'dshcx-confirm' },
            react.createElement('span', {
              className: 'dshcx-confirmtext',
              title: detail === '' ? label : label + ' — ' + detail,
            }, t('sessions.removeConfirm', { title: label })),
            failure === null ? null : react.createElement('span', {
              className: 'dshcx-confirmerror',
              title: failure,
            }, failure),
            react.createElement('button', {
              type: 'button',
              className: 'dshcx-confirmbtn dshcx-confirmyes',
              disabled: busy,
              onClick: () => {
                setBusy(true);
                setFailure(null);
                Promise.resolve(onRemove(row.id)).then(() => {
                  // The row normally disappears with the archive; this only covers
                  // a Host that accepted the call without the list moving.
                  setBusy(false);
                  setAsking(false);
                }).catch((reason) => {
                  setFailure(t('sessions.removeFailed', { message: messageOf(reason) }));
                  setBusy(false);
                });
              },
            }, t('sessions.removeYes')),
            react.createElement('button', {
              type: 'button',
              className: 'dshcx-confirmbtn dshcx-confirmno',
              disabled: busy,
              onClick: () => { setAsking(false); setFailure(null); },
            }, t('sessions.removeNo'))));
      }

      return react.createElement('div', { className: 'dshcx-rowwrap' + indent },
        react.createElement('button', {
          type: 'button',
          className: 'dshcx-row' + (selected ? ' dshcx-row-on' : ''),
          title: detail === '' ? label : label + ' — ' + detail,
          'aria-current': selected ? 'page' : undefined,
          onClick: () => { onOpen(row.id); },
        },
        react.createElement('span', { className: 'dshcx-rowlabel' }, label),
        row.running === true ? react.createElement('span', { className: 'dshcx-dot', 'aria-hidden': 'true' }) : null),
        onRemove === undefined
          ? null
          : react.createElement('span', { className: 'dshcx-rowactions' },
            react.createElement(Tooltip, { label: t('sessions.remove'), delayMs: 500 },
              react.createElement('button', {
                type: 'button',
                className: 'dshcx-rowaction',
                'aria-label': t('sessions.remove'),
                onClick: (event) => { event.stopPropagation(); setAsking(true); },
              }, react.createElement(IconTrashOutline16, { size: 12 })))));
    }

    /**
     * One project row: a fold control, its sessions when open, and the two
     * gestures that belong to a project — a new chat inside it, and removing its
     * registration (which never touches the directory or the session logs).
     *
     * The folder glyph carries the fold state (closed vs open) instead of a
     * chevron, which keeps the row to one leading mark and still says whether the
     * row is showing its chats.
     * @param props - workspace, its sessions, and the row's callbacks.
     */
    function ProjectRow({ t, workspace, sessions, selectedId, open, onToggle, onOpen, onNewChat, onRemove, onRemoveSession }) {
      const title = typeof workspace.title === 'string' && workspace.title !== ''
        ? workspace.title
        : baseName(workspace.path);
      const holdsCurrent = sessions.some((row) => row.id === selectedId);
      return react.createElement('div', { className: 'dshcx-project' },
        react.createElement('div', { className: 'dshcx-rowwrap' },
          react.createElement('button', {
            type: 'button',
            className: 'dshcx-row' + (holdsCurrent ? ' dshcx-row-on' : ''),
            title: workspace.path,
            'aria-expanded': open,
            onClick: onToggle,
          },
          react.createElement('span', { className: 'dshcx-rowicon' },
            react.createElement(open ? IconFolderOpen16 : IconFolderClose16, { size: 14 })),
          react.createElement('span', { className: 'dshcx-rowlabel' }, title)),
          react.createElement('span', { className: 'dshcx-rowactions' },
            react.createElement(Tooltip, { label: t('projects.newChat'), delayMs: 500 },
              react.createElement('button', {
                type: 'button',
                className: 'dshcx-rowaction',
                'aria-label': t('projects.newChat'),
                onClick: (event) => { event.stopPropagation(); onNewChat(workspace.workspaceId); },
              }, react.createElement(IconPlusOutline16, { size: 12 }))),
            react.createElement(Tooltip, { label: t('projects.remove'), delayMs: 500 },
              react.createElement('button', {
                type: 'button',
                className: 'dshcx-rowaction',
                'aria-label': t('projects.remove'),
                onClick: (event) => { event.stopPropagation(); onRemove(workspace.workspaceId); },
              }, react.createElement(IconTrashOutline16, { size: 12 }))))),
        open === true
          ? react.createElement('div', { className: 'dshcx-projectbody' },
            sessions.length === 0
              ? react.createElement('div', { className: 'dshcx-empty dshcx-nested' }, t('projects.sessionsEmpty'))
              : sessions.slice(0, PROJECT_SESSIONS).map((row) => react.createElement(SessionRow, {
                key: row.id,
                t,
                row,
                nested: true,
                selected: row.id === selectedId,
                onOpen,
                onRemove: onRemoveSession,
              })),
            sessions.length > PROJECT_SESSIONS
              ? react.createElement('div', { className: 'dshcx-more dshcx-nested' },
                t('projects.more', { n: sessions.length - PROJECT_SESSIONS }))
              : null)
          : null);
    }

    /**
     * The browsing region: a New chat row over two collapsible sections.
     *
     * Data arrives through the framework's global standard hooks
     * (`useSessions` / `useWorkspaces`), and every Host action arrives through
     * this registration's own inject face. Nothing here reads a Host fact that
     * would freeze at first render, which is why the inject factories return
     * plain callbacks and not values.
     * @param props - shell owner share, standard hooks, locale, and the inject face.
     */
    function CodexBrowser(props) {
      const {
        wide, t, useSessions, useWorkspaces,
        startNewChat, cleanupPending, reclaimScratch,
        startInWorkspace, openSession,
        adoptWorkspace, removeWorkspace, pickDirectory, loadScratchRoot, archiveSession,
      } = props;

      const hostRef = react.useRef(null);
      const [sections, patchSections] = useStored(SECTIONS_KEY, { projects: true, recents: true });
      const [expanded, setExpanded] = react.useState({});
      const [recentVisible, setRecentVisible] = react.useState(RECENT_DEFAULT);
      const [busy, setBusy] = react.useState(false);
      const [creating, setCreating] = react.useState(false);
      const [alert, setAlert] = react.useState(null);

      const sessions = useSessions((snapshot) => snapshot);
      const workspaceState = useWorkspaces((snapshot) => snapshot);

      const workspaces = workspaceState !== undefined && workspaceState !== null
        && Array.isArray(workspaceState.items) ? workspaceState.items : [];
      const rows = sessions === undefined || sessions === null ? undefined : sessions.byId;
      const ids = sessions === undefined || sessions === null || !Array.isArray(sessions.ids) ? [] : sessions.ids;
      const currentId = sessions === undefined || sessions === null ? undefined : sessions.current;
      const sessionsPhase = sessions === undefined || sessions === null ? undefined : sessions.phase;
      const loading = sessionsPhase === 'pending'
        || (workspaceState !== undefined && workspaceState !== null && workspaceState.phase === 'pending');

      /**
       * The Host's archive set, as a lookup.
       *
       * The session list itself never carries this: archiving is a Workspace
       * projection concern, so the shipped browsing region subtracts the set
       * itself — and so must this one. Without it a chat the reader just removed
       * would keep its row until the page was reloaded.
       */
      const archivedIds = react.useMemo(() => {
        const archived = workspaceState !== undefined && workspaceState !== null
          && Array.isArray(workspaceState.archivedSessionIds)
          ? workspaceState.archivedSessionIds
          : [];
        return new Set(archived);
      }, [workspaceState]);

      /**
       * The directory root this skin mints project-less working directories
       * under, which is the only thing that distinguishes a workspace it created
       * from one the reader registered on purpose.
       *
       * The read is retried while it has not answered yet: the root never
       * changes, so one successful answer is enough for the life of the page, and
       * until it arrives every workspace reads as a project — the safe direction,
       * since nothing is hidden from Projects on a guess.
       */
      const [scratchRoot, setScratchRoot] = react.useState(undefined);
      react.useEffect(() => {
        if (scratchRoot !== undefined) return () => {};
        let alive = true;
        void loadScratchRoot().then((root) => {
          if (alive && typeof root === 'string' && root !== '') setScratchRoot(root);
        });
        return () => { alive = false; };
      }, [scratchRoot, workspaces.length, loadScratchRoot]);

      /** The workspaces that are projects: every workspace this skin did not mint. */
      const projectWorkspaces = react.useMemo(
        () => workspaces.filter((workspace) => scratchRoot === undefined || !withinPath(workspace.path, scratchRoot)),
        [workspaces, scratchRoot],
      );

      /**
       * Reclaim the project-less chat the New chat row minted once the reader has
       * moved on from it without ever using it.
       *
       * Five facts decide it, and each is a way the chat is still spoken for: it
       * has messages (it is a real chat now, and is only forgotten), it holds
       * typed text (nobody's unsent draft is thrown away to reclaim a directory),
       * it is the current selection (the reader may be typing in it), it was
       * minted moments ago (the selection has not caught up with the mint yet), or
       * the list has not settled enough to say. Everything else — a selection
       * elsewhere, an archived row, a row the Host no longer lists — is a chat
       * nobody can come back to, so its directory goes with it.
       *
       * The settle window is a timer and not just a comparison: every fact that
       * triggers this effect has settled down before the window expires, so
       * without a scheduled wake-up the wait would never be re-checked and the
       * mint would stand for good.
       */
      const [settleTick, setSettleTick] = react.useState(0);
      react.useEffect(() => {
        if (loading) return undefined;
        const record = readPending();
        if (record === undefined) return undefined;
        const row = rows === undefined ? undefined : rows[record.sessionId];
        if (row !== undefined && row.blank !== true) {
          forgetPending();
          return undefined;
        }
        const dropped = archivedIds.has(record.sessionId)
          || (row === undefined && sessionsPhase === 'ready');
        if (readDraftText(record.sessionId) !== '' && !dropped) return undefined;
        const left = currentId !== undefined && currentId !== record.sessionId;
        if (!dropped && !left) return undefined;
        const waits = (typeof record.at === 'number' ? record.at : 0) + SCRATCH_SETTLE_MS - Date.now();
        if (waits > 0 && !dropped) {
          const timer = window.setTimeout(() => { setSettleTick((tick) => tick + 1); }, waits + 50);
          return () => { window.clearTimeout(timer); };
        }
        void Promise.resolve(cleanupPending(row !== undefined)).catch(() => {});
        return undefined;
      }, [loading, currentId, rows, archivedIds, sessionsPhase, cleanupPending, settleTick]);

      /**
       * The chats this skin minted that no reader has ever touched: workspaces
       * under its own root whose every chat is known, blank, untyped and not the
       * one on screen.
       *
       * This is the load-time net under the rollback above. It catches what no
       * gesture can reach — a start that failed between minting and recording, a
       * record lost with the browser's storage, a version of this skin that
       * minted before recording existed. Only chats the list KNOWS are blank
       * qualify: a session id with no row (an older chat outside the loaded
       * window, a chat this tab has not heard of) is not evidence of an unused
       * directory, and treating it as such is how a cleanup deletes live work.
       */
      const strandedScratch = react.useMemo(() => {
        if (scratchRoot === undefined || rows === undefined) return [];
        const record = readPending();
        const stranded = [];
        for (const workspace of workspaces) {
          if (typeof workspace.path !== 'string' || workspace.path === '') continue;
          if (!withinPath(workspace.path, scratchRoot)) continue;
          if (record !== undefined && workspace.workspaceId === record.workspaceId) continue;
          const held = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
          if (currentId !== undefined && held.includes(currentId)) continue;
          const touched = held.some((id) => {
            const row = rows[id];
            if (row === undefined || row === null) return !archivedIds.has(id);
            return row.blank !== true;
          });
          if (touched) continue;
          if (held.some((id) => readDraftText(id) !== '')) continue;
          stranded.push(workspace);
        }
        return stranded;
      }, [scratchRoot, workspaces, rows, currentId, archivedIds]);

      /**
       * Sweep, once per page and only after everything it checks against has
       * arrived. Two passes, because a minted directory can be stranded in two
       * ways: a workspace this skin registered that holds nothing but untouched
       * chats, and a directory no workspace and no chat refers to at all. Every
       * workspace path and every chat's working directory counts as a reference,
       * so a directory live work sits in is never a candidate.
       *
       * The scratch root is one of the arrivals, and the one that arrives last:
       * the root is a round trip of its own, and sweeping before it lands would
       * run the workspace pass blind — which is exactly the pass that catches a
       * chat whose record was lost with the browser's storage.
       */
      const sweptScratch = react.useRef(false);
      react.useEffect(() => {
        if (sweptScratch.current || loading || sessionsPhase !== 'ready') return;
        if (workspaceState !== undefined && workspaceState !== null && workspaceState.phase !== 'ready') return;
        if (scratchRoot === undefined) return;
        sweptScratch.current = true;
        const referenced = new Set();
        for (const workspace of workspaces) {
          if (typeof workspace.path === 'string' && workspace.path !== '') referenced.add(pathKey(workspace.path));
        }
        if (rows !== undefined) {
          for (const id of Object.keys(rows)) {
            const row = rows[id];
            if (row !== undefined && row !== null && typeof row.cwd === 'string' && row.cwd !== '') {
              referenced.add(pathKey(row.cwd));
            }
          }
        }
        const record = readPending();
        void Promise.resolve(reclaimScratch({
          referenced,
          keepName: record === undefined ? undefined : record.name,
          stranded: strandedScratch,
        })).catch(() => {});
      }, [loading, sessionsPhase, workspaceState, workspaces, rows, scratchRoot, strandedScratch, reclaimScratch]);

      // Mark the shipped sidebar column so the stylesheet can subtract the two
      // shipped controls this skin replaces. The marker is only set while the
      // column is expanded: the rail keeps the shipped New Session button.
      react.useEffect(() => {
        const node = hostRef.current;
        if (node === null) return () => {};
        const region = node.closest('[class*="regionArea"]');
        const root = region === null ? node.parentElement : region.parentElement;
        if (root === null) return () => {};
        root.setAttribute('data-dshcx', '');
        return () => { root.removeAttribute('data-dshcx'); };
      }, [wide]);

      // Open the project that owns the selected session, once per selection, so
      // the current chat is always reachable without hunting for it. A chat that
      // lives in a project-less workspace has no project row to open.
      const followedCurrent = react.useRef(undefined);
      react.useEffect(() => {
        if (currentId === undefined || followedCurrent.current === currentId) return;
        followedCurrent.current = currentId;
        const owner = projectWorkspaces.find((workspace) => (
          Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(currentId)
        ));
        if (owner === undefined) return;
        setExpanded((previous) => (
          previous[owner.workspaceId] === true
            ? previous
            : Object.assign({}, previous, { [owner.workspaceId]: true })
        ));
      }, [currentId, projectWorkspaces]);

      /**
       * Every session that can be listed, in host list order: the archived ones
       * are already gone, and so is anything that is not a chat of its own.
       */
      const listable = react.useMemo(() => {
        if (rows === undefined) return [];
        const collected = [];
        for (const id of ids) {
          if (archivedIds.has(id)) continue;
          const row = rows[id];
          if (isListable(row, id, currentId)) collected.push(row);
        }
        return collected;
      }, [rows, ids, currentId, archivedIds]);

      /**
       * Where every listable chat belongs: one bucket per project, plus Recents.
       *
       * Ownership takes `sessionIds` as authoritative — a session accounted to a
       * workspace belongs to it even if its directory later moved — and falls
       * back to directory containment, assigned to the DEEPEST matching
       * workspace, so a workspace nested inside another never claims the inner
       * one's chats as well.
       *
       * Only the owner's KIND decides the list, not whether an owner exists:
       * ownership by a project puts the chat under that project, and ownership by
       * a workspace this skin minted — or by nothing at all — puts it in Recents.
       * That is what keeps a project-less chat out of Projects while still
       * letting it be a perfectly ordinary workspace session.
       */
      const classify = react.useMemo(() => {
        const claimed = new Map();
        for (const workspace of workspaces) {
          if (!Array.isArray(workspace.sessionIds)) continue;
          for (const id of workspace.sessionIds) {
            if (!claimed.has(id)) claimed.set(id, workspace.workspaceId);
          }
        }
        const deepest = (cwd) => {
          let best;
          let bestLength = -1;
          for (const workspace of workspaces) {
            if (!withinPath(cwd, workspace.path)) continue;
            const length = pathKey(workspace.path).length;
            if (length > bestLength) {
              best = workspace.workspaceId;
              bestLength = length;
            }
          }
          return best;
        };
        const projectIds = new Set(projectWorkspaces.map((workspace) => workspace.workspaceId));
        const buckets = new Map();
        for (const workspace of projectWorkspaces) buckets.set(workspace.workspaceId, []);
        const recents = [];
        for (const row of listable) {
          const owner = claimed.has(row.id) ? claimed.get(row.id) : deepest(row.cwd);
          if (owner !== undefined && projectIds.has(owner)) buckets.get(owner).push(row);
          else recents.push(row);
        }
        const newestFirst = (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0);
        for (const bucket of buckets.values()) bucket.sort(newestFirst);
        recents.sort(newestFirst);
        return { buckets, recents };
      }, [workspaces, projectWorkspaces, listable]);

      /**
       * Run one PROJECT gesture with shared failure reporting.
       *
       * Only the gestures that mutate a registration come through here, and the
       * busy flag gates nothing but them: it must never be able to disable the
       * list, because a control the reader cannot press is worse than one that
       * can be pressed twice.
       */
      const run = (work, message) => {
        if (busy) return;
        setBusy(true);
        setAlert(null);
        Promise.resolve()
          .then(work)
          .catch((reason) => { setAlert(t(message, { message: messageOf(reason) })); })
          .finally(() => { setBusy(false); });
      };

      /**
       * Open a chat. Deliberately outside the busy guard: navigation has to keep
       * working whatever else may be in flight.
       */
      const openNow = (sessionId) => {
        try {
          openSession(sessionId);
        } catch (reason) {
          setAlert(t('action.failed', { message: messageOf(reason) }));
        }
      };

      const projectsOpen = sections.projects !== false;
      const recentsOpen = sections.recents !== false;

      // The rail draws its own icons, so this region renders nothing there.
      if (wide !== true) return null;

      /**
       * Add a project: ask the Host for its directory chooser, then adopt what
       * came back. A cancelled chooser resolves to null and is not a failure —
       * only a chooser that could not be opened, or a directory the registry
       * refuses, reaches the caller as one.
       * @returns the adopted workspace, or null when the chooser was cancelled.
       */
      const onChooseProject = async () => {
        const picked = await pickDirectory();
        if (typeof picked !== 'string' || picked === '') return null;
        const workspace = await adoptWorkspace(picked);
        if (workspace !== undefined && workspace !== null && typeof workspace.workspaceId === 'string') {
          setExpanded((previous) => Object.assign({}, previous, { [workspace.workspaceId]: true }));
          patchSections({ projects: true });
        }
        return workspace;
      };

      /**
       * Start a project-less chat. Its own pending flag rather than the shared
       * `busy` guard: this row mints a directory and a session, which is a
       * different kind of work from rearranging project rows, and a click that
       * has to wait behind one of those would read as a dead control. The row
       * reports the wait with its own spinner and refuses only its own repeat.
       */
      const onNewChat = () => {
        if (creating) return;
        setCreating(true);
        setAlert(null);
        Promise.resolve()
          .then(() => startNewChat())
          .catch((reason) => { setAlert(t('start.failed', { message: messageOf(reason) })); })
          .finally(() => { setCreating(false); });
      };

      return react.createElement('div', { className: 'dshcx-root', ref: hostRef },
        react.createElement(Tooltip, { label: t('new.hint'), delayMs: 600 },
          react.createElement('button', {
            type: 'button',
            className: 'dshcx-new',
            onClick: onNewChat,
          },
          react.createElement('span', { className: 'dshcx-newicon' },
            creating
              ? react.createElement('span', { className: 'dshcx-spin' },
                react.createElement(IconRefreshOutline16, { size: 14 }))
              : react.createElement(IconNewChatOutline16, { size: 14 })),
          react.createElement('span', { className: 'dshcx-newlabel' }, t('new.label')))),

        alert === null ? null : react.createElement('div', { className: 'dshcx-alert', role: 'alert' },
          react.createElement(IconWarningOutline16, { size: 12 }),
          react.createElement('span', { className: 'dshcx-alerttext' }, alert),
          react.createElement('button', {
            type: 'button',
            className: 'dshcx-alertclose',
            'aria-label': t('dismiss'),
            onClick: () => { setAlert(null); },
          }, react.createElement(IconCloseOutline16, { size: 12 }))),

        react.createElement('div', { className: 'dshcx-scroll' },
          loading
            ? react.createElement('div', { className: 'dshcx-empty' }, t('loading'))
            : react.createElement(react.Fragment, null,
              react.createElement('section', { className: 'dshcx-section' },
                react.createElement(SectionHeader, {
                  label: t('projects.title'),
                  open: projectsOpen,
                  count: projectWorkspaces.length,
                  onToggle: () => { patchSections({ projects: !projectsOpen }); },
                  action: react.createElement(Tooltip, { label: t('projects.add'), delayMs: 500 },
                    react.createElement('button', {
                      type: 'button',
                      className: 'dshcx-headaction',
                      'aria-label': t('projects.add'),
                      onClick: () => { run(onChooseProject, 'add.failed'); },
                    }, react.createElement(IconProjectAddOutline16, { size: 14 }))),
                }),
                projectsOpen
                  ? react.createElement('div', { className: 'dshcx-sectionbody' },
                    projectWorkspaces.length === 0
                      ? react.createElement('div', { className: 'dshcx-empty' },
                        react.createElement('div', { className: 'dshcx-emptytext' }, t('projects.empty')),
                        react.createElement('button', {
                          type: 'button',
                          className: 'dshcx-emptybtn',
                          onClick: () => { run(onChooseProject, 'add.failed'); },
                        }, t('projects.add')))
                      : projectWorkspaces.map((workspace) => react.createElement(ProjectRow, {
                        key: workspace.workspaceId,
                        t,
                        workspace,
                        sessions: classify.buckets.get(workspace.workspaceId) || [],
                        selectedId: currentId,
                        open: expanded[workspace.workspaceId] === true,
                        onToggle: () => {
                          setExpanded((previous) => Object.assign({}, previous, {
                            [workspace.workspaceId]: previous[workspace.workspaceId] !== true,
                          }));
                        },
                        onOpen: openNow,
                        onNewChat: (workspaceId) => { run(() => startInWorkspace(workspaceId), 'start.failed'); },
                        onRemove: (workspaceId) => { run(() => removeWorkspace(workspaceId), 'action.failed'); },
                        onRemoveSession: archiveSession,
                      })))
                  : null),

              react.createElement('section', { className: 'dshcx-section' },
                react.createElement(SectionHeader, {
                  label: t('recents.title'),
                  open: recentsOpen,
                  count: classify.recents.length,
                  onToggle: () => { patchSections({ recents: !recentsOpen }); },
                }),
                recentsOpen
                  ? react.createElement('div', { className: 'dshcx-sectionbody' },
                    classify.recents.length === 0
                      ? react.createElement('div', { className: 'dshcx-empty' },
                        react.createElement('div', { className: 'dshcx-emptytext' }, t('recents.empty')))
                      : react.createElement(react.Fragment, null,
                        classify.recents.slice(0, recentVisible).map((row) => react.createElement(SessionRow, {
                          key: row.id,
                          t,
                          row,
                          selected: row.id === currentId,
                          onOpen: openNow,
                          onRemove: archiveSession,
                        })),
                        classify.recents.length > recentVisible
                          ? react.createElement('button', {
                            type: 'button',
                            className: 'dshcx-morebtn',
                            onClick: () => { setRecentVisible((visible) => visible + RECENT_PAGE); },
                          },
                          react.createElement(IconChevronDownOutline14, { size: 12 }),
                          t('recents.more'))
                          : null,
                        recentVisible > RECENT_DEFAULT && classify.recents.length <= recentVisible
                          ? react.createElement('button', {
                            type: 'button',
                            className: 'dshcx-morebtn',
                            onClick: () => { setRecentVisible(RECENT_DEFAULT); },
                          }, t('recents.less'))
                          : null))
                  : null))));
    }

    /**
     * The wordmark that takes the shipped build badge's place in the brand row.
     *
     * The shipped fallback is the local build stamp, so naming the product here
     * is the whole point; the string below is the one place to change it.
     */
    function BrandName() {
      return 'Whale Isle';
    }

    /**
     * Required browser services: the seat ledger, the copy, the session list feed
     * this region reads through the global `useSessions` hook, and the Workspace
     * plus navigation controllers every start and open gesture goes through.
     */
    const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace'];

    /**
     * Client plugin body: seat the dictionary and the stylesheet, then fill the
     * brand-name cell and the browsing region.
     * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
     */
    function install(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-codex-ui: dictionaries');
      ctx.effect(() => insertStyles(), 'dsh-plugin-codex-ui: stylesheet');

      /**
       * Unwind one recorded project-less chat: archive its session, drop its
       * workspace registration, remove its directory.
       *
       * Each step is best effort and the record is forgotten first, because a
       * failure part-way must not leave the record pointing at a chat that is
       * already half gone: the directory is the only thing that can survive
       * unnoticed, and a directory nothing refers to is exactly what the orphan
       * sweep deletes on the next load.
       * @param record - the persisted record.
       * @param sessionExists - whether the Host still lists the session.
       */
      const unwindPending = async (record, sessionExists) => {
        forgetPending();
        if (sessionExists === true) {
          try {
            await ctx.workspaces.archiveSession(record.sessionId);
          } catch (error) {
            // A chat that could not be archived keeps its row; the rest still goes.
          }
        }
        if (typeof record.workspaceId === 'string' && record.workspaceId !== '') {
          try {
            await ctx.workspaces.delete(record.workspaceId);
          } catch (error) {
            // A refused removal leaves one project row for the reader to remove.
          }
        }
        if (typeof record.name === 'string' && record.name !== '') await deleteScratch([record.name]);
      };

      /**
       * Start a project-less chat: mint a working directory, register it as a
       * workspace, create the chat in it, open it.
       *
       * This is the shipped New Session order with a directory the reader never
       * had to choose. It is staged so a failure cannot leave a half-built chat:
       * a directory whose registration was refused is removed again, and one
       * whose session could not be created takes its registration and directory
       * with it. The previous minted chat is unwound FIRST, so a click can never
       * leave two of them behind — unless it holds typed text, which is a chat
       * the reader did use: that one is only forgotten, and lives on like any
       * other chat this row did not mint. A directory is cheaper than a draft.
       */
      const startNewChat = async () => {
        const previous = readPending();
        if (previous !== undefined) {
          if (readDraftText(previous.sessionId) === '') await unwindPending(previous, true);
          else forgetPending();
        }

        const scratch = await allocateScratch();
        if (scratch === null || typeof scratch !== 'object'
          || typeof scratch.path !== 'string' || scratch.path === '') {
          const detail = scratch !== null && typeof scratch === 'object' && scratch.error !== undefined
            ? messageOf(scratch.error)
            : 'the working directory could not be created';
          throw new Error(detail);
        }
        const name = typeof scratch.name === 'string' ? scratch.name : '';

        let workspace;
        try {
          workspace = await ctx.workspaces.create({ path: scratch.path });
        } catch (reason) {
          if (name !== '') await deleteScratch([name]);
          throw reason;
        }
        if (workspace === null || workspace === undefined || typeof workspace.workspaceId !== 'string') {
          if (name !== '') await deleteScratch([name]);
          throw new Error('the Host returned no workspace for ' + scratch.path);
        }

        let sessionId;
        try {
          sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId });
        } catch (reason) {
          try {
            await ctx.workspaces.delete(workspace.workspaceId);
          } catch (error) {
            // The registration is what a failed rollback would leave behind.
          }
          if (name !== '') await deleteScratch([name]);
          throw reason;
        }

        writeStored(PENDING_KEY, {
          sessionId,
          workspaceId: workspace.workspaceId,
          name,
          path: scratch.path,
          at: Date.now(),
        });
        ctx.sessions.open(sessionId);
      };

      /**
       * Reclaim the project-less directories this skin minted and nothing is
       * using any more.
       *
       * Two passes, both driven by a plan the sidebar computes from the lists it
       * already reads. The first unwinds workspaces this skin registered that hold
       * nothing but untouched chats — archived and removed exactly like the
       * rollback, so a strand left by a crash or a lost record cannot survive a
       * load. The second deletes directories that no workspace and no chat refers
       * to at all.
       *
       * Both are held back by the same grace period, read from the node half's own
       * listing: a directory younger than it may be a mint this browser tab has
       * not recorded yet, or one another tab is creating right now, and neither is
       * an orphan.
       * @param plan - referenced path keys, the recorded directory name to keep, and
       *   the stranded workspaces the sidebar found.
       * @returns how many workspaces and directories were reclaimed.
       */
      const reclaimScratch = async (plan) => {
        const payload = await readScratch();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const cutoff = Date.now() - SCRATCH_GRACE_MS;
        const ages = new Map();
        for (const item of items) {
          if (typeof item.name === 'string') {
            ages.set(item.name, typeof item.createdAt === 'number' ? item.createdAt : 0);
          }
        }

        let workspacesReclaimed = 0;
        for (const workspace of plan.stranded) {
          const name = baseName(workspace.path);
          // No age means no directory of ours under that name: nothing to reclaim.
          const createdAt = ages.get(name);
          if (createdAt === undefined || createdAt >= cutoff) continue;
          const held = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
          for (const sessionId of held) {
            try {
              await ctx.workspaces.archiveSession(sessionId);
            } catch (error) {
              // Best effort per step, exactly like the rollback.
            }
          }
          try {
            await ctx.workspaces.delete(workspace.workspaceId);
          } catch (error) {
            // A registration that will not go leaves one hidden project row.
          }
          await deleteScratch([name]);
          workspacesReclaimed += 1;
        }

        const orphans = items.filter((item) => typeof item.name === 'string' && item.name !== ''
          && item.name !== plan.keepName
          && typeof item.path === 'string' && !plan.referenced.has(pathKey(item.path))
          && typeof item.createdAt === 'number' && item.createdAt < cutoff);
        if (orphans.length > 0) await deleteScratch(orphans.map((item) => item.name));
        return { workspaces: workspacesReclaimed, directories: orphans.length };
      };

      /**
       * The registration's own inject face. Every entry is a plain callback over
       * services resolved at click time: the renderer memoizes this object for
       * the registration's lifetime, so a captured VALUE would freeze.
       */
      const browserInject = () => ({
        startNewChat,
        cleanupPending: (sessionExists) => {
          const record = readPending();
          if (record === undefined) return Promise.resolve();
          return unwindPending(record, sessionExists);
        },
        reclaimScratch,
        startInWorkspace: (workspaceId) => { ctx.uiWorkspace.startSession(workspaceId); },
        openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId); },
        loadScratchRoot: async () => {
          const payload = await readScratch();
          return typeof payload.root === 'string' && payload.root !== '' ? payload.root : undefined;
        },
        adoptWorkspace: (path) => ctx.workspaces.create({ path }),
        removeWorkspace: (workspaceId) => ctx.workspaces.delete(workspaceId),
        // Removing a chat from the sidebar is the Host's `archiveSession`: the
        // session leaves every grouping surface and its log file stays on disk.
        archiveSession: (sessionId) => ctx.workspaces.archiveSession(sessionId),
        // `pickDirectory` is a Host round trip that may end in a native dialog.
        // Bounded here so a chooser that never answers cannot leave a gesture
        // pending for the rest of the session.
        pickDirectory: () => Promise.race([
          ctx.uiWorkspace.pickDirectory(),
          new Promise((_resolve, reject) => {
            window.setTimeout(() => { reject(new Error('the directory chooser did not answer')); }, PICK_TIMEOUT_MS);
          }),
        ]),
      });

      // The product row: this skin names itself rather than showing a build hash.
      ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
        { name: 'sidebar.brand.name', priority: SHADOW_PRIORITY, locale: NS },
        BrandName,
      )), 'dsh-plugin-codex-ui: brand name');

      // The browsing region. Registering here takes the cell from the shipped
      // browser, which resumes the moment this entry is disposed or abdicates.
      ctx.effect(() => ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
        {
          name: 'sidebar.workspaces',
          priority: SHADOW_PRIORITY,
          locale: NS,
          inject: browserInject,
        },
        CodexBrowser,
      )), 'dsh-plugin-codex-ui: sidebar browser');
    }

    /**
     * Whale Isle activation: install the Codex sidebar while the Codex skin is
     * active and tear its registrations down when another skin takes over.
     * The boot skin may land after the client entries activate, so an absent
     * attribute waits for the first real value instead of assuming Codex.
     */
    function apply(ctx) {
      const skinNow = () => (typeof document === 'undefined'
        ? ''
        : document.documentElement.getAttribute('data-dsh-skin'));
      const disposers = [];
      let installed = false;
      const installNow = () => {
        if (installed) return;
        installed = true;
        const effect = ctx.effect;
        ctx.effect = function collect(execute, label) {
          const disposable = effect.call(ctx, execute, label);
          disposers.push(disposable);
          return disposable;
        };
        try {
          install(ctx);
        } finally {
          ctx.effect = effect;
        }
      };
      const teardown = () => {
        if (!installed) return;
        installed = false;
        for (const disposable of disposers.splice(0)) {
          if (typeof disposable?.dispose === 'function') void disposable.dispose();
          else if (typeof disposable === 'function') void disposable();
        }
      };
      const sync = () => {
        if (skinNow() === 'codex') installNow();
        else teardown();
      };
      if (typeof document !== 'undefined') {
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-skin'] });
      }
      sync();
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
