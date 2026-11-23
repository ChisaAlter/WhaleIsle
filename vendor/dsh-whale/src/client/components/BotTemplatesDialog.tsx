// Two-pane Orca bot template browser dialog (6 categories, search, live detail preview).

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { mascotAvatar } from '../../shared/bot-avatar.js';
import {
  BOT_CONNECTOR_NAMES,
  BOT_TEMPLATES,
  BOT_TEMPLATE_CATEGORIES,
  localizeTemplate,
  searchTemplates,
} from '../../shared/bot-templates.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { BotAvatar } from './BotAvatar';
import {
  IconCalendar,
  IconChevronLeft,
  IconPlug,
  IconSearch,
  IconSparkles,
  IconWrench,
  IconX,
  IconZap,
} from './Icons';

export interface BotTemplatesDialogProps {
  open: boolean;
  onClose: () => void;
}

interface TemplateEntry {
  id: string;
  category: string;
  name: string;
  line: string;
  firstChat?: string;
  mascot?: string;
  watches?: string;
  does?: string;
  reports?: string;
  connectors?: string[];
  schedules?: Array<{ id: string; when: string; what?: string }>;
  events?: Array<{ id: string; name: string; source?: string }>;
  skills?: string[];
  example?: string[];
}

export function BotTemplatesDialog({ open, onClose }: BotTemplatesDialogProps) {
  const { locale, tr } = useBotsLocale();
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(() => (BOT_TEMPLATES[0] as TemplateEntry | undefined)?.id ?? '');
  const [narrowDetail, setNarrowDetail] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose, open]);

  const filtered = useMemo<TemplateEntry[]>(
    () => (searchTemplates(query, category) as TemplateEntry[]).map(
      (entry) => (localizeTemplate(entry, locale) as TemplateEntry | null) ?? entry,
    ),
    [category, locale, query],
  );

  const selected = useMemo<TemplateEntry | null>(() => {
    const match = filtered.find((item) => item.id === selectedId);
    return match ?? filtered[0] ?? null;
  }, [filtered, selectedId]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const isNarrow = window.innerWidth < 740;
  const showList = !isNarrow || !narrowDetail;
  const showDetail = !isNarrow || narrowDetail;

  const categoryLabel = (cat: string) =>
    cat === 'all'
      ? tr('bots.templates.allCategories', 'All')
      : tr(`bots.templates.category.${cat}`, cat);

  const handleUseTemplate = (tpl: TemplateEntry) => {
    botsStore.openModal({ kind: 'new-bot', draft: { templateId: tpl.id } });
  };

  return createPortal(
    <div
      className="dsh-bots-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('bots.templates.title', 'Bot templates')}
        className="dsh-bots-modal dsh-bots-modal-templates"
      >
        <div className="dsh-bots-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconSparkles size={16} />
            <span className="dsh-bots-modal-title">
              {tr('bots.templates.title', 'Bot templates')}
            </span>
          </div>
          <button type="button" className="dsh-bots-icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--dsw-alias-border-l1)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div className="dsh-bots-search-box" style={{ margin: 0, width: 240, flexShrink: 0 }}>
            <IconSearch size={14} />
            <input
              type="text"
              className="dsh-bots-search-input"
              value={query}
              placeholder={tr('bots.templates.search', 'Search templates')}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="dsh-bots-icon-btn dsh-bots-icon-btn-sm" onClick={() => setQuery('')}>
                <IconX size={12} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['all', ...BOT_TEMPLATE_CATEGORIES].map((cat) => (
              <button
                key={cat}
                type="button"
                className="dsh-bots-btn"
                data-size="sm"
                data-variant={category === cat ? 'primary' : undefined}
                onClick={() => setCategory(cat)}
              >
                {categoryLabel(cat)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {showList && (
            <div
              style={{
                width: isNarrow ? '100%' : 360,
                borderRight: isNarrow ? 'none' : '1px solid var(--dsw-alias-border-l1)',
                overflowY: 'auto',
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {filtered.length === 0 ? (
                <div className="dsh-bots-empty" style={{ padding: 24 }}>
                  {tr('bots.search.noMatches', 'No matches')}
                </div>
              ) : (
                filtered.map((tpl) => {
                  const active = selected?.id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      className="dsh-bots-modal-row-btn"
                      data-active={active ? 'true' : 'false'}
                      style={{ alignItems: 'flex-start' }}
                      onClick={() => {
                        setSelectedId(tpl.id);
                        if (isNarrow) {
                          setNarrowDetail(true);
                        }
                      }}
                    >
                      <BotAvatar
                        avatar={tpl.mascot ? mascotAvatar(tpl.mascot) : undefined}
                        name={tpl.name}
                        size={38}
                        radius={10}
                      />
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ fontSize: 13, lineHeight: '20px', fontWeight: 600 }}>{tpl.name}</div>
                        <div
                          style={{
                            fontSize: 12,
                            lineHeight: '18px',
                            color: 'var(--dsw-alias-label-tertiary)',
                            marginTop: 2,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {tpl.line}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {showDetail && (
            <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isNarrow && (
                <button
                  type="button"
                  className="dsh-bots-btn"
                  data-variant="ghost"
                  data-size="sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setNarrowDetail(false)}
                >
                  <IconChevronLeft size={14} />
                  <span>{locale === 'zh-CN' ? '返回列表' : 'Back'}</span>
                </button>
              )}

              {selected ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <BotAvatar
                      avatar={selected.mascot ? mascotAvatar(selected.mascot) : undefined}
                      name={selected.name}
                      size={56}
                      radius={12}
                    />
                    <div>
                      <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>{selected.name}</div>
                      <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', marginTop: 2 }}>
                        {selected.line}
                      </div>
                    </div>
                  </div>

                  {selected.firstChat && (
                    <div className="dsh-bots-modal-card">
                      <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)' }}>
                        {tr('bots.templates.firstChat', 'What it does first')}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: '20px' }}>{selected.firstChat}</div>
                    </div>
                  )}

                  {(selected.example?.length ?? 0) > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)' }}>
                        {locale === 'zh-CN' ? '示例报告' : 'Example'}
                      </div>
                      <div className="dsh-bots-modal-card" style={{ gap: 6 }}>
                        {selected.example?.map((line, idx) => (
                          <div key={idx} style={{ fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }}>
                            {line}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)' }}>
                      {tr('bots.templates.comesWith', 'Comes with')}
                    </div>

                    {(selected.skills?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, lineHeight: '20px' }}>
                        <IconWrench size={14} style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                        <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                          {tr('settings.bots.skills.title', 'Skills')}:
                        </span>
                        {selected.skills?.map((skill) => (
                          <span key={skill} className="dsh-bots-badge">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}

                    {(selected.schedules?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: '20px' }}>
                        <IconCalendar size={14} style={{ color: 'var(--dsw-alias-label-tertiary)', marginTop: 3 }} />
                        <div>
                          <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                            {locale === 'zh-CN' ? '定时计划（默认关闭，可随时开启）' : 'Schedules (off by default)'}
                          </div>
                          {selected.schedules?.map((sched) => (
                            <div key={sched.id} style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }}>
                              {sched.when}{sched.what ? ` · ${sched.what}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(selected.events?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: '20px' }}>
                        <IconZap size={14} style={{ color: 'var(--dsw-alias-label-tertiary)', marginTop: 3 }} />
                        <div>
                          <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                            {locale === 'zh-CN' ? '事件触发（首次对话中配置）' : 'Event triggers (set up in first chat)'}
                          </div>
                          {selected.events?.map((ev) => (
                            <div key={ev.id} style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }}>
                              {ev.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(selected.connectors?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, lineHeight: '20px' }}>
                        <IconPlug size={14} style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                        <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                          {tr('bots.connectors.tab', 'Connectors')}:
                        </span>
                        {selected.connectors?.map((conn) => (
                          <span key={conn} className="dsh-bots-badge">
                            {BOT_CONNECTOR_NAMES[conn as keyof typeof BOT_CONNECTOR_NAMES] ?? conn}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="dsh-bots-modal-footer">
          <button
            type="button"
            className="dsh-bots-btn"
            data-variant="ghost"
            onClick={() => botsStore.openModal({ kind: 'new-bot' })}
          >
            {tr('bots.section.startFromScratch', 'Start from scratch')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dsh-bots-btn" onClick={onClose}>
              {tr('bots.new.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="dsh-bots-btn"
              data-variant="primary"
              disabled={!selected}
              onClick={() => selected && handleUseTemplate(selected)}
            >
              {tr('bots.templates.useTemplate', 'Use template…')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
