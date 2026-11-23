// Dual-host BotSettingsView (host="panel" inline in right sidebar | host="page" max-width 680px centered).
// Supports breadcrumb navigation + Esc step-back with subpage leave guard,
// restores root scroll position & originating trigger row focus on return,
// Ctrl+V image paste avatar with 8s undo bar, overview card with inline rename, core toggles,
// all 12 drill-down subpages, and destructive delete.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_BOT_AVATAR_COLOR } from '../../shared/bot-avatar-color.js';
import { BOT_ITEMS_STALE_CHOICES, DEFAULT_BOT_NOTIFICATIONS } from '../../shared/bot-types.js';
import {
  botsStore,
  useBotById,
  useBotsLocale,
  useBotsState,
} from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  invalidateUploadedAvatarCache,
  type BotRecord,
} from '../store/rpc';
import {
  AvatarPickerPopover,
  cropImageFileToPng512,
  type AvatarPickerValue,
  type CroppedAvatarImage,
} from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import {
  BotAgentSubpage,
  BotComputerSubpage,
  BotLookAroundSubpage,
  BotPermissionsSubpage,
  BotSoulSubpage,
  BotTidyUpSubpage,
  type BotSettingsLeaveGuard,
} from './BotSettingsSubpagesA';
import {
  BotConnectorsSubpage,
  BotMemorySubpage,
  BotSharingSubpage,
  BotSkillsSubpage,
  BotToolsSubpage,
  BotWhoCanAskSubpage,
} from './BotSettingsSubpagesB';
import {
  IconBell,
  IconBot,
  IconBrain,
  IconChevronLeft,
  IconChevronRight,
  IconEdit,
  IconFileText,
  IconFolder,
  IconGlobe,
  IconPlug,
  IconRefresh,
  IconShare,
  IconShield,
  IconSparkles,
  IconTrash,
  IconUndo,
  IconUsers,
  IconWrench,
} from './Icons';

export interface BotSettingsViewProps {
  host: 'panel' | 'page';
  botId?: string | null;
  onClosePage?: () => void;
}

type SubpageId =
  | 'agent'
  | 'permissions'
  | 'computer'
  | 'look-around'
  | 'tidy-up'
  | 'soul'
  | 'memory'
  | 'connectors'
  | 'who-can-ask'
  | 'tools'
  | 'skills'
  | 'sharing';

const SUBPAGE_META: Array<{ id: SubpageId; zh: string; en: string; descZh: string; descEn: string }> = [
  { id: 'agent', zh: '智能体和模型', en: 'Agent & model', descZh: '模型选择与推理强度', descEn: 'Model and reasoning effort' },
  { id: 'permissions', zh: '权限', en: 'Permissions', descZh: '会话起始工具与写入权限', descEn: 'Starting permission mode' },
  { id: 'computer', zh: '电脑与目录', en: 'Computer', descZh: '运行主机与 Home 文件夹路径', descEn: 'Host and bot home folder' },
  { id: 'look-around', zh: '巡视 (Look around)', en: 'Look around', descZh: '定期只读巡视周期与关注重点', descEn: 'Periodic sweep cadence and focus' },
  { id: 'tidy-up', zh: '记忆维护 (Tidy up)', en: 'Tidy up', descZh: '定期精简记忆与归档策略', descEn: 'Scheduled memory condensation' },
  { id: 'soul', zh: '灵魂 (SOUL.md)', en: 'Soul (SOUL.md)', descZh: '人设、职责与行为指令', descEn: 'Identity, role, and instructions' },
  { id: 'memory', zh: '记忆 (MEMORY.md)', en: 'Memory', descZh: '事实条目、主题文件与 90 天撤销历史', descEn: 'Facts, topic files, and 90-day history' },
  { id: 'connectors', zh: '连接器', en: 'Connectors', descZh: 'IM 渠道与本地 Webhook 接入', descEn: 'IM channels and local webhooks' },
  { id: 'who-can-ask', zh: '谁可以提问', en: 'Who can ask', descZh: '外部成员白名单与访问审批', descEn: 'Member allowlist and access requests' },
  { id: 'tools', zh: '工具 (MCP)', en: 'Tools (MCP)', descZh: '此队友专属的 MCP 服务器', descEn: 'Per-bot MCP servers' },
  { id: 'skills', zh: '技能 (Skills)', en: 'Skills', descZh: '关联工作区技能目录（最多 20 个）', descEn: 'Linked workspace skill folders' },
  { id: 'sharing', zh: '分享与导入', en: 'Sharing', descZh: '导出脱敏分享包或审核导入', descEn: 'Export sanitized package or review import' },
];

function renderSubpageIcon(id: SubpageId) {
  switch (id) {
    case 'agent': return <IconBot size={14} />;
    case 'permissions': return <IconShield size={14} />;
    case 'computer': return <IconFolder size={14} />;
    case 'look-around': return <IconSparkles size={14} />;
    case 'tidy-up': return <IconRefresh size={14} />;
    case 'soul': return <IconFileText size={14} />;
    case 'memory': return <IconBrain size={14} />;
    case 'connectors': return <IconPlug size={14} />;
    case 'who-can-ask': return <IconUsers size={14} />;
    case 'tools': return <IconWrench size={14} />;
    case 'skills': return <IconGlobe size={14} />;
    case 'sharing': return <IconShare size={14} />;
  }
}

function renderSubpageBody(
  page: SubpageId,
  bot: BotRecord,
  memoryTab: 'facts' | 'history' | undefined,
  onRegisterLeaveGuard: (guard: BotSettingsLeaveGuard | null) => void,
) {
  switch (page) {
    case 'agent': return <BotAgentSubpage bot={bot} />;
    case 'permissions': return <BotPermissionsSubpage bot={bot} />;
    case 'computer': return <BotComputerSubpage bot={bot} />;
    case 'look-around': return <BotLookAroundSubpage bot={bot} />;
    case 'tidy-up': return <BotTidyUpSubpage bot={bot} />;
    case 'soul': return <BotSoulSubpage bot={bot} onRegisterLeaveGuard={onRegisterLeaveGuard} />;
    case 'memory': return <BotMemorySubpage bot={bot} initialTab={memoryTab} />;
    case 'connectors': return <BotConnectorsSubpage bot={bot} />;
    case 'who-can-ask': return <BotWhoCanAskSubpage bot={bot} />;
    case 'tools': return <BotToolsSubpage bot={bot} />;
    case 'skills': return <BotSkillsSubpage bot={bot} />;
    case 'sharing': return <BotSharingSubpage bot={bot} />;
  }
}

export function BotSettingsView({ host, botId: propBotId, onClosePage }: BotSettingsViewProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const route = useBotsState((state) => state.settingsRoute);
  const bots = useBotsState((state) => state.bots);
  const petBotId = useBotsState((state) => state.petBotId);
  const resolvedBotId = propBotId ?? route?.botId ?? bots[0]?.id ?? null;
  const bot = useBotById(resolvedBotId);

  const [subpage, setSubpage] = useState<SubpageId | null>((route?.page as SubpageId | null) ?? null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const [undoAvatar, setUndoAvatar] = useState<{ avatar: string | null; avatarColor: string | null } | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const leaveGuardRef = useRef<BotSettingsLeaveGuard | null>(null);
  const savedRootScrollRef = useRef<number>(0);
  const returnFocusSubpageRef = useRef<SubpageId | null>(null);
  const prevSubpageRef = useRef<SubpageId | null>(subpage);

  const registerLeaveGuard = useCallback((guard: BotSettingsLeaveGuard | null) => {
    leaveGuardRef.current = guard;
  }, []);

  useEffect(() => {
    setSubpage((route?.page as SubpageId | null) ?? null);
  }, [route?.page, resolvedBotId]);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
  }, []);

  // Restore saved root scroll position and originating trigger row focus when returning from a subpage.
  useEffect(() => {
    const prev = prevSubpageRef.current;
    prevSubpageRef.current = subpage;
    if (prev !== null && subpage === null) {
      const targetRowId = returnFocusSubpageRef.current ?? prev;
      const targetScrollTop = savedRootScrollRef.current;
      returnFocusSubpageRef.current = null;
      window.requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = targetScrollTop;
        }
        const rowBtn = scrollContainerRef.current?.querySelector<HTMLButtonElement>(
          `[data-settings-subpage-row="${targetRowId}"]`,
        );
        rowBtn?.focus({ preventScroll: true });
      });
    } else if (prev === null && subpage !== null && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [subpage]);

  const openSubpage = useCallback((target: SubpageId) => {
    if (scrollContainerRef.current) {
      savedRootScrollRef.current = scrollContainerRef.current.scrollTop;
    }
    returnFocusSubpageRef.current = target;
    setSubpage(target);
  }, []);

  const navigateWithGuard = useCallback(async (action: () => void) => {
    if (leaveGuardRef.current) {
      const ok = await leaveGuardRef.current();
      if (!ok) {
        return;
      }
    }
    action();
  }, []);

  // Step back on Escape: subpage -> overview (guarded) -> close panel/page
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }
      event.preventDefault();
      if (subpage) {
        void navigateWithGuard(() => setSubpage(null));
      } else if (host === 'panel') {
        botsStore.closeBotSettings();
      } else {
        botsStore.closeBotSettings();
        onClosePage?.();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [host, navigateWithGuard, onClosePage, subpage]);

  // Ctrl+V direct image paste to update avatar with 8-second undo bar
  useEffect(() => {
    if (!bot) {
      return undefined;
    }
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) {
          continue;
        }
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        event.preventDefault();
        const snapshot = { avatar: bot.avatar ?? null, avatarColor: bot.avatarColor ?? null };
        void cropImageFileToPng512(file)
          .then(async (cropped) => {
            await callBotRpc(RPC_METHODS.AVATAR_UPLOAD, { botId: bot.id, base64Png: cropped.base64Png });
            invalidateUploadedAvatarCache(bot.id);
            await botsStore.refresh();
            setUndoAvatar(snapshot);
            if (undoTimerRef.current !== null) {
              window.clearTimeout(undoTimerRef.current);
            }
            undoTimerRef.current = window.setTimeout(() => {
              setUndoAvatar(null);
              undoTimerRef.current = null;
            }, 8000);
          })
          .catch((err) => {
            botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
          });
        break;
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [bot]);

  if (!bot) {
    return (
      <div className={host === 'page' ? 'dsh-bots-settings-page' : 'dsh-bots-settings-panel'}>
        <div className="dsh-bots-empty" style={{ margin: 20 }}>
          {zh ? '未找到目标大肥鱼队友。' : 'Bot not found.'}
        </div>
      </div>
    );
  }

  const currentMeta = subpage ? SUBPAGE_META.find((m) => m.id === subpage) : null;
  const notif = { ...DEFAULT_BOT_NOTIFICATIONS, ...(bot.notifications ?? {}) };
  const staleChoice = (bot as BotRecord & { itemsStale?: number | 'never' }).itemsStale ?? 5;
  const isPetBound = petBotId === bot.id;

  const commitRename = async () => {
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (trimmed && trimmed !== bot.name) {
      await botsStore.updateBot(bot.id, { name: trimmed });
    }
  };

  const handleUploadCommit = async (image: CroppedAvatarImage) => {
    await callBotRpc(RPC_METHODS.AVATAR_UPLOAD, { botId: bot.id, base64Png: image.base64Png });
    invalidateUploadedAvatarCache(bot.id);
    await botsStore.refresh();
  };

  const breadcrumb = (
    <div className="dsh-bots-settings-crumb">
      <button
        type="button"
        className="dsh-bots-settings-crumb-link"
        onClick={() => {
          if (subpage) {
            void navigateWithGuard(() => setSubpage(null));
          } else {
            botsStore.closeBotSettings();
            if (host === 'page') {
              onClosePage?.();
            }
          }
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <IconChevronLeft size={13} />
          <span>{bot.name}</span>
        </span>
      </button>
      <span>/</span>
      <button
        type="button"
        className={`dsh-bots-settings-crumb-link ${!subpage ? 'dsh-bots-settings-crumb-current' : ''}`.trim()}
        onClick={() => {
          if (subpage) {
            void navigateWithGuard(() => setSubpage(null));
          }
        }}
      >
        {tr('bots.panel.settings.title', 'Settings')}
      </button>
      {currentMeta && (
        <>
          <span>/</span>
          <span className="dsh-bots-settings-crumb-current">{zh ? currentMeta.zh : currentMeta.en}</span>
        </>
      )}
    </div>
  );

  const runtimeLabel = !bot.agent || bot.agent === 'deepseek-harness'
    ? tr('bots.runtime.local', zh ? '鲸屿内核' : 'WhaleIsle Core')
    : bot.agent;

  const innerContent = (
    <>
      {undoAvatar && (
        <div className="dsh-bots-undo-bar">
          <span>{zh ? '已粘贴更新头像（8 秒内可撤销）' : 'Avatar updated from clipboard'}</span>
          <button
            type="button"
            className="dsh-bots-undo-btn"
            onClick={async () => {
              const prev = undoAvatar;
              setUndoAvatar(null);
              await botsStore.updateBot(bot.id, { avatar: prev.avatar, avatarColor: prev.avatarColor });
            }}
          >
            <IconUndo size={11} />
            <span>{tr('settings.bots.memoryUndo', 'Undo')}</span>
          </button>
        </div>
      )}

      {subpage ? (
        renderSubpageBody(subpage, bot, route?.memoryTab, registerLeaveGuard)
      ) : (
        <>
          {/* Hero profile card */}
          <div className="dsh-bots-settings-hero">
            <button
              ref={avatarBtnRef}
              type="button"
              className="dsh-bots-panel-avatar-trigger"
              title={zh ? '点击或 Ctrl+V 粘贴图片更换头像' : 'Click or paste image to change avatar'}
              onClick={() => {
                const rect = avatarBtnRef.current?.getBoundingClientRect() ?? null;
                setPickerRect((prev) => (prev ? null : rect));
              }}
            >
              <BotAvatar
                botId={bot.id}
                avatar={bot.avatar}
                avatarColor={bot.avatarColor}
                name={bot.name}
                size={40}
                radius={10}
                paused={bot.paused}
              />
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              {renaming ? (
                <input
                  type="text"
                  autoFocus
                  maxLength={64}
                  className="dsh-bots-pinput"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void commitRename();
                    } else if (e.key === 'Escape') {
                      setRenaming(false);
                    }
                  }}
                />
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600 }}>{bot.name}</span>
                  <button
                    type="button"
                    className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                    title={tr('bots.row.rename', 'Rename')}
                    onClick={() => {
                      setNameDraft(bot.name);
                      setRenaming(true);
                    }}
                  >
                    <IconEdit size={12} />
                  </button>
                </div>
              )}
              <div className="dsh-bots-muted">
                {`${runtimeLabel} · ${bot.paused ? tr('bots.row.paused', 'Paused') : (zh ? '已启用' : 'Active')} · ${bot.hostName || (zh ? '本机' : 'Local')}`}
              </div>
            </div>

            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => botsStore.openModal({ kind: 'share', mode: 'export', botId: bot.id })}
            >
              <IconShare size={12} />
              <span>{zh ? '分享…' : 'Share…'}</span>
            </button>
          </div>

          {/* Core inline toggles */}
          <div className="dsh-bots-settings-grid">
            <div className="dsh-bots-settings-row">
              <div>
                <div style={{ fontWeight: 500 }}>{zh ? '已启用' : 'Active'}</div>
                <div className="dsh-bots-muted">{zh ? '关闭后暂停响应与定时任务，保留所有数据。' : 'Pause responses and automations without deleting data.'}</div>
              </div>
              <button
                type="button"
                role="switch"
                className="dsh-bots-switch"
                aria-checked={!bot.paused}
                onClick={() => void botsStore.updateBot(bot.id, { paused: !bot.paused })}
              >
                <span className="dsh-bots-switch-thumb" />
              </button>
            </div>

            <div className="dsh-bots-settings-row">
              <div>
                <div style={{ fontWeight: 500 }}>{zh ? '绑定为桌宠助手' : 'Bind to desktop pet'}</div>
                <div className="dsh-bots-muted">{zh ? '桌宠气泡对话、动作互动与默认快捷入口将指向此大肥鱼队友。' : 'Desktop pet chat and notifications connect to this bot.'}</div>
              </div>
              <button
                type="button"
                role="switch"
                className="dsh-bots-switch"
                aria-checked={isPetBound}
                onClick={() => void botsStore.updateGlobalSettings({ petBotId: isPetBound ? null : bot.id })}
              >
                <span className="dsh-bots-switch-thumb" />
              </button>
            </div>

            <div className="dsh-bots-settings-row">
              <div>
                <div style={{ fontWeight: 500 }}>{zh ? '长期无活动条目阈值' : 'Stale items threshold'}</div>
                <div className="dsh-bots-muted">{zh ? '已计划条目自动使用 3 倍时长。' : 'Planned items use 3× this duration.'}</div>
              </div>
              <select
                className="dsh-bots-pselect"
                style={{ width: 'auto', minWidth: 96 }}
                value={String(staleChoice)}
                onChange={(e) => {
                  const val = e.target.value === 'never' ? 'never' : Number(e.target.value);
                  void botsStore.updateBot(bot.id, { itemsStale: val } as Partial<BotRecord>);
                }}
              >
                {BOT_ITEMS_STALE_CHOICES.map((ch) => (
                  <option key={String(ch)} value={String(ch)}>
                    {ch === 'never' ? (zh ? '永不' : 'Never') : (zh ? `${ch} 天` : `${ch} days`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="dsh-bots-pcard" style={{ gap: 8 }}>
              <div className="dsh-bots-section-title">
                <IconBell size={13} />
                <span>{tr('settings.bots.notifications.title', 'Notifications')}</span>
              </div>
              {([
                ['needsPermission', tr('settings.bots.notifications.needsPermission', 'Needs permission')],
                ['taskComplete', tr('settings.bots.notifications.taskComplete', 'Task complete')],
                ['couldNotFinish', tr('settings.bots.notifications.couldNotFinish', 'Could not finish')],
              ] as const).map(([key, label]) => (
                <div key={key} className="dsh-bots-row">
                  <span>{label}</span>
                  <button
                    type="button"
                    role="switch"
                    className="dsh-bots-switch"
                    aria-checked={Boolean(notif[key])}
                    onClick={() => void botsStore.updateBot(bot.id, {
                      notifications: { ...notif, [key]: !notif[key] },
                    })}
                  >
                    <span className="dsh-bots-switch-thumb" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* All 12 drill-down subpage rows */}
          <div className="dsh-bots-settings-grid">
            {SUBPAGE_META.map((item) => (
              <button
                key={item.id}
                type="button"
                data-settings-subpage-row={item.id}
                className="dsh-bots-settings-nav-row"
                onClick={() => openSubpage(item.id)}
              >
                <div className="dsh-bots-row-left" style={{ gap: 9 }}>
                  {renderSubpageIcon(item.id)}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{zh ? item.zh : item.en}</div>
                    <div className="dsh-bots-muted">{zh ? item.descZh : item.descEn}</div>
                  </div>
                </div>
                <IconChevronRight size={14} style={{ opacity: 0.6 }} />
              </button>
            ))}
          </div>

          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-danger"
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            onClick={() => botsStore.openModal({ kind: 'confirm-delete-bot', botId: bot.id })}
          >
            <IconTrash size={13} />
            <span>{tr('bots.row.delete', 'Delete bot')}</span>
          </button>
        </>
      )}

      <AvatarPickerPopover
        open={Boolean(pickerRect)}
        anchorRect={pickerRect}
        onClose={() => setPickerRect(null)}
        value={{
          avatar: bot.avatar || 'mascot:W1',
          avatarColor: bot.avatarColor || DEFAULT_BOT_AVATAR_COLOR,
        }}
        onChange={(next: AvatarPickerValue) => {
          if (next.avatar !== 'upload:pending') {
            void botsStore.updateBot(bot.id, { avatar: next.avatar, avatarColor: next.avatarColor });
          }
        }}
        onUploadCommit={handleUploadCommit}
      />
    </>
  );

  if (host === 'page') {
    return (
      <div
        ref={scrollContainerRef}
        className="dsh-bots-settings-page"
        data-dsh-bots-settings-host="page"
      >
        <div className="dsh-bots-settings-page-inner">
          {breadcrumb}
          {innerContent}
        </div>
      </div>
    );
  }

  return (
    <div className="dsh-bots-settings-panel" data-dsh-bots-settings-host="panel">
      {breadcrumb}
      <div ref={scrollContainerRef} className="dsh-bots-settings-body">{innerContent}</div>
    </div>
  );
}
