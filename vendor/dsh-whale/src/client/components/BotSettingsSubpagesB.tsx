// Bot Settings Drill-down Subpages B (3 of 12):
// 7. memory (Facts add/edit/forget + memory/ topic files; History 90-day audit + Undo)
// 8. connectors (embeds BotConnectorsTab)
// 9. who-can-ask (<=200 member allowlist + pending access requests)
// Re-exports BotToolsSubpage, BotSkillsSubpage, BotSharingSubpage from BotSettingsSubpagesC.

import { useCallback, useEffect, useState } from 'react';
import { BOT_LIMITS } from '../../shared/bot-types.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import { BotConnectorsTab } from './BotConnectorsTab';
import type { SubpageProps } from './BotSettingsSubpagesA';
import { IconCheck, IconEdit, IconFileText, IconPlus, IconTrash, IconUndo } from './Icons';

export {
  BotSharingSubpage,
  BotSkillsSubpage,
  BotToolsSubpage,
} from './BotSettingsSubpagesC';

// Mirrors `parseMemoryLine()` + `lineNumber` from lib/bots/service.js `memoryList`.
interface MemoryFactRow {
  isFact?: boolean;
  raw?: string;
  bullet?: string;
  date?: string | null;
  body?: string;
  source?: string | null;
  key?: string;
  lineNumber?: number;
  text?: string;
}

interface MemoryListPayload {
  facts: MemoryFactRow[];
  loadedLimit: number;
  totalLines: number;
  truncatedCount: number;
  topicFiles: string[];
  archiveExists: boolean;
}

type MemoryHistoryLine = string | { line?: string } | null | undefined;

// Mirrors `appendHistory()` entries from lib/bots/memory-service.js (`added`/`removed` are string[]).
interface MemoryHistoryEntry {
  id: string;
  kind?: string;
  actor?: string;
  at?: number;
  of?: string;
  sourceLabel?: string;
  added?: MemoryHistoryLine[];
  removed?: MemoryHistoryLine[];
  kept?: MemoryHistoryLine[];
  redacted?: boolean;
  undoable?: boolean;
  createdAt?: number;
}

function factBody(fact: MemoryFactRow | null | undefined): string {
  return String(fact?.body ?? fact?.text ?? fact?.raw ?? '');
}

function factMatch(fact: MemoryFactRow): string {
  return String(fact.raw ?? '').trim() || factBody(fact);
}

function historyLine(item: MemoryHistoryLine): string {
  return typeof item === 'string' ? item : String(item?.line ?? '');
}

function undoneChangeIds(entries: MemoryHistoryEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry?.kind === 'undo' && typeof entry.of === 'string') ids.add(entry.of);
  }
  return ids;
}

export function BotMemorySubpage({
  bot,
  initialTab = 'facts',
}: SubpageProps & { initialTab?: 'facts' | 'history' }) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [tab, setTab] = useState<'facts' | 'history'>(initialTab);
  const [mem, setMem] = useState<MemoryListPayload | null>(null);
  const [history, setHistory] = useState<MemoryHistoryEntry[]>([]);
  const [newFact, setNewFact] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [topicPreview, setTopicPreview] = useState<{ name: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFacts = useCallback(async () => {
    try {
      const res = await callBotRpc<MemoryListPayload>('bots.memory.list', { botId: bot.id });
      const facts = Array.isArray(res?.facts) ? res.facts.filter((f) => f && f.isFact !== false) : [];
      setMem(res ? { ...res, facts, topicFiles: Array.isArray(res.topicFiles) ? res.topicFiles : [] } : null);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  }, [bot.id]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await callBotRpc<{ entries?: MemoryHistoryEntry[] } | MemoryHistoryEntry[]>(
        RPC_METHODS.MEMORY_HISTORY,
        { botId: bot.id, limit: 100 },
      );
      const list = Array.isArray(res) ? res : (res?.entries ?? []);
      setHistory(Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string') : []);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  }, [bot.id]);

  useEffect(() => {
    void loadFacts();
    void loadHistory();
  }, [loadFacts, loadHistory]);

  const addFact = async () => {
    const text = newFact.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    try {
      await callBotRpc('bots.memory.add', { botId: bot.id, text });
      setNewFact('');
      await Promise.all([loadFacts(), loadHistory()]);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const commitEdit = async (fact: MemoryFactRow) => {
    const nextText = editDraft.trim();
    if (!nextText) {
      return;
    }
    setBusy(true);
    try {
      await callBotRpc(RPC_METHODS.MEMORY_EDIT, {
        botId: bot.id,
        match: factMatch(fact),
        nextText,
        date: fact.date ?? undefined,
      });
      setEditingIdx(null);
      await Promise.all([loadFacts(), loadHistory()]);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const forgetFact = async (fact: MemoryFactRow) => {
    setBusy(true);
    try {
      await callBotRpc(RPC_METHODS.MEMORY_FORGET, { botId: bot.id, fact: factMatch(fact) });
      await Promise.all([loadFacts(), loadHistory()]);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const undoEntry = async (changeId: string) => {
    setBusy(true);
    try {
      await callBotRpc(RPC_METHODS.MEMORY_UNDO, { botId: bot.id, changeId });
      botsStore.pushToast({ message: zh ? '已撤销记忆变更' : 'Memory change undone', tone: 'success' });
      await Promise.all([loadFacts(), loadHistory()]);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-row">
        <div className="dsh-bots-picker-seg">
          <button
            type="button"
            className="dsh-bots-picker-seg-btn"
            aria-pressed={tab === 'facts'}
            onClick={() => setTab('facts')}
          >
            {tr('settings.bots.memoryFacts', 'Facts')} ({mem?.facts.length ?? 0})
          </button>
          <button
            type="button"
            className="dsh-bots-picker-seg-btn"
            aria-pressed={tab === 'history'}
            onClick={() => setTab('history')}
          >
            {tr('settings.bots.memoryHistory', 'History')} ({history.length})
          </button>
        </div>
        {mem && mem.truncatedCount > 0 && (
          <span className="dsh-bots-badge dsh-bots-badge-warn">
            {zh ? `超出 ${mem.loadedLimit} 行上限 (+${mem.truncatedCount})` : `+${mem.truncatedCount} over cap`}
          </span>
        )}
      </div>

      {tab === 'facts' ? (
        <>
          <div className="dsh-bots-row">
            <input
              type="text"
              className="dsh-bots-pinput"
              placeholder={tr('settings.bots.addMemoryPlaceholder', 'Remember something new…')}
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addFact();
                }
              }}
            />
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-primary"
              disabled={!newFact.trim() || busy}
              onClick={() => void addFact()}
            >
              <IconPlus size={12} />
              <span>{zh ? '添加' : 'Add'}</span>
            </button>
          </div>

          {(mem?.facts ?? []).length === 0 ? (
            <div className="dsh-bots-empty">{tr('settings.bots.memoryEmpty', 'No facts saved yet.')}</div>
          ) : (
            (mem?.facts ?? []).map((fact, idx) => (
              <div key={`${fact.lineNumber ?? idx}-${factBody(fact).slice(0, 24)}`} className="dsh-bots-pcard">
                {editingIdx === idx ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      className="dsh-bots-pinput"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void commitEdit(fact);
                        } else if (e.key === 'Escape') {
                          setEditingIdx(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                      onClick={() => void commitEdit(fact)}
                    >
                      <IconCheck size={11} />
                    </button>
                  </div>
                ) : (
                  <div className="dsh-bots-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ lineHeight: 1.5 }}>{factBody(fact)}</div>
                      <div className="dsh-bots-muted" style={{ marginTop: 2 }}>
                        {[fact.date, fact.source ? `from: ${fact.source}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button
                        type="button"
                        className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                        title={zh ? '编辑' : 'Edit'}
                        onClick={() => {
                          setEditingIdx(idx);
                          setEditDraft(factBody(fact));
                        }}
                      >
                        <IconEdit size={11} />
                      </button>
                      <button
                        type="button"
                        className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon dsh-bots-pbtn-danger"
                        title={zh ? '遗忘' : 'Forget'}
                        onClick={() => void forgetFact(fact)}
                      >
                        <IconTrash size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {((mem?.topicFiles?.length ?? 0) > 0 || mem?.archiveExists) && (
            <div className="dsh-bots-psection" style={{ marginTop: 6 }}>
              <span className="dsh-bots-section-title">{zh ? '主题记忆文件 (memory/)' : 'Topic files (memory/)'}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[...(mem?.topicFiles ?? []), ...(mem?.archiveExists ? ['archive.md'] : [])].map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                    onClick={async () => {
                      const res = await callBotRpc<{ content?: string }>(RPC_METHODS.FILES_READ, {
                        botId: bot.id,
                        path: `memory/${name}`,
                        relPath: `memory/${name}`,
                      });
                      setTopicPreview({ name, content: res?.content ?? '' });
                    }}
                  >
                    <IconFileText size={11} />
                    <span>memory/{name}</span>
                  </button>
                ))}
              </div>
              {topicPreview && (
                <div className="dsh-bots-pcard">
                  <div className="dsh-bots-row">
                    <strong style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 12 }}>memory/{topicPreview.name}</strong>
                    <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" onClick={() => setTopicPreview(null)}>
                      {zh ? '关闭' : 'Close'}
                    </button>
                  </div>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11.5, maxHeight: 180, overflowY: 'auto' }}>
                    {topicPreview.content}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.length === 0 ? (
            <div className="dsh-bots-empty">{zh ? '近 90 天暂无记忆变更记录。' : 'No memory history in the last 90 days.'}</div>
          ) : (
            (() => {
              const undone = undoneChangeIds(history);
              return history.map((entry) => (
                <MemoryHistoryCard
                  key={entry.id}
                  entry={entry}
                  undone={undone.has(entry.id)}
                  busy={busy}
                  zh={zh}
                  locale={locale}
                  undoLabel={tr('settings.bots.memoryUndo', 'Undo')}
                  onUndo={(id) => void undoEntry(id)}
                />
              ));
            })()
          )}
        </div>
      )}
    </div>
  );
}

function memoryHistoryStatus(entry: MemoryHistoryEntry, undone: boolean, zh: boolean): string {
  if (undone) return zh ? '已撤销' : 'Undone';
  if (entry.redacted) return zh ? '含脱敏内容不可撤销' : 'Redacted';
  return zh ? '不可撤销' : 'Not undoable';
}

function MemoryHistoryCard({
  entry,
  undone,
  busy,
  zh,
  locale,
  undoLabel,
  onUndo,
}: {
  entry: MemoryHistoryEntry;
  undone: boolean;
  busy: boolean;
  zh: boolean;
  locale: string;
  undoLabel: string;
  onUndo: (changeId: string) => void;
}) {
  const ts = Number(entry.at ?? entry.createdAt ?? 0);
  const added = (Array.isArray(entry.added) ? entry.added : []).map(historyLine).filter(Boolean);
  const removed = (Array.isArray(entry.removed) ? entry.removed : []).map(historyLine).filter(Boolean);
  const kept = (Array.isArray(entry.kept) ? entry.kept : []).map(historyLine).filter(Boolean);
  const canUndo = entry.undoable === true && !undone;
  return (
    <div className="dsh-bots-pcard">
      <div className="dsh-bots-row">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="dsh-bots-badge">{entry.kind || 'edit'}</span>
          <span className="dsh-bots-muted">{entry.actor || 'owner'}</span>
          <span className="dsh-bots-muted">{ts > 0 ? new Date(ts).toLocaleString(locale) : ''}</span>
        </div>
        {canUndo ? (
          <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" disabled={busy} onClick={() => onUndo(entry.id)}>
            <IconUndo size={11} />
            <span>{undoLabel}</span>
          </button>
        ) : (
          <span className="dsh-bots-muted">{memoryHistoryStatus(entry, undone, zh)}</span>
        )}
      </div>
      {added.map((line, i) => (
        <div key={`a-${i}`} className="dsh-bots-diff-add">+ {line}</div>
      ))}
      {removed.map((line, i) => (
        <div key={`r-${i}`} className="dsh-bots-diff-del">− {line}</div>
      ))}
      {kept.map((line, i) => (
        <div key={`k-${i}`} className="dsh-bots-muted">= {line}</div>
      ))}
    </div>
  );
}

export function BotConnectorsSubpage({ bot }: SubpageProps) {
  return <BotConnectorsTab bot={bot} embedded />;
}

interface MemberItem {
  id: string;
  name?: string;
  source?: string;
}

export function BotWhoCanAskSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const members = ((bot as BotRecord & { members?: MemberItem[] }).members ?? []);
  const [requests, setRequests] = useState<Array<{ id: string; requesterId: string; requesterName?: string; source?: string; status: string }>>([]);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState('feishu');

  const loadRequests = useCallback(async () => {
    try {
      const res = await callBotRpc<Array<{ id: string; requesterId: string; requesterName?: string; source?: string; status: string }>>(
        RPC_METHODS.ACCESS_LIST,
        { botId: bot.id, status: 'pending' },
      );
      setRequests(Array.isArray(res) ? res.filter((r) => r.status === 'pending') : []);
    } catch (err) {
      console.warn('[dsh-bots] access.list failed', err);
    }
  }, [bot.id]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const addMember = async () => {
    const id = newId.trim();
    if (!id || members.length >= BOT_LIMITS.maxMembers) {
      return;
    }
    await botsStore.updateBot(bot.id, {
      addMembers: [{ id, name: newName.trim() || id, source: newSource }],
    } as Partial<BotRecord>);
    setNewId('');
    setNewName('');
  };

  return (
    <div className="dsh-bots-psection">
      {requests.length > 0 && (
        <div className="dsh-bots-psection">
          <span className="dsh-bots-section-title">
            {zh ? `待审批请求 (${requests.length})` : `Pending requests (${requests.length})`}
          </span>
          {requests.map((req) => (
            <div key={req.id} className="dsh-bots-pcard dsh-bots-pcard-warn">
              <div className="dsh-bots-row">
                <span style={{ fontWeight: 600 }}>{req.requesterName || req.requesterId}</span>
                {req.source && <span className="dsh-bots-badge">{req.source}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                  onClick={async () => {
                    await callBotRpc(RPC_METHODS.ACCESS_DECIDE, { id: req.id, decision: 'granted' });
                    await Promise.all([loadRequests(), botsStore.refresh()]);
                  }}
                >
                  {zh ? '批准加入白名单' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={async () => {
                    await callBotRpc(RPC_METHODS.ACCESS_DECIDE, { id: req.id, decision: 'denied' });
                    void loadRequests();
                  }}
                >
                  {zh ? '拒绝' : 'Deny'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dsh-bots-pcard" style={{ gap: 7 }}>
        <div className="dsh-bots-row">
          <span style={{ fontWeight: 600 }}>{zh ? '允许提问成员白名单' : 'Allowed members'}</span>
          <span className="dsh-bots-muted">{members.length} / {BOT_LIMITS.maxMembers}</span>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          <select
            className="dsh-bots-pselect"
            style={{ width: 96 }}
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
          >
            <option value="feishu">Feishu</option>
            <option value="slack">Slack</option>
            <option value="github">GitHub</option>
            <option value="linear">Linear</option>
            <option value="telegram">Telegram</option>
          </select>
          <input
            type="text"
            className="dsh-bots-pinput"
            placeholder={zh ? '成员 ID' : 'Member ID'}
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <input
            type="text"
            className="dsh-bots-pinput"
            placeholder={zh ? '昵称（可选）' : 'Name (optional)'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-primary"
            disabled={!newId.trim() || members.length >= BOT_LIMITS.maxMembers}
            onClick={() => void addMember()}
          >
            <IconPlus size={12} />
          </button>
        </div>
      </div>

      {members.length === 0 ? (
        <div className="dsh-bots-empty">
          {zh ? '目前仅你本人可向此大肥鱼队友提问。' : 'Only you can ask this bot right now.'}
        </div>
      ) : (
        members.map((m) => (
          <div key={`${m.source ?? 'default'}-${m.id}`} className="dsh-bots-settings-row">
            <div>
              <div style={{ fontWeight: 500 }}>{m.name || m.id}</div>
              <div className="dsh-bots-muted">{[m.source, m.id].filter(Boolean).join(' · ')}</div>
            </div>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
              onClick={() => void botsStore.updateBot(bot.id, { removeMember: m.id } as Partial<BotRecord>)}
            >
              {zh ? '移除' : 'Remove'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
