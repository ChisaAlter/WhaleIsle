// Entry point for the vendored `dsh-whale` client plugin (Orca-parity Bots UI).
// Compiled by `scripts/build-dsh-whale-client.mjs` into `vendor/dsh-whale/client/client.js`.

import './styles/bots.css';
import './styles/bots-panels.css';
import './styles/bots-enhancements.css';
import './styles/bots-group-enhancements.css';

import { useEffect, type ComponentType, type ReactNode } from 'react';
import { resolveActiveBotSelection } from '../shared/bot-sidebar-logic.js';
import { LOCALES, normalizeLocale } from '../shared/locales.js';
import { BotsModalHost } from './components/BotConfirmDialogs';
import {
  BotConversationActions,
  BotConversationFrame,
  BotConversationLeading,
  type BotHeaderSlotProps,
} from './components/BotConversationChrome';
import { BotFirstScreen } from './components/BotFirstScreen';
import { BotGroupRoomView } from './components/BotGroupRoomView';
import { BotRightPanel, type BotRightPanelProps } from './components/BotRightPanel';
import { BotSettingsView } from './components/BotSettingsView';
import { GlobalBotsSettings } from './components/GlobalBotsSettings';
import { IconBot } from './components/Icons';
import { SidebarBotsSection } from './components/SidebarBotsSection';
import { botsStore, type BotRightPanelTab, type HandToBotWorkspace } from './store/bots-store';
import type { BotRecord } from './store/rpc';

const NS = 'dsh-whale';
const BOTS_RIGHT_TAB_ID = 'dsh-whale:bots-panel';
const BOTS_RIGHT_TAB_KIND = 'dsh-bots';
const GROUP_PANEL_ID = 'dsh-bots:group';
const SETTINGS_PANEL_ID = 'dsh-bots:settings';
const LEGACY_WHALE_PANEL_ID = 'whale';
const PREFILL_CHAT_DRAFT_EVENT = 'dsh-bots:prefill-chat-draft';
const FLASH_CHAT_PANE_EVENT = 'dsh-bots:flash-chat-pane';
const HAND_TO_BOT_EVENT = 'dsh-bots:hand-to-bot';

const WHALE_STYLE_SELECTOR = 'style[data-dsh-whale-style]';
let cachedWhaleStyles: { id: string; css: string }[] | null = null;

function mountWhaleStyles(): () => void {
  if (typeof document === 'undefined' || !document.head) {
    return () => {};
  }
  const head = document.head;
  if (cachedWhaleStyles === null && typeof head.querySelectorAll === 'function') {
    const nodes = [...head.querySelectorAll(WHALE_STYLE_SELECTOR)];
    cachedWhaleStyles = nodes
      .map((node) => ({
        id: node.getAttribute?.('data-dsh-whale-style') ?? '',
        css: node.textContent ?? '',
      }))
      .filter((entry) => entry.id.length > 0);
  }
  if (cachedWhaleStyles) {
    for (const entry of cachedWhaleStyles) {
      const existing = typeof head.querySelector === 'function'
        ? head.querySelector(`style[data-dsh-whale-style=${JSON.stringify(entry.id)}]`)
        : null;
      if (!existing && typeof document.createElement === 'function') {
        const style = document.createElement('style');
        style.setAttribute?.('data-dsh-whale-style', entry.id);
        style.textContent = entry.css;
        head.appendChild?.(style);
      }
    }
  }
  return () => {
    if (typeof head.querySelectorAll !== 'function') return;
    for (const node of [...head.querySelectorAll(WHALE_STYLE_SELECTOR)]) {
      node.remove?.();
    }
  };
}

export const name = 'dsh-whale';
export const inject = [
  'slots',
  'locale',
  'sessions',
  'uiWorkspace',
  'connection',
  'remote',
  'settingsNavigation',
  'layout',
];

interface SessionRowLike {
  id?: string;
  retainedBy?: { mainView?: number };
}

interface SessionsStateLike {
  byId?: Record<string, SessionRowLike>;
}

interface SessionsServiceLike {
  list?: {
    getSnapshot?: () => SessionsStateLike;
    subscribe?: (listener: () => void) => () => void;
  };
  open?: (sessionId: string) => Promise<void> | void;
}

interface SidebarRightTabsLike {
  register: (definition: {
    id: string;
    kind: string;
    priority: 'extension' | 'builtin' | 'fallback';
    keepMounted?: boolean;
    title: () => string;
    guide?: readonly {
      id: string;
      order: number;
      title: () => string;
      description?: () => string;
      icon?: ComponentType<{ size?: number; className?: string }>;
    }[];
  }) => () => void;
}

interface SidebarRightControllerLike {
  openTab?: (kind: string, options?: { expand?: boolean }) => void;
  openTabIn?: (sessionId: string, kind: string, options?: { expand?: boolean }) => boolean;
}

interface WorkspaceContextMenuTarget {
  workspaceId?: string;
  path?: string;
  displayTitle?: string;
}

interface ContextMenusLike {
  register?: (contribution: {
    id: string;
    target: 'workspace';
    order: number;
    resolve: (target: WorkspaceContextMenuTarget) => readonly {
      id: string;
      label: string;
      separatorBefore?: boolean;
      run: () => void;
    }[];
  }) => () => void;
}

interface SlotsServiceLike {
  spec?: (slotName: string) => unknown;
  subscribe?: (slotName: string, listener: () => void) => () => void;
  inject: (slotName: string, factory: () => () => void) => () => void;
  register: (spec: Record<string, unknown>, component: unknown) => () => void;
}

interface LocaleServiceLike {
  register?: (ns: string, dicts: Record<string, Record<string, string>>) => () => void;
  getLocale?: () => { active?: string } | string;
  getSnapshot?: () => { active?: string };
  subscribe?: (listener: () => void) => () => void;
}

interface HarnessClientContext {
  slots: SlotsServiceLike;
  locale?: LocaleServiceLike;
  sessions?: SessionsServiceLike;
  uiWorkspace?: { openSession?: (sessionId: string) => Promise<void> | void };
  layout?: {
    selectPanel?: (panelId: string | null) => void;
    panelInfo?: {
      getSnapshot?: () => { activePanelId?: string | null };
      subscribe?: (listener: () => void) => () => void;
    };
  };
  settingsNavigation?: {
    open?: (section?: string) => Promise<void> | void;
    close?: () => void;
  };
  sidebarRight?: SidebarRightControllerLike;
  sidebarRightTabs?: SidebarRightTabsLike;
  get?: (key: string) => unknown;
  inject?: (deps: string[], callback: (scoped: HarnessClientContext) => void) => () => void;
  effect: (callback: () => (() => void) | void, label?: string) => () => void;
}

function readOptionalService<T>(ctx: HarnessClientContext, key: string): T | undefined {
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[key];
    if (direct !== undefined) {
      return direct as T;
    }
  } catch (err) {
    console.warn(`[dsh-whale] Optional service "${key}" direct lookup blocked`, err);
  }
  if (typeof ctx.get !== 'function') {
    return undefined;
  }
  try {
    return ctx.get(key) as T | undefined;
  } catch (err) {
    console.warn(`[dsh-whale] Optional service "${key}" unavailable`, err);
    return undefined;
  }
}

function readLocaleActive(locale: LocaleServiceLike | undefined): string {
  const raw = locale?.getLocale?.() ?? locale?.getSnapshot?.();
  if (typeof raw === 'string') {
    return normalizeLocale(raw);
  }
  if (raw && typeof raw === 'object' && typeof raw.active === 'string') {
    return normalizeLocale(raw.active);
  }
  return 'zh-CN';
}

function readMainSessionId(sessions: SessionsServiceLike | undefined): string | null {
  try {
    const byId = sessions?.list?.getSnapshot?.()?.byId;
    if (!byId) {
      return null;
    }
    for (const row of Object.values(byId)) {
      if ((row?.retainedBy?.mainView ?? 0) > 0 && typeof row?.id === 'string') {
        return row.id;
      }
    }
  } catch (err) {
    console.warn('[dsh-whale] Failed to inspect active mainView session', err);
  }
  return null;
}

function readActivePanelId(layout: HarnessClientContext['layout']): string | null {
  try {
    const raw = layout?.panelInfo?.getSnapshot?.()?.activePanelId;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
  } catch (err) {
    console.warn('[dsh-whale] Failed to inspect active main panel', err);
    return null;
  }
}

function registerSlotWhenDeclared(
  ctx: HarnessClientContext,
  slotName: string,
  register: () => () => void,
  label: string,
): void {
  ctx.effect(() => {
    let installed = false;
    let disposeSlot: (() => void) | null = null;

    const tryInstall = () => {
      if (installed) {
        return;
      }
      let declared = false;
      try {
        declared = Boolean(ctx.slots?.spec?.(slotName));
      } catch (err) {
        console.warn(`[dsh-whale] Failed to check slot spec "${slotName}"`, err);
      }
      if (!declared) {
        return;
      }
      installed = true;
      disposeSlot = ctx.slots.inject(slotName, register);
    };

    const unsub = ctx.slots.subscribe?.(slotName, tryInstall);
    tryInstall();

    return () => {
      unsub?.();
      disposeSlot?.();
    };
  }, label);
}

function BotConversationFrameSeat(props: {
  children?: ReactNode;
  useSessions?: <T>(selector: (state: SessionsStateLike) => T) => T;
}) {
  return (
    <BotConversationFrame
      useSessions={props.useSessions}
      renderFirstScreen={(bot, onDismiss) => (
        <div style={{ width: '100%', maxWidth: 460 }}>
          <BotFirstScreen bot={bot} onDismiss={onDismiss} />
        </div>
      )}
    >
      {props.children}
    </BotConversationFrame>
  );
}

function BotSettingsPageSeat({ closePanel }: { closePanel: () => void }) {
  return <BotSettingsView host="page" onClosePage={closePanel} />;
}

function LegacyWhaleRedirect({ openDefaultBot }: { openDefaultBot: () => Promise<string | null> }) {
  useEffect(() => {
    void openDefaultBot();
  }, [openDefaultBot]);
  return null;
}

function openSessionViaHost(
  ctx: HarnessClientContext,
  sessions: SessionsServiceLike | undefined,
  sessionId: string,
): void {
  const id = String(sessionId ?? '').trim();
  if (!id) {
    return;
  }
  const uiWorkspace = readOptionalService<{ openSession?: (sid: string) => Promise<void> | void }>(ctx, 'uiWorkspace');
  const tryOpen = () => Promise.resolve().then(() => {
    if (typeof uiWorkspace?.openSession === 'function') {
      return uiWorkspace.openSession(id);
    }
    if (typeof sessions?.open === 'function') {
      return sessions.open(id);
    }
    return undefined;
  });
  const clearPanel = () => {
    try {
      ctx.layout?.selectPanel?.(null);
    } catch (err) {
      console.warn('[dsh-whale] Failed to clear active panel after opening session', err);
    }
  };
  void tryOpen()
    .then(clearPanel)
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown session/i.test(msg) && typeof sessions?.list?.subscribe === 'function') {
        void new Promise<void>((resolve) => {
          const timer = setTimeout(() => { unsub?.(); resolve(); }, 1500);
          const unsub = sessions.list?.subscribe?.(() => {
            if (sessions.list?.getSnapshot?.()?.byId?.[id]) {
              clearTimeout(timer);
              unsub?.();
              resolve();
            }
          });
        })
          .then(() => tryOpen())
          .then(clearPanel)
          .catch((retryErr) => {
            console.warn('[dsh-whale] Failed to open session', id, retryErr);
          });
        return;
      }
      console.warn('[dsh-whale] Failed to open session', id, err);
    });
}

function openNativeRightPanel(
  ctx: HarnessClientContext,
  sessions: SessionsServiceLike | undefined,
  capturedRightbar: SidebarRightControllerLike | null,
  botId: string,
  _tab?: BotRightPanelTab,
): void {
  const rightbar = capturedRightbar ?? readOptionalService<SidebarRightControllerLike>(ctx, 'sidebarRight');
  if (!rightbar) {
    return;
  }
  const state = botsStore.getState();
  const targetBot = state.bots.find((entry) => entry.id === botId);
  const candidateSessionId = state.activeSessionId
    ?? targetBot?.chatSessionId
    ?? targetBot?.homeSessionId
    ?? readMainSessionId(sessions);
  try {
    if (candidateSessionId && typeof rightbar.openTabIn === 'function') {
      const opened = rightbar.openTabIn(candidateSessionId, BOTS_RIGHT_TAB_KIND, { expand: true });
      if (opened) {
        return;
      }
    }
    rightbar.openTab?.(BOTS_RIGHT_TAB_KIND, { expand: true });
  } catch (err) {
    console.warn('[dsh-whale] Failed to open native right sidebar tab', err);
  }
}

function registerWorkspaceHandToBotMenu(ctx: HarnessClientContext): void {
  const attach = (scoped: HarnessClientContext) => {
    const contextMenus = readOptionalService<ContextMenusLike>(scoped, 'contextMenus');
    if (typeof contextMenus?.register !== 'function') {
      return;
    }
    scoped.effect(
      () => contextMenus.register?.({
        id: 'dsh-whale.workspace.hand-to-bot',
        target: 'workspace',
        order: 150,
        resolve: (target) => {
          const cwd = String(target?.path ?? '').trim();
          if (!cwd) {
            return [];
          }
          const label = readLocaleActive(ctx.locale) === 'zh-CN'
            ? '移交给大肥鱼队友…'
            : 'Hand to teammate…';
          return [{
            id: 'dsh-whale:hand-to-bot',
            label,
            separatorBefore: true,
            run: () => {
              botsStore.openHandToBot({
                cwd,
                workspaceId: target?.workspaceId,
                name: target?.displayTitle,
              });
            },
          }];
        },
      }),
      'dsh-whale: workspace hand-to-bot context menu',
    );
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['contextMenus'], attach);
  } else {
    attach(ctx);
  }
}

function escapeAttrSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function findMainChatComposer(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return null;
  }
  const selectors = [
    '[data-dsh-composer] [data-lexical-editor="true"]',
    '[data-dsh-composer] textarea',
    '[data-dsh-composer] [contenteditable="true"]',
    'main [data-lexical-editor="true"]',
    'main textarea',
    'main [contenteditable="true"]',
  ];
  for (const selector of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(selector);
    for (const el of nodes) {
      if (el.closest?.('.dsh-bots-modal, .dsh-bots-sidebar, .dsh-bots-panel, .dsh-bots-popover')) {
        continue;
      }
      if ((el as HTMLTextAreaElement).disabled) {
        continue;
      }
      return el;
    }
  }
  return null;
}

function readComposerText(el: HTMLElement): string {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    return String((el as HTMLTextAreaElement).value ?? '');
  }
  return String(el.textContent ?? '');
}

function applyComposerDraft(el: HTMLElement, text: string): boolean {
  if (readComposerText(el).trim().length > 0) {
    return false;
  }
  try {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const input = el as HTMLTextAreaElement;
      const proto = el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(input, text);
      } else {
        input.value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus?.();
      return true;
    }
    el.focus?.();
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      const inserted = document.execCommand('insertText', false, text);
      if (inserted) {
        return true;
      }
    }
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  } catch (err) {
    console.warn('[dsh-whale] Failed to apply prefill draft to composer', err);
    return false;
  }
}

function resolveChatPaneTarget(sessionId?: string | null): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return null;
  }
  const selectors: string[] = [];
  if (sessionId) {
    selectors.push(`[data-session-id="${escapeAttrSelector(sessionId)}"]`);
  }
  selectors.push('.dsh-bots-conv-frame', '[data-dsh-chat-pane]', 'main');
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      return el;
    }
  }
  return null;
}

function registerNativeRightSidebarTab(
  ctx: HarnessClientContext,
  onRightbarChange: (controller: SidebarRightControllerLike | null) => void,
): void {
  const attach = (scoped: HarnessClientContext) => {
    const rightbar = readOptionalService<SidebarRightControllerLike>(scoped, 'sidebarRight');
    if (rightbar) {
      onRightbarChange(rightbar);
      scoped.effect(() => () => {
        onRightbarChange(null);
      }, 'dsh-whale: sidebarRight controller ref');
    }
    const tabs = readOptionalService<SidebarRightTabsLike>(scoped, 'sidebarRightTabs');
    if (!tabs) {
      return;
    }
    const labelOf = (zh: string, en: string) => (readLocaleActive(ctx.locale) === 'zh-CN' ? zh : en);

    scoped.effect(
      () => tabs.register({
        id: BOTS_RIGHT_TAB_ID,
        kind: BOTS_RIGHT_TAB_KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => labelOf('大肥鱼', 'Whale Bot'),
        guide: [{
          id: 'dsh-bots',
          order: 15,
          title: () => labelOf('大肥鱼工作台', 'Whale Bot panel'),
          description: () => labelOf('概览、待处理、连接器、聊天与文件', 'Overview, connectors, chats and files'),
          icon: IconBot,
        }],
      }),
      'dsh-whale: sidebarRight tab type',
    );

    registerSlotWhenDeclared(
      scoped,
      'sidebar.right.pane.tab',
      () => scoped.slots.register(
        { name: 'sidebar.right.pane.tab', key: BOTS_RIGHT_TAB_ID, locale: NS },
        (props: BotRightPanelProps) => <BotRightPanel sessionId={props.sessionId} botId={props.botId} />,
      ),
      'dsh-whale: sidebarRight tab body',
    );
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['sidebarRight', 'sidebarRightTabs'], attach);
  } else {
    attach(ctx);
  }
}

export function apply(ctx: HarnessClientContext): void {
  const sessions = readOptionalService<SessionsServiceLike>(ctx, 'sessions');
  let capturedRightbar: SidebarRightControllerLike | null = null;

  ctx.effect(() => ctx.locale?.register?.(NS, {
    zh: LOCALES['zh-CN'],
    en: LOCALES['en-US'],
  }), 'dsh-whale: locale dictionaries');

  ctx.effect(mountWhaleStyles, 'dsh-whale: styles');

  const openDefaultBot = async (): Promise<string | null> => {
    if (!botsStore.getState().loaded) {
      await botsStore.refresh();
    }
    const state = botsStore.getState();
    const target = (state.petBotId ? state.bots.find((b) => b.id === state.petBotId) : null)
      ?? state.bots[0]
      ?? null;
    if (target) {
      await botsStore.openBotHome(target.id);
      return botsStore.getState().activeSessionId ?? target.chatSessionId ?? target.homeSessionId ?? null;
    }
    try {
      ctx.layout?.selectPanel?.(null);
    } catch (err) {
      console.warn('[dsh-whale] Failed to clear panel before opening new-bot modal', err);
    }
    botsStore.openModal({ kind: 'new-bot' });
    return null;
  };

  botsStore.bindHost({
    openSession: (sessionId) => openSessionViaHost(ctx, sessions, sessionId),
    selectPanel: (panelId) => {
      try {
        ctx.layout?.selectPanel?.(panelId || null);
      } catch (err) {
        console.warn(`[dsh-whale] Failed to select panel "${panelId}"`, err);
      }
    },
    openRightPanel: (botId, tab) => openNativeRightPanel(ctx, sessions, capturedRightbar, botId, tab),
    openGlobalSettings: () => {
      void Promise.resolve(ctx.settingsNavigation?.open?.('pet')).catch((err) => {
        console.warn('[dsh-whale] Failed to open pet/bots settings', err);
      });
    },
    getLocale: () => readLocaleActive(ctx.locale),
    subscribeLocale: (listener) => {
      if (typeof ctx.locale?.subscribe !== 'function') {
        return () => {};
      }
      let last = readLocaleActive(ctx.locale);
      return ctx.locale.subscribe(() => {
        const next = readLocaleActive(ctx.locale);
        if (next !== last) {
          last = next;
          listener(next);
        }
      });
    },
  });

  ctx.effect(() => {
    botsStore.start();
    const syncWorkspaceAttr = () => {
      if (typeof document === 'undefined') {
        return;
      }
      if (botsStore.getState().hideBotCreatedWorkspaces) {
        document.documentElement.dataset.dshHideBotWorkspaces = 'true';
      } else {
        delete document.documentElement.dataset.dshHideBotWorkspaces;
      }
    };
    syncWorkspaceAttr();
    const unsubStore = botsStore.subscribe(syncWorkspaceAttr);
    return () => {
      unsubStore();
      botsStore.stop();
      if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.dshHideBotWorkspaces;
      }
    };
  }, 'dsh-whale: botsStore lifecycle');

  ctx.effect(() => {
    let prevState = botsStore.getState();
    let lastMainSessionId: string | null | undefined;
    let lastPanelId: string | null | undefined;

    const syncMainSelection = (force = false) => {
      const currentState = botsStore.getState();
      const sid = readMainSessionId(sessions);
      const panelId = readActivePanelId(ctx.layout);
      const dataChanged =
        currentState.loaded !== prevState.loaded
        || currentState.bots !== prevState.bots
        || currentState.chatsByBot !== prevState.chatsByBot;
      prevState = currentState;

      if (!force && sid === lastMainSessionId && panelId === lastPanelId && !dataChanged) {
        return;
      }
      lastMainSessionId = sid;
      lastPanelId = panelId;

      // Avoid overwriting optimistic selection before a mock/unhydrated host publishes a mainView session.
      if (!force && dataChanged && sid === null && panelId === null) {
        return;
      }

      const next = resolveActiveBotSelection({
        activePanelId: panelId,
        mainSessionId: sid,
        bots: currentState.bots,
        chatsByBot: currentState.chatsByBot,
        prevActiveGroupId: currentState.activeGroupId,
        prevActiveBotId: currentState.activeBotId,
        settingsRouteBotId: currentState.settingsRoute?.host === 'page' ? currentState.settingsRoute.botId : null,
      }) as {
        botId: string | null;
        groupId: string | null;
        sessionId: string | null;
        closePageSettings: boolean;
      };

      if (next.closePageSettings && currentState.settingsRoute?.host === 'page') {
        botsStore.closeBotSettings();
      }
      botsStore.setActiveSelection({
        botId: next.botId,
        groupId: next.groupId,
        sessionId: next.sessionId,
      });
    };

    syncMainSelection(true);
    const unsubSessions = sessions?.list?.subscribe?.(() => syncMainSelection(true));
    const unsubPanel = ctx.layout?.panelInfo?.subscribe?.(() => syncMainSelection(true));
    const unsubStore = botsStore.subscribe(() => syncMainSelection(false));
    return () => {
      unsubSessions?.();
      unsubPanel?.();
      unsubStore();
    };
  }, 'dsh-whale: active session sync');

  // Sidebar Bots section above Workspaces; `html[data-sidebar-projects-first="true"]`
  // swaps order with Workspaces via CSS without unmounting either subtree.
  registerSlotWhenDeclared(
    ctx,
    'sidebar.sections.before',
    () => ctx.slots.register(
      { name: 'sidebar.sections.before', id: 'dsh-bots', order: 10, locale: NS },
      SidebarBotsSection,
    ),
    'dsh-whale: sidebar bots section',
  );

  registerSlotWhenDeclared(
    ctx,
    'conversation.session.header.leading',
    () => ctx.slots.register(
      { name: 'conversation.session.header.leading', locale: NS },
      (props: BotHeaderSlotProps) => <BotConversationLeading sessionId={props.sessionId} />,
    ),
    'dsh-whale: conversation header leading',
  );

  registerSlotWhenDeclared(
    ctx,
    'conversation.session.header.actions',
    () => ctx.slots.register(
      { name: 'conversation.session.header.actions', id: 'dsh-bots-actions', order: 30, locale: NS },
      (props: BotHeaderSlotProps) => <BotConversationActions sessionId={props.sessionId} />,
    ),
    'dsh-whale: conversation header actions',
  );

  registerSlotWhenDeclared(
    ctx,
    'conversation.hero.frame',
    () => ctx.slots.register(
      { name: 'conversation.hero.frame', id: 'dsh-bots-frame', order: 20, locale: NS },
      BotConversationFrameSeat,
    ),
    'dsh-whale: conversation frame wrapper',
  );

  registerSlotWhenDeclared(
    ctx,
    'main',
    () => ctx.slots.register(
      { name: 'main', key: GROUP_PANEL_ID, locale: NS },
      BotGroupRoomView,
    ),
    'dsh-whale: main group room panel',
  );

  registerSlotWhenDeclared(
    ctx,
    'main',
    () => ctx.slots.register(
      { name: 'main', key: SETTINGS_PANEL_ID, locale: NS },
      () => (
        <BotSettingsPageSeat
          closePanel={() => {
            botsStore.closeBotSettings();
            try {
              ctx.layout?.selectPanel?.(null);
            } catch (err) {
              console.warn('[dsh-whale] Failed to close settings panel', err);
            }
          }}
        />
      ),
    ),
    'dsh-whale: main bot settings panel',
  );

  registerSlotWhenDeclared(
    ctx,
    'main',
    () => ctx.slots.register(
      { name: 'main', key: LEGACY_WHALE_PANEL_ID, locale: NS },
      () => <LegacyWhaleRedirect openDefaultBot={openDefaultBot} />,
    ),
    'dsh-whale: legacy whale redirect panel',
  );

  registerNativeRightSidebarTab(ctx, (controller) => {
    capturedRightbar = controller;
  });

  registerWorkspaceHandToBotMenu(ctx);

  registerSlotWhenDeclared(
    ctx,
    'settings.pet.item',
    () => ctx.slots.register(
      { name: 'settings.pet.item', id: 'whale', order: 0, locale: NS },
      () => (
        <GlobalBotsSettings
          closeSettings={() => {
            try {
              ctx.settingsNavigation?.close?.();
            } catch (err) {
              console.warn('[dsh-whale] Failed to close settings overlay', err);
            }
          }}
        />
      ),
    ),
    'dsh-whale: global bots settings',
  );

  // Global modals and toasts only (never a fullscreen takeover or second right sidebar).
  registerSlotWhenDeclared(
    ctx,
    'shell.overlay',
    () => ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-bots.modals', order: 60, locale: NS },
      BotsModalHost,
    ),
    'dsh-whale: modals and toasts overlay',
  );

  ctx.effect(() => {
    const win = typeof window !== 'undefined'
      ? (window as Window & {
        __dshWhaleOpen?: () => Promise<string | null>;
        __dshWhaleHandToBot?: (
          workspace: HandToBotWorkspace,
          options?: { initialBotId?: string | null; initialPrompt?: string },
        ) => void;
        __DSH_BOTS_HAS_UNSAVED_DRAFT__?: (botId: string, homeSessionId?: string | null) => boolean;
      })
      : null;
    if (!win) {
      return undefined;
    }

    const activeTimers = new Set<number>();
    const pendingDrafts = new Map<string, string>();
    const trackTimer = (id: number) => {
      activeTimers.add(id);
      return id;
    };
    const clearTrackedTimer = (id: number) => {
      activeTimers.delete(id);
      win.clearTimeout?.(id);
    };

    const handlePrefillDraft = (event: Event) => {
      const detail = (event as CustomEvent<{
        botId?: string;
        sessionId?: string | null;
        text?: string;
      }>)?.detail;
      const text = typeof detail?.text === 'string' ? detail.text : '';
      const botId = typeof detail?.botId === 'string' ? detail.botId.trim() : '';
      if (!text.trim()) {
        return;
      }
      if (botId) {
        pendingDrafts.set(botId, text);
        try {
          win.sessionStorage?.setItem(`dsh-bots.prefillDraft:${botId}`, text);
        } catch {
          // Ignore sessionStorage errors in restricted environments.
        }
      }
      let attempts = 0;
      const tryInject = () => {
        attempts += 1;
        const composer = findMainChatComposer();
        if (composer && applyComposerDraft(composer, text)) {
          if (botId) {
            pendingDrafts.delete(botId);
          }
          return;
        }
        if (attempts < 5 && typeof win.setTimeout === 'function') {
          const tid = trackTimer(win.setTimeout(() => {
            activeTimers.delete(tid);
            tryInject();
          }, 120));
        }
      };
      if (typeof win.setTimeout === 'function') {
        const tid = trackTimer(win.setTimeout(() => {
          activeTimers.delete(tid);
          tryInject();
        }, 0));
      } else {
        tryInject();
      }
    };

    const handleFlashChatPane = (event: Event) => {
      const detail = (event as CustomEvent<{ botId?: string; sessionId?: string | null }>)?.detail;
      const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : null;
      const applyFallbackFlash = () => {
        const target = resolveChatPaneTarget(sessionId);
        if (!target || target.classList?.contains('dsh-bots-pane-rim-flash')) {
          return;
        }
        target.classList?.add('dsh-bots-pane-rim-flash');
        if (typeof win.setTimeout === 'function') {
          const tid = trackTimer(win.setTimeout(() => {
            activeTimers.delete(tid);
            target.classList?.remove('dsh-bots-pane-rim-flash');
          }, 720));
        }
      };
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(applyFallbackFlash);
      } else {
        applyFallbackFlash();
      }
    };

    const handleHandToBot = (event: Event) => {
      const detail = (event as CustomEvent<{
        cwd?: string;
        path?: string;
        workspaceId?: string;
        name?: string;
        displayTitle?: string;
        branch?: string;
        initialBotId?: string | null;
        initialPrompt?: string;
      }>)?.detail;
      const cwd = String(detail?.cwd ?? detail?.path ?? '').trim();
      if (!cwd) {
        return;
      }
      botsStore.openHandToBot(
        {
          cwd,
          workspaceId: detail?.workspaceId,
          name: detail?.name ?? detail?.displayTitle,
          branch: detail?.branch,
        },
        {
          initialBotId: detail?.initialBotId ?? null,
          initialPrompt: detail?.initialPrompt ?? '',
        },
      );
    };

    const handToBotBridge = (
      workspace: HandToBotWorkspace,
      options?: { initialBotId?: string | null; initialPrompt?: string },
    ) => {
      botsStore.openHandToBot(workspace, options);
    };

    const defaultUnsavedDraftCheck = (botId: string, homeSessionId?: string | null): boolean => {
      if (pendingDrafts.has(botId)) {
        return true;
      }
      const state = botsStore.getState();
      const activeIsHome = Boolean(homeSessionId) && state.activeSessionId === homeSessionId;
      if (activeIsHome) {
        const composer = findMainChatComposer();
        if (composer && readComposerText(composer).trim().length > 0) {
          return true;
        }
      }
      return false;
    };

    const previousOpen = win.__dshWhaleOpen;
    const previousHandToBot = win.__dshWhaleHandToBot;
    const previousDraftHook = win.__DSH_BOTS_HAS_UNSAVED_DRAFT__;

    win.__dshWhaleOpen = openDefaultBot;
    win.__dshWhaleHandToBot = handToBotBridge;
    if (typeof previousDraftHook !== 'function') {
      win.__DSH_BOTS_HAS_UNSAVED_DRAFT__ = defaultUnsavedDraftCheck;
    }

    win.addEventListener?.(PREFILL_CHAT_DRAFT_EVENT, handlePrefillDraft);
    win.addEventListener?.(FLASH_CHAT_PANE_EVENT, handleFlashChatPane);
    win.addEventListener?.(HAND_TO_BOT_EVENT, handleHandToBot);

    return () => {
      for (const tid of [...activeTimers]) {
        clearTrackedTimer(tid);
      }
      pendingDrafts.clear();
      win.removeEventListener?.(PREFILL_CHAT_DRAFT_EVENT, handlePrefillDraft);
      win.removeEventListener?.(FLASH_CHAT_PANE_EVENT, handleFlashChatPane);
      win.removeEventListener?.(HAND_TO_BOT_EVENT, handleHandToBot);

      if (win.__dshWhaleOpen === openDefaultBot) {
        if (previousOpen !== undefined) {
          win.__dshWhaleOpen = previousOpen;
        } else {
          delete win.__dshWhaleOpen;
        }
      }
      if (win.__dshWhaleHandToBot === handToBotBridge) {
        if (previousHandToBot !== undefined) {
          win.__dshWhaleHandToBot = previousHandToBot;
        } else {
          delete win.__dshWhaleHandToBot;
        }
      }
      if (win.__DSH_BOTS_HAS_UNSAVED_DRAFT__ === defaultUnsavedDraftCheck) {
        if (previousDraftHook !== undefined) {
          win.__DSH_BOTS_HAS_UNSAVED_DRAFT__ = previousDraftHook;
        } else {
          delete win.__DSH_BOTS_HAS_UNSAVED_DRAFT__;
        }
      }
    };
  }, 'dsh-whale: desktop pet jump & client event bridges');
}
