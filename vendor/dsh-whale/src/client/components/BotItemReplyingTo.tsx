// "Replying to: <summary>" capsule shown above the Item comment composer when the bot
// has an open question. Clicking jumps to and flashes the original question event;
// dismissing switches the composer to a plain comment (plain: true) without closing the question.

import { useBotsLocale } from '../store/bots-store';
import { IconMessageSquare, IconX } from './Icons';

export interface BotItemReplyingToProps {
  summary: string;
  onJumpToQuestion: () => void;
  onDismiss: () => void;
}

export function BotItemReplyingTo({
  summary,
  onJumpToQuestion,
  onDismiss,
}: BotItemReplyingToProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const trimmed = summary.trim() || (zh ? '机器人提问' : 'Bot question');

  return (
    <div className="dsh-bots-replying-to" role="region" aria-label={zh ? '正在回复提问' : 'Replying to question'}>
      <button
        type="button"
        className="dsh-bots-replying-to-main"
        title={zh ? '点击定位并高亮时间线中的原提问' : 'Jump to original question in timeline'}
        onClick={onJumpToQuestion}
      >
        <IconMessageSquare size={12} className="dsh-bots-replying-to-icon" />
        <span className="dsh-bots-replying-to-prefix">
          {zh ? '回复提问：' : 'Replying to: '}
        </span>
        <span className="dsh-bots-replying-to-text">{trimmed}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-replying-to-close"
        aria-label={zh ? '取消回复提问，改为发送普通评论' : 'Send as plain comment instead'}
        title={zh ? '关闭后将发送普通评论，不会结题' : 'Dismiss to send a plain comment without closing the question'}
        onClick={onDismiss}
      >
        <IconX size={12} />
      </button>
    </div>
  );
}
