// Central reactive store for WhaleIsle Bots UI (built on React useSyncExternalStore).

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_BOT_SIDEBAR_VIEW,
  normalizeBotChatFolds,
  normalizeBotSidebarView,
  normalizeSidebarBotsHeight,
  sortBotsBySidebarOrder,
  withBotChatFold,
} from '../../shared/bot-sidebar-logic.js';
import { createTranslator, normalizeLocale } from '../../shared/locales.js';
import {
  RPC_METHODS,
  callBotRpc,
  subscribeBotEvents,
  type BotChangeScope,
  type BotChatRow,
  type BotChatTree,
  type BotGlobalSettings,
  type BotGroupRecord,
  type BotGroupReplyMode,
  type BotListPayload,
  type BotModelOption,
  type BotRecord,
  type BotSidebarView,
} from './rpc';

export type BotRightPanelTab = 'home' | 'connectors' | 'chats' | 'files';

export interface BotSettingsRoute {
  host: 'panel' | 'page';
  botId: string;
  page: string | null;
  memoryTab?: 'facts' | 'history';
}

export interface NewBotModalDraft {
  templateId?: string;
  takeOverWorkspace?: { workspaceId?: string; name?: string; watches?: string; does?: string; reports?: string };
  initialName?: string;
  initialPurpose?: string;
  initialAvatar?: string;
  initialAvatarColor?: string;
}

export type BotsModalState =
  | { kind: 'new-bot'; draft?: NewBotModalDraft }
  | { kind: 'templates' }
  | { kind: 'group'; groupId?: string }
  | { kind: 'import'; initialTab?: 'apps' | 'package' }
  | { kind: 'share'; mode: 'export'; botId: string }
  | { kind: 'share'; mode: 'import'; initialJson?: string }
  | { kind: 'confirm-delete-bot'; botId: string }
  | { kind: 'confirm-new-home'; botId: string }
  | { kind: 'confirm-delete-group'; groupId: string };

export interface BotToast {
  id: string;
  message: string;
  tone?: 'info' | 'success' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

export interface BotsHostBridge {
  openSession?: (sessionId: string, options?: { botId?: string }) => void;
  selectPanel?: (panelId: string, params?: Record<string, unknown>) => void;
  openRightPanel?: (botId: string, tab?: BotRightPanelTab) => void;
  openGlobalSettings?: () => void;
  getLocale?: () => string;
  subscribeLocale?: (listener: (locale: string) => void) => () => void;
  copyText?: (text: string) => Promise<void> | void;
}

export interface BotsState extends BotGlobalSettings {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  bots: BotRecord[];
  groups: BotGroupRecord[];
  chatsByBot: Record<string, BotChatTree>;
  models: BotModelOption[];
  needsYou: Record<string, number>;
  needsYouAt: number;
  needsYouStaleInMs: number | null;
  sectionCollapsed: boolean;
  collapsedBotIds: string[];
  chatFolds: Record<string, 'open' | 'folded'>;
  activeBotId: string | null;
  activeGroupId: string | null;
  activeSessionId: string | null;
  rightPanelTab: BotRightPanelTab;
  rightPanelItemId: string | null;
  settingsRoute: BotSettingsRoute | null;
  modal: BotsModalState | null;
  toasts: BotToast[];
  startingSessionIds: string[];
  changeSeq: number;
  lastChangeScope: BotChangeScope | null;
}

const STORAGE_KEYS = {
  sectionCollapsed: 'dsh-bots.sectionCollapsed',
  collapsedBots: 'dsh-bots.collapsedBots',
  chatFolds: 'dsh-bots.chatFolds',
} as const;

function readStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    console.warn(`[dsh-bots] Failed to read localStorage key ${key}`, err);
    return fallback;
  }
}

function writeStorageJson(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[dsh-bots] Failed to write localStorage key ${key}`, err);
  }
}

function syncProjectsFirstAttribute(projectsFirst: boolean): void {
  if (typeof document === 'undefined') return;
  if (projectsFirst) document.documentElement.dataset.sidebarProjectsFirst = 'true';
  else delete document.documentElement.dataset.sidebarProjectsFirst;
}

function normalizeChatsMap(raw: Record<string, BotChatTree | BotChatRow[]> | undefined): Record<string, BotChatTree> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, BotChatTree> = {};
  for (const [botId, entry] of Object.entries(raw)) {
    if (Array.isArray(entry)) out[botId] = { botId, chats: entry };
    else if (entry && Array.isArray(entry.chats)) out[botId] = { botId, chats: entry.chats, workspaceChats: entry.workspaceChats };
  }
  return out;
}

function extractNeedsYou(payload: BotListPayload) {
  const raw = payload.needsYou;
  if (raw && typeof raw === 'object' && 'counts' in raw && typeof raw.counts === 'object') {
    const nested = raw as { counts: Record<string, number>; at?: number; staleInMs?: number | null };
    return {
      counts: nested.counts ?? {},
      at: typeof nested.at === 'number' ? nested.at : Date.now(),
      staleInMs: typeof nested.staleInMs === 'number' ? nested.staleInMs : null,
    };
  }
  return {
    counts: (raw as Record<string, number>) ?? {},
    at: typeof payload.needsYouAt === 'number' ? payload.needsYouAt : Date.now(),
    staleInMs: typeof payload.needsYouStaleInMs === 'number' ? payload.needsYouStaleInMs : null,
  };
}

function buildInitialState(): BotsState {
  const savedCollapsed = readStorageJson<boolean>(STORAGE_KEYS.sectionCollapsed, false);
  const savedBotCollapsed = readStorageJson<string[]>(STORAGE_KEYS.collapsedBots, []);
  const savedFolds = normalizeBotChatFolds(readStorageJson<Record<string, string>>(STORAGE_KEYS.chatFolds, {}));
  return {
    loaded: false, loading: false, error: null,
    bots: [], groups: [], chatsByBot: {}, models: [],
    needsYou: {}, needsYouAt: 0, needsYouStaleInMs: null,
    botsEnabled: true, skipNewHomeChatConfirm: false, hideBotCreatedWorkspaces: true,
    botSidebarView: { ...DEFAULT_BOT_SIDEBAR_VIEW } as BotSidebarView,
    sidebarBotsHeight: null, sidebarProjectsFirst: false, petBotId: null,
    sectionCollapsed: Boolean(savedCollapsed),
    collapsedBotIds: Array.isArray(savedBotCollapsed) ? savedBotCollapsed : [],
    chatFolds: savedFolds as Record<string, 'open' | 'folded'>,
    activeBotId: null, activeGroupId: null, activeSessionId: null,
    rightPanelTab: 'home', rightPanelItemId: null, settingsRoute: null,
    modal: null, toasts: [], startingSessionIds: [], changeSeq: 0, lastChangeScope: null,
  };
}

class BotsStore {
  private state: BotsState = buildInitialState();
  private listeners = new Set<() => void>();
  private changeListeners = new Set<(scope: BotChangeScope) => void>();
  private host: BotsHostBridge = {};
  private unsubSse: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private started = false;
  private editVersion = 0;
  private toastSeq = 0;

  getState = (): BotsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  subscribeChanges = (listener: (scope: BotChangeScope) => void): (() => void) => {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  };

  bindHost(bridge: BotsHostBridge): void { this.host = { ...this.host, ...bridge }; }
  getHost(): BotsHostBridge { return this.host; }

  private setState(updater: Partial<BotsState> | ((prev: BotsState) => BotsState)): void {
    const next = typeof updater === 'function' ? updater(this.state) : { ...this.state, ...updater };
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    this.unsubSse = subscribeBotEvents({
      onChanged: (scope) => this.handleSseChange(scope),
      onReconnect: () => { void this.refresh(); },
      onError: (err) => { console.warn('[dsh-bots] SSE connection error; will retry', err); },
    });
  }

  stop(): void {
    this.started = false;
    this.unsubSse?.();
    this.unsubSse = null;
    if (this.refreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private handleSseChange(scope: BotChangeScope): void {
    const kinds = scope.kinds ?? [];
    const itemsOnly = kinds.length === 1 && kinds[0] === 'items' && Boolean(scope.needsYou);
    this.setState((prev) => ({
      ...prev,
      changeSeq: prev.changeSeq + 1,
      lastChangeScope: scope,
      ...(scope.needsYou
        ? { needsYou: scope.needsYou.counts, needsYouAt: scope.needsYou.at, needsYouStaleInMs: scope.needsYou.staleInMs ?? prev.needsYouStaleInMs }
        : {}),
    }));
    for (const listener of [...this.changeListeners]) {
      try { listener(scope); } catch (err) { console.warn('[dsh-bots] Change listener failed', err); }
    }
    if (!itemsOnly) this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (typeof window === 'undefined') { void this.refresh(); return; }
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = null; void this.refresh(); }, 45);
  }

  async refresh(): Promise<void> {
    const startVersion = this.editVersion;
    this.setState({ loading: true, error: null });
    try {
      const payload = await callBotRpc<BotListPayload>(RPC_METHODS.LIST);
      if (startVersion !== this.editVersion) { this.scheduleRefresh(); return; }
      this.applyListPayload(payload);
    } catch (err) {
      this.setState({ loading: false, loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private applyListPayload(payload: BotListPayload): void {
    const sortedBots = sortBotsBySidebarOrder(payload.bots ?? []) as BotRecord[];
    const needs = extractNeedsYou(payload);
    const sidebarProjectsFirst = payload.sidebarProjectsFirst ?? this.state.sidebarProjectsFirst;
    syncProjectsFirstAttribute(sidebarProjectsFirst);
    const chatsMap = payload.chatsByBot ? normalizeChatsMap(payload.chatsByBot) : this.state.chatsByBot;
    this.setState((prev) => ({
      ...prev,
      loaded: true, loading: false, error: null,
      bots: sortedBots,
      groups: Array.isArray(payload.groups) ? payload.groups : prev.groups,
      chatsByBot: chatsMap,
      models: Array.isArray(payload.models) ? payload.models : prev.models,
      needsYou: needs.counts, needsYouAt: needs.at, needsYouStaleInMs: needs.staleInMs,
      botsEnabled: payload.botsEnabled ?? prev.botsEnabled,
      skipNewHomeChatConfirm: payload.skipNewHomeChatConfirm ?? prev.skipNewHomeChatConfirm,
      hideBotCreatedWorkspaces: payload.hideBotCreatedWorkspaces ?? prev.hideBotCreatedWorkspaces,
      botSidebarView: payload.botSidebarView ? (normalizeBotSidebarView(payload.botSidebarView) as BotSidebarView) : prev.botSidebarView,
      sidebarBotsHeight: payload.sidebarBotsHeight !== undefined ? normalizeSidebarBotsHeight(payload.sidebarBotsHeight) : prev.sidebarBotsHeight,
      sidebarProjectsFirst,
      petBotId: payload.petBotId !== undefined ? payload.petBotId : prev.petBotId,
    }));
  }

  async refreshModels(): Promise<BotModelOption[]> {
    try {
      const res = await callBotRpc<{ models?: BotModelOption[] } | BotModelOption[]>(RPC_METHODS.AGENT_CHOICES);
      const list = Array.isArray(res) ? res : (res?.models ?? []);
      if (list.length > 0) this.setState({ models: list });
      return list;
    } catch (err) {
      console.warn('[dsh-bots] Failed to load model choices', err);
      return this.state.models;
    }
  }

  async refreshBotChatTree(botId: string): Promise<BotChatTree | null> {
    try {
      const tree = await callBotRpc<BotChatTree>(RPC_METHODS.CHAT_TREE, { botId });
      if (tree && Array.isArray(tree.chats)) {
        this.setState((prev) => ({ ...prev, chatsByBot: { ...prev.chatsByBot, [botId]: { ...tree, botId } } }));
        return tree;
      }
      return null;
    } catch (err) {
      console.warn(`[dsh-bots] Failed to load chatTree for ${botId}`, err);
      return null;
    }
  }

  async updateBot(botId: string, patch: Partial<BotRecord>): Promise<BotRecord | null> {
    const prevBots = this.state.bots;
    this.editVersion += 1;
    this.setState({ bots: prevBots.map((bot) => (bot.id === botId ? { ...bot, ...patch } : bot)) });
    try {
      const res = await callBotRpc<{ bot?: BotRecord } | BotRecord>(RPC_METHODS.UPDATE, { botId, ...patch });
      const updated = (res && 'bot' in res && res.bot ? res.bot : res) as BotRecord | undefined;
      if (updated?.id) {
        this.setState((prev) => ({ ...prev, bots: prev.bots.map((b) => (b.id === botId ? { ...b, ...updated } : b)) }));
        return updated;
      }
      return null;
    } catch (err) {
      this.setState({ bots: prevBots });
      this.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      return null;
    }
  }

  async reorderBots(orderedIds: string[]): Promise<void> {
    const prevBots = this.state.bots;
    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
    this.editVersion += 1;
    this.setState({
      bots: sortBotsBySidebarOrder(prevBots.map((b) => (orderMap.has(b.id) ? { ...b, sidebarOrder: orderMap.get(b.id) } : b))) as BotRecord[],
    });
    try {
      await Promise.all(orderedIds.map((botId, sidebarOrder) => callBotRpc(RPC_METHODS.UPDATE, { botId, sidebarOrder })));
    } catch (err) {
      this.setState({ bots: prevBots });
      this.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  }

  async createBot(params: Record<string, unknown>): Promise<BotRecord> {
    this.editVersion += 1;
    const res = await callBotRpc<{ bot?: BotRecord; sessionId?: string } | BotRecord>(RPC_METHODS.CREATE, params);
    const bot = (res && 'bot' in res && res.bot ? res.bot : res) as BotRecord;
    const sessionId = (res && 'sessionId' in res && typeof res.sessionId === 'string'
      ? res.sessionId : bot.chatSessionId ?? bot.homeSessionId) ?? null;
    this.setSectionCollapsed(false);
    this.setState((prev) => ({
      ...prev,
      bots: sortBotsBySidebarOrder([bot, ...prev.bots.filter((i) => i.id !== bot.id)]) as BotRecord[],
      activeBotId: bot.id, activeGroupId: null, activeSessionId: sessionId,
    }));
    if (sessionId) this.host.openSession?.(sessionId, { botId: bot.id });
    void this.refresh();
    return bot;
  }

  async deleteBot(botId: string): Promise<{ deleted: boolean; folderPath?: string }> {
    const prevBots = this.state.bots;
    this.editVersion += 1;
    this.setState((prev) => ({
      ...prev,
      bots: prev.bots.filter((bot) => bot.id !== botId),
      activeBotId: prev.activeBotId === botId ? null : prev.activeBotId,
    }));
    try {
      const result = await callBotRpc<{ deleted?: boolean; folderPath?: string }>(RPC_METHODS.DELETE, { botId });
      return { deleted: result?.deleted !== false, folderPath: result?.folderPath };
    } catch (err) {
      this.setState({ bots: prevBots });
      throw err;
    }
  }

  async updateGlobalSettings(patch: Partial<BotGlobalSettings>): Promise<void> {
    const prevSnapshot: BotGlobalSettings = {
      botsEnabled: this.state.botsEnabled,
      skipNewHomeChatConfirm: this.state.skipNewHomeChatConfirm,
      hideBotCreatedWorkspaces: this.state.hideBotCreatedWorkspaces,
      botSidebarView: this.state.botSidebarView,
      sidebarBotsHeight: this.state.sidebarBotsHeight,
      sidebarProjectsFirst: this.state.sidebarProjectsFirst,
      petBotId: this.state.petBotId,
    };
    const nextPatch: Partial<BotGlobalSettings> = {
      ...patch,
      ...(patch.botSidebarView ? { botSidebarView: normalizeBotSidebarView(patch.botSidebarView) as BotSidebarView } : {}),
      ...(patch.sidebarBotsHeight !== undefined ? { sidebarBotsHeight: normalizeSidebarBotsHeight(patch.sidebarBotsHeight) } : {}),
    };
    this.editVersion += 1;
    if (nextPatch.sidebarProjectsFirst !== undefined) syncProjectsFirstAttribute(nextPatch.sidebarProjectsFirst);
    this.setState(nextPatch);
    try {
      await callBotRpc(RPC_METHODS.SETTINGS_SET, nextPatch as Record<string, unknown>);
    } catch (err) {
      syncProjectsFirstAttribute(prevSnapshot.sidebarProjectsFirst);
      this.setState(prevSnapshot);
      this.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  }

  async openBotHome(botId: string): Promise<void> {
    const bot = this.state.bots.find((entry) => entry.id === botId);
    const knownSession = bot?.chatSessionId ?? bot?.homeSessionId ?? null;
    this.setState({ activeBotId: botId, activeGroupId: null, ...(knownSession ? { activeSessionId: knownSession } : {}) });
    if (knownSession) this.host.openSession?.(knownSession, { botId });
    try {
      const res = await callBotRpc<{ sessionId?: string }>(RPC_METHODS.CHAT_OPEN, { botId });
      const sid = res?.sessionId ?? knownSession;
      if (sid) {
        this.setState({ activeBotId: botId, activeGroupId: null, activeSessionId: sid });
        if (sid !== knownSession) this.host.openSession?.(sid, { botId });
        void this.markChatSeen(botId, sid, true);
      }
    } catch (err) {
      this.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  }

  openBotChat(botId: string, sessionId: string): void {
    this.setState({ activeBotId: botId, activeGroupId: null, activeSessionId: sessionId });
    this.host.openSession?.(sessionId, { botId });
    void this.markChatSeen(botId, sessionId, true);
  }

  openGroup(groupId: string, threadId?: string): void {
    this.setState({ activeGroupId: groupId, activeBotId: null, activeSessionId: null });
    this.host.selectPanel?.('dsh-bots:group', { groupId, ...(threadId ? { threadId } : {}) });
  }

  async resetBotHomeChat(botId: string, options: { skipConfirm?: boolean; dontAskAgain?: boolean } = {}): Promise<void> {
    if (!options.skipConfirm && !this.state.skipNewHomeChatConfirm) {
      this.openModal({ kind: 'confirm-new-home', botId });
      return;
    }
    if (options.dontAskAgain) await this.updateGlobalSettings({ skipNewHomeChatConfirm: true });
    const res = await callBotRpc<{ sessionId?: string }>(RPC_METHODS.CHAT_RESET, { botId });
    if (res?.sessionId) {
      this.setState({ activeBotId: botId, activeGroupId: null, activeSessionId: res.sessionId });
      this.host.openSession?.(res.sessionId, { botId });
    }
    void this.refresh();
  }

  async startSideChat(botId: string, options: { title?: string; prompt?: string } = {}): Promise<string | null> {
    const res = await callBotRpc<{ sessionId?: string }>(RPC_METHODS.SESSION_START, { botId, ...options });
    const sessionId = res?.sessionId ?? null;
    if (sessionId) {
      this.setState({ activeBotId: botId, activeGroupId: null, activeSessionId: sessionId });
      this.host.openSession?.(sessionId, { botId });
      void this.refreshBotChatTree(botId);
    }
    return sessionId;
  }

  async markChatSeen(botId: string, sessionId: string | null, seen: boolean): Promise<void> {
    this.setState((prev) => ({ ...prev, bots: prev.bots.map((b) => (b.id === botId ? { ...b, unread: !seen } : b)) }));
    try {
      await callBotRpc(seen ? RPC_METHODS.CHATS_SEEN : RPC_METHODS.CHATS_UNSEEN, {
        botId, ...(sessionId ? { sessionId } : {}),
      });
    } catch (err) {
      console.warn(`[dsh-bots] Failed to update read status for ${botId}`, err);
    }
  }

  async createGroup(params: { name: string; botIds: string[]; replyMode?: BotGroupReplyMode }): Promise<BotGroupRecord> {
    const res = await callBotRpc<{ group?: BotGroupRecord } | BotGroupRecord>(RPC_METHODS.GROUPS_CREATE, params);
    const group = (res && 'group' in res && res.group ? res.group : res) as BotGroupRecord;
    this.setState((prev) => ({ ...prev, groups: [group, ...prev.groups.filter((i) => i.id !== group.id)] }));
    this.openGroup(group.id);
    return group;
  }

  async updateGroup(
    groupId: string,
    params: { name?: string; botIds?: string[]; replyMode?: BotGroupReplyMode; unread?: boolean },
  ): Promise<BotGroupRecord | null> {
    const res = await callBotRpc<{ group?: BotGroupRecord } | BotGroupRecord>(RPC_METHODS.GROUPS_UPDATE, { groupId, ...params });
    const updated = (res && 'group' in res && res.group ? res.group : res) as BotGroupRecord | undefined;
    if (updated?.id) {
      this.setState((prev) => ({ ...prev, groups: prev.groups.map((i) => (i.id === groupId ? { ...i, ...updated } : i)) }));
      return updated;
    }
    return null;
  }

  async deleteGroup(groupId: string): Promise<void> {
    const prevGroups = this.state.groups;
    this.setState((prev) => ({
      ...prev,
      groups: prev.groups.filter((i) => i.id !== groupId),
      activeGroupId: prev.activeGroupId === groupId ? null : prev.activeGroupId,
    }));
    try {
      await callBotRpc(RPC_METHODS.GROUPS_DELETE, { groupId });
    } catch (err) {
      this.setState({ groups: prevGroups });
      throw err;
    }
  }

  setSectionCollapsed(collapsed: boolean): void {
    writeStorageJson(STORAGE_KEYS.sectionCollapsed, collapsed);
    this.setState({ sectionCollapsed: collapsed });
  }

  toggleBotCollapsed(botId: string): void {
    const set = new Set(this.state.collapsedBotIds);
    if (set.has(botId)) set.delete(botId); else set.add(botId);
    const next = [...set];
    writeStorageJson(STORAGE_KEYS.collapsedBots, next);
    this.setState({ collapsedBotIds: next });
  }

  setAllBotsCollapsed(collapsed: boolean): void {
    const next = collapsed ? this.state.bots.map((bot) => bot.id) : [];
    writeStorageJson(STORAGE_KEYS.collapsedBots, next);
    this.setState({ collapsedBotIds: next });
  }

  setChatFold(key: string, fold: 'open' | 'folded'): void {
    const next = withBotChatFold(this.state.chatFolds, key, fold) as Record<string, 'open' | 'folded'>;
    writeStorageJson(STORAGE_KEYS.chatFolds, next);
    this.setState({ chatFolds: next });
  }

  setActiveSelection(sel: { botId?: string | null; groupId?: string | null; sessionId?: string | null }): void {
    this.setState((prev) => ({
      ...prev,
      activeBotId: sel.botId !== undefined ? sel.botId : prev.activeBotId,
      activeGroupId: sel.groupId !== undefined ? sel.groupId : prev.activeGroupId,
      activeSessionId: sel.sessionId !== undefined ? sel.sessionId : prev.activeSessionId,
    }));
  }

  setRightPanelTab(tab: BotRightPanelTab, botId?: string): void {
    this.setState((prev) => ({
      ...prev,
      rightPanelTab: tab,
      rightPanelItemId: null,
      settingsRoute: prev.settingsRoute?.host === 'panel' ? null : prev.settingsRoute,
    }));
    const targetBotId = botId ?? this.state.activeBotId;
    if (targetBotId) this.host.openRightPanel?.(targetBotId, tab);
  }

  setRightPanelItemId(itemId: string | null): void { this.setState({ rightPanelItemId: itemId }); }

  openBotSettings(botId: string, options: { host?: 'panel' | 'page'; page?: string | null; memoryTab?: 'facts' | 'history' } = {}): void {
    const host = options.host ?? 'page';
    this.setState({ activeBotId: botId, settingsRoute: { host, botId, page: options.page ?? null, memoryTab: options.memoryTab } });
    if (host === 'page') this.host.selectPanel?.('dsh-bots:settings', { botId, page: options.page ?? null });
    else this.host.openRightPanel?.(botId, this.state.rightPanelTab);
  }

  closeBotSettings(): void { this.setState({ settingsRoute: null }); }
  openModal(modal: BotsModalState): void { this.setState({ modal }); }
  closeModal(): void { this.setState({ modal: null }); }

  pushToast(toast: Omit<BotToast, 'id'>, durationMs = 5000): string {
    this.toastSeq += 1;
    const id = `bot-toast-${this.toastSeq}`;
    this.setState((prev) => ({ ...prev, toasts: [...prev.toasts.slice(-3), { id, ...toast }] }));
    if (durationMs > 0 && typeof window !== 'undefined') window.setTimeout(() => this.dismissToast(id), durationMs);
    return id;
  }

  dismissToast(id: string): void {
    this.setState((prev) => ({ ...prev, toasts: prev.toasts.filter((item) => item.id !== id) }));
  }

  async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (this.host.copyText) { await this.host.copyText(text); return true; }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[dsh-bots] Copy to clipboard failed', err);
      return false;
    }
  }
}

export const botsStore = new BotsStore();

export function useBotsState<T>(selector: (state: BotsState) => T): T {
  const state = useSyncExternalStore(botsStore.subscribe, botsStore.getState, botsStore.getState);
  return selector(state);
}

export function useBotById(botId: string | null | undefined): BotRecord | null {
  return useBotsState((state) => (botId ? state.bots.find((bot) => bot.id === botId) ?? null : null));
}

export function useBotBySessionId(sessionId: string | null | undefined): BotRecord | null {
  return useBotsState((state) => {
    if (!sessionId) return null;
    for (const bot of state.bots) {
      if (bot.chatSessionId === sessionId || bot.homeSessionId === sessionId) return bot;
      const tree = state.chatsByBot[bot.id];
      if (tree?.chats.some((chat) => chat.sessionId === sessionId || chat.chatId === sessionId)) return bot;
    }
    return null;
  });
}

export function useGroupById(groupId: string | null | undefined): BotGroupRecord | null {
  return useBotsState((state) => (groupId ? state.groups.find((group) => group.id === groupId) ?? null : null));
}

function detectBrowserLocale(): string {
  const hostLocale = botsStore.getHost().getLocale?.();
  if (hostLocale) return hostLocale;
  if (typeof document !== 'undefined' && document.documentElement.lang) return document.documentElement.lang;
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'zh-CN';
}

export type BotsTranslator = (
  key: string,
  fallbackOrParams?: string | Record<string, unknown>,
  maybeParams?: Record<string, unknown>,
) => string;

export function useBotsLocale(): { locale: 'zh-CN' | 'en-US'; tr: BotsTranslator } {
  const [rawLocale, setRawLocale] = useState<string>(detectBrowserLocale);
  useEffect(() => botsStore.getHost().subscribeLocale?.((next) => setRawLocale(next)), []);
  const locale = normalizeLocale(rawLocale) as 'zh-CN' | 'en-US';
  const tr = useMemo(() => createTranslator(locale) as BotsTranslator, [locale]);
  return { locale, tr };
}

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatRelativeTime(ts: number | null | undefined, now: number, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return locale === 'zh-CN' ? '刚刚' : 'now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}
