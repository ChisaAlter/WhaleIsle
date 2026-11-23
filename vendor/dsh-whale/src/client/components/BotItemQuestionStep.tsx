// Multi-step Ask question stepper for Bot Work Items:
// single-step navigation ("< 2 / 4 >"), locally held answers collapsed above as editable pills,
// combined single-comment submission to wake the bot once, early "send anyway" action,
// Alt/Shift+Click to fill comment composer, inline star recommended marker, and key-repeat guard.

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { botItemQuestionLine } from '../../shared/bot-items.js';
import { useBotsLocale } from '../store/bots-store';
import { IconCheck, IconChevronLeft, IconChevronRight, IconSend } from './Icons';

export interface AskReplyOption {
  label: string;
  detail?: string;
  recommended?: boolean;
}

export interface AskDecisionItem {
  question: string;
  multi: boolean;
  replies: AskReplyOption[];
}

export interface AskQuestionShape {
  body: string;
  decisions: AskDecisionItem[];
}

export interface AskSubmitPayload {
  text: string;
  decisions: Array<{ picks: number[] }>;
}

export interface BotItemQuestionStepProps {
  /** Unique key per item + question event so step state resets on new questions. */
  questionKey: string;
  shape: AskQuestionShape;
  submitting?: boolean;
  compact?: boolean;
  /** Called when all decisions are answered or user clicks "send anyway". */
  onSubmit: (payload: AskSubmitPayload) => void | Promise<void>;
  /** Called on Alt+Click or Shift+Click of an option to populate comment box for editing. */
  onFillComment?: (text: string) => void;
}

function buildOptionSummary(decision: AskDecisionItem, picks: number[]): string {
  return picks
    .map((idx) => decision.replies[idx]?.label)
    .filter((label): label is string => Boolean(label))
    .join('、');
}

function buildCombinedPayload(
  shape: AskQuestionShape,
  heldPicks: Record<number, number[]>,
): AskSubmitPayload {
  const lines: string[] = [];
  const decisions: Array<{ picks: number[] }> = shape.decisions.map((dec, idx) => {
    const picks = heldPicks[idx] ?? [];
    const summary = buildOptionSummary(dec, picks);
    if (summary) {
      lines.push(
        shape.decisions.length > 1
          ? `${botItemQuestionLine(dec.question)} → ${summary}`
          : summary,
      );
    }
    return { picks };
  });
  return {
    text: lines.join('\n').trim(),
    decisions,
  };
}

export function BotItemQuestionStep({
  questionKey,
  shape,
  submitting = false,
  compact = false,
  onSubmit,
  onFillComment,
}: BotItemQuestionStepProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const total = shape.decisions.length;

  const [step, setStep] = useState(0);
  const [heldPicks, setHeldPicks] = useState<Record<number, number[]>>({});

  // Reset stepper state whenever item or question event changes.
  useEffect(() => {
    setStep(0);
    setHeldPicks({});
  }, [questionKey]);

  const safeStep = Math.min(Math.max(step, 0), Math.max(0, total - 1));
  const currentDecision = shape.decisions[safeStep];

  const answeredIndices = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i < total; i += 1) {
      if ((heldPicks[i]?.length ?? 0) > 0) {
        list.push(i);
      }
    }
    return list;
  }, [heldPicks, total]);

  const heldOtherIndices = useMemo(
    () => answeredIndices.filter((idx) => idx !== safeStep),
    [answeredIndices, safeStep],
  );

  const allAnswered = total > 0 && answeredIndices.length === total;
  const currentPicks = heldPicks[safeStep] ?? [];

  const guardKeyRepeat = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat) {
      e.preventDefault();
    }
  };

  const findNextUnanswered = (nextHeld: Record<number, number[]>, fromIndex: number): number | null => {
    for (let offset = 1; offset <= total; offset += 1) {
      const candidate = (fromIndex + offset) % total;
      if ((nextHeld[candidate]?.length ?? 0) === 0) {
        return candidate;
      }
    }
    return null;
  };

  const handleSubmitHeld = (picksMap: Record<number, number[]>) => {
    if (submitting) {
      return;
    }
    const payload = buildCombinedPayload(shape, picksMap);
    if (!payload.text) {
      return;
    }
    void onSubmit(payload);
  };

  const handleOptionClick = (
    event: MouseEvent<HTMLButtonElement>,
    optIdx: number,
  ) => {
    if (!currentDecision || submitting) {
      return;
    }
    const opt = currentDecision.replies[optIdx];
    if (!opt) {
      return;
    }

    // Alt+Click or Shift+Click fills the comment box for manual editing instead of immediate submit.
    if ((event.altKey || event.shiftKey) && onFillComment) {
      event.preventDefault();
      const fillText = total > 1
        ? `${botItemQuestionLine(currentDecision.question)} → ${opt.label}`
        : opt.label;
      onFillComment(fillText);
      return;
    }

    if (currentDecision.multi) {
      setHeldPicks((prev) => {
        const cur = prev[safeStep] ?? [];
        const next = cur.includes(optIdx)
          ? cur.filter((x) => x !== optIdx)
          : [...cur, optIdx].sort((a, b) => a - b);
        return { ...prev, [safeStep]: next };
      });
      return;
    }

    const nextHeld: Record<number, number[]> = { ...heldPicks, [safeStep]: [optIdx] };
    setHeldPicks(nextHeld);

    const nextUnanswered = findNextUnanswered(nextHeld, safeStep);
    if (nextUnanswered !== null) {
      setStep(nextUnanswered);
    } else {
      // Last question answered: combine into a single comment to wake the bot once.
      handleSubmitHeld(nextHeld);
    }
  };

  const handleMultiConfirm = () => {
    if (!currentDecision || currentPicks.length === 0 || submitting) {
      return;
    }
    const nextUnanswered = findNextUnanswered(heldPicks, safeStep);
    if (nextUnanswered !== null) {
      setStep(nextUnanswered);
    } else {
      handleSubmitHeld(heldPicks);
    }
  };

  if (!currentDecision) {
    return null;
  }

  return (
    <div
      className={`dsh-bots-qstep ${compact ? 'dsh-bots-qstep-compact' : ''}`.trim()}
      data-submitting={submitting ? 'true' : 'false'}
    >
      {shape.body && (
        <div className="dsh-bots-qstep-body">{shape.body}</div>
      )}

      {heldOtherIndices.length > 0 && (
        <div className="dsh-bots-qstep-held-list" role="list" aria-label={zh ? '已暂存的回答' : 'Held answers'}>
          {heldOtherIndices.map((qIdx) => {
            const dec = shape.decisions[qIdx];
            const summary = buildOptionSummary(dec, heldPicks[qIdx] ?? []);
            return (
              <button
                key={`held-${qIdx}`}
                type="button"
                role="listitem"
                className="dsh-bots-qstep-held-pill"
                disabled={submitting}
                title={zh ? '点击返回修改此题回答' : 'Click to edit this answer'}
                onKeyDown={guardKeyRepeat}
                onClick={() => setStep(qIdx)}
              >
                <span className="dsh-bots-qstep-held-q">{botItemQuestionLine(dec.question)}</span>
                <span className="dsh-bots-qstep-held-arrow" aria-hidden="true">→</span>
                <span className="dsh-bots-qstep-held-a">{summary}</span>
                <span className="dsh-bots-qstep-held-tag">
                  · {zh ? '尚未发送' : 'not sent yet'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="dsh-bots-qstep-head">
        <div className="dsh-bots-qstep-question">
          <span>{currentDecision.question}</span>
          {currentDecision.multi && (
            <span className="dsh-bots-badge" style={{ marginLeft: 6 }}>
              {zh ? '可多选' : 'Multi'}
            </span>
          )}
        </div>
        {total > 1 && (
          <div className="dsh-bots-qstep-nav" aria-label={zh ? '问题步进' : 'Question stepper'}>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
              disabled={safeStep <= 0 || submitting}
              aria-label={zh ? '上一题' : 'Previous question'}
              onKeyDown={guardKeyRepeat}
              onClick={() => setStep((prev) => Math.max(0, prev - 1))}
            >
              <IconChevronLeft size={12} />
            </button>
            <span className="dsh-bots-qstep-counter">
              {safeStep + 1} / {total}
            </span>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
              disabled={safeStep >= total - 1 || submitting}
              aria-label={zh ? '下一题' : 'Next question'}
              onKeyDown={guardKeyRepeat}
              onClick={() => setStep((prev) => Math.min(total - 1, prev + 1))}
            >
              <IconChevronRight size={12} />
            </button>
          </div>
        )}
      </div>

      {currentDecision.replies.length > 0 ? (
        <div className="dsh-bots-qstep-options" role="group" aria-label={currentDecision.question}>
          {currentDecision.replies.map((opt, optIdx) => {
            const selected = currentPicks.includes(optIdx);
            return (
              <button
                key={`${safeStep}-${opt.label}`}
                type="button"
                className="dsh-bots-ask-option dsh-bots-qstep-option"
                data-selected={selected ? 'true' : 'false'}
                disabled={submitting}
                title={onFillComment
                  ? (zh ? '点击选择；按住 Alt 或 Shift 点击可填入评论框继续编辑' : 'Click to select; Alt/Shift+Click to fill comment box')
                  : undefined}
                onKeyDown={guardKeyRepeat}
                onClick={(e) => handleOptionClick(e, optIdx)}
              >
                <span className="dsh-bots-qstep-marker" data-multi={currentDecision.multi ? 'true' : 'false'} data-selected={selected ? 'true' : 'false'}>
                  {selected && <IconCheck size={10} />}
                </span>
                <span className="dsh-bots-qstep-opt-content">
                  <span className="dsh-bots-qstep-opt-label">
                    {opt.label}
                    {opt.recommended && (
                      <>
                        <span className="dsh-bots-ask-star" aria-hidden="true"> ★</span>
                        <span className="dsh-bots-sr-only">
                          {zh ? '（推荐选项）' : ' (Recommended)'}
                        </span>
                      </>
                    )}
                  </span>
                  {opt.detail && (
                    <span className="dsh-bots-qstep-opt-detail">{opt.detail}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="dsh-bots-muted">
          {zh ? '本题无预设选项，请直接在下方评论框输入你的回复。' : 'No preset choices — type your reply below.'}
        </div>
      )}

      <div className="dsh-bots-qstep-footer">
        {currentDecision.multi && (
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
            disabled={currentPicks.length === 0 || submitting}
            onKeyDown={guardKeyRepeat}
            onClick={handleMultiConfirm}
          >
            <IconSend size={11} />
            <span>
              {findNextUnanswered(heldPicks, safeStep) !== null
                ? (zh ? '暂存并继续下一题' : 'Hold & next')
                : (zh ? '提交全部回答' : 'Submit answers')}
            </span>
          </button>
        )}

        {answeredIndices.length > 0 && !allAnswered && (
          <button
            type="button"
            className="dsh-bots-qstep-send-early"
            disabled={submitting}
            onKeyDown={guardKeyRepeat}
            onClick={() => handleSubmitHeld(heldPicks)}
          >
            {zh
              ? `已有 ${answeredIndices.length} 项回答未发送，立即发送`
              : `${answeredIndices.length} answer${answeredIndices.length > 1 ? 's' : ''} not sent yet — send anyway`}
          </button>
        )}

        {onFillComment && currentDecision.replies.length > 0 && !compact && (
          <span className="dsh-bots-qstep-hint">
            {zh ? 'Alt / Shift + 点击选项可填入评论框再编辑' : 'Alt/Shift+Click to edit in comment box'}
          </span>
        )}
      </div>
    </div>
  );
}
