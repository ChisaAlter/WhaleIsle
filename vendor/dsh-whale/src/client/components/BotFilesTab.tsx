// Right-panel Files tab: browse and view/edit files in the bot's Home folder
// (SOUL.md, MEMORY.md, memory/*.md, AGENTS.md, bot.json, skills/*) with save state & conflict detection.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import { IconCheck, IconFileText, IconFolder, IconRefresh } from './Icons';

export interface BotFilesTabProps {
  bot: BotRecord;
}

interface HomeFileEntry {
  name: string;
  path: string;
  kind?: 'file' | 'dir' | 'directory';
  isDirectory?: boolean;
  size?: number;
}

const PINNED_FILES = ['SOUL.md', 'MEMORY.md', 'AGENTS.md', 'bot.json'];

function normalizeEntries(raw: unknown): HomeFileEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown[] }).entries)
      ? (raw as { entries: unknown[] }).entries
      : []);
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const pathVal = String(item.path ?? item.relPath ?? item.name ?? '');
      const nameVal = String(item.name ?? pathVal.split('/').pop() ?? pathVal);
      const isDir = item.kind === 'dir' || item.kind === 'directory' || item.isDirectory === true;
      return {
        name: nameVal,
        path: pathVal,
        kind: isDir ? 'dir' : 'file',
        isDirectory: isDir,
        size: typeof item.size === 'number' ? item.size : undefined,
      };
    });
}

export function BotFilesTab({ bot }: BotFilesTabProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [subDir, setSubDir] = useState('');
  const [entries, setEntries] = useState<HomeFileEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>('SOUL.md');
  const [diskContent, setDiskContent] = useState('');
  const [draft, setDraft] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const loadList = useCallback(async (dir: string) => {
    setLoadingList(true);
    try {
      const res = await callBotRpc(RPC_METHODS.FILES_LIST, { botId: bot.id, subDir: dir, dir });
      setEntries(normalizeEntries(res));
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setLoadingList(false);
    }
  }, [bot.id]);

  const loadFile = useCallback(async (relPath: string, checkConflict = false) => {
    if (!relPath) {
      return;
    }
    setLoadingFile(true);
    setConflictMsg(null);
    try {
      const res = await callBotRpc<{ content?: string }>(RPC_METHODS.FILES_READ, {
        botId: bot.id,
        path: relPath,
        relPath,
      });
      const content = typeof res?.content === 'string' ? res.content : '';
      if (checkConflict && draft !== diskContent && content !== diskContent) {
        setConflictMsg(zh ? '磁盘文件已在外部更新，请决定保留草稿或重新加载。' : 'File changed on disk.');
      } else {
        setDiskContent(content);
        setDraft(content);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFile(false);
    }
  }, [bot.id, diskContent, draft, zh]);

  useEffect(() => {
    setSubDir('');
    void loadList('');
    setSelectedPath('SOUL.md');
  }, [bot.id, loadList]);

  useEffect(() => {
    if (selectedPath) {
      void loadFile(selectedPath, false);
    }
  }, [selectedPath, bot.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (Boolean(a.isDirectory) !== Boolean(b.isDirectory)) {
        return a.isDirectory ? -1 : 1;
      }
      const pa = PINNED_FILES.indexOf(a.path);
      const pb = PINNED_FILES.indexOf(b.path);
      if (pa !== -1 || pb !== -1) {
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      }
      return a.name.localeCompare(b.name);
    });
  }, [entries]);

  const dirty = draft !== diskContent;

  const handleSave = async () => {
    if (!selectedPath || saving) {
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    setConflictMsg(null);
    try {
      await callBotRpc(RPC_METHODS.FILES_WRITE, {
        botId: bot.id,
        path: selectedPath,
        relPath: selectedPath,
        content: draft,
      });
      setDiskContent(draft);
      setStatusMsg(tr('settings.bots.saved', 'Saved'));
      void botsStore.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConflictMsg(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dsh-bots-panel-scroll">
      <div className="dsh-bots-files-split">
        <div className="dsh-bots-row">
          <div className="dsh-bots-row-left">
            {subDir && (
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => {
                  const parent = subDir.split('/').slice(0, -1).join('/');
                  setSubDir(parent);
                  void loadList(parent);
                }}
              >
                ←
              </button>
            )}
            <span className="dsh-bots-muted dsh-bots-ellipsis" style={{ fontFamily: 'var(--ds-font-family-code)' }}>
              {subDir ? `/${subDir}` : (bot.homePath || '/')}
            </span>
          </div>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
            title={zh ? '刷新目录' : 'Refresh'}
            onClick={() => {
              void loadList(subDir);
              if (selectedPath) {
                void loadFile(selectedPath, true);
              }
            }}
          >
            <IconRefresh size={12} />
          </button>
        </div>

        <div className="dsh-bots-file-list">
          {loadingList && entries.length === 0 ? (
            <div className="dsh-bots-muted" style={{ padding: 8 }}>{zh ? '正在加载文件…' : 'Loading files…'}</div>
          ) : sortedEntries.length === 0 ? (
            <div className="dsh-bots-empty">{zh ? '此目录为空' : 'Empty directory'}</div>
          ) : (
            sortedEntries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="dsh-bots-tree-row dsh-bots-file-row"
                data-active={!entry.isDirectory && entry.path === selectedPath ? 'true' : 'false'}
                onClick={() => {
                  if (entry.isDirectory) {
                    setSubDir(entry.path);
                    void loadList(entry.path);
                  } else {
                    setSelectedPath(entry.path);
                    setStatusMsg(null);
                  }
                }}
              >
                {entry.isDirectory ? <IconFolder size={13} /> : <IconFileText size={13} />}
                <span className="dsh-bots-ellipsis" style={{ flex: 1, fontFamily: 'var(--ds-font-family-code)', fontSize: 12 }}>
                  {entry.name}
                </span>
                {entry.size !== undefined && !entry.isDirectory && (
                  <span className="dsh-bots-muted">{entry.size}B</span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="dsh-bots-file-editor">
          <div className="dsh-bots-row">
            <span style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 12, fontWeight: 600 }} className="dsh-bots-ellipsis">
              {selectedPath}
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {dirty && <span className="dsh-bots-badge dsh-bots-badge-warn">{tr('settings.bots.unsaved', 'Unsaved')}</span>}
              {!dirty && statusMsg && (
                <span className="dsh-bots-badge dsh-bots-badge-success">
                  <IconCheck size={10} /> {statusMsg}
                </span>
              )}
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                disabled={!dirty || saving || loadingFile}
                onClick={() => void handleSave()}
              >
                {saving ? tr('settings.bots.saving', 'Saving…') : (zh ? '保存' : 'Save')}
              </button>
            </div>
          </div>

          {conflictMsg && (
            <div className="dsh-bots-pcard dsh-bots-pcard-warn" style={{ padding: '7px 9px' }}>
              <div style={{ fontSize: 11.5 }}>{conflictMsg}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => void loadFile(selectedPath, false)}
                >
                  {zh ? '加载磁盘版本' : 'Reload disk'}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                  onClick={() => void handleSave()}
                >
                  {zh ? '覆盖保存' : 'Overwrite'}
                </button>
              </div>
            </div>
          )}

          <textarea
            className="dsh-bots-ptextarea dsh-bots-ptextarea-mono"
            style={{ flex: 1, minHeight: 220 }}
            disabled={loadingFile}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatusMsg(null);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirty) {
                  void handleSave();
                }
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
