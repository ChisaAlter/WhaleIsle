import type { ContextFormed } from '@deepseek-ai/dsh-llm';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-bots:tidy-up': { kind: 'dsh-bots:tidy-up' };
    'dsh-whale:pulse': { kind: 'dsh-whale:pulse'; rpcId?: string } & ContextFormed;
    'dsh-whale:look': { kind: 'dsh-whale:look' } & Partial<ContextFormed>;
    'dsh-whale:pre-compaction-flush': { kind: 'dsh-whale:pre-compaction-flush'; subtype?: string } & ContextFormed;
    'dsh-whale:side-qa': { kind: 'dsh-whale:side-qa' };
    'dsh-whale:result': { kind: 'dsh-whale:result'; effectId?: string } & ContextFormed;
    'dsh-whale:desktop-task': { kind: 'dsh-whale:desktop-task'; rpcId?: string; eventId?: string } & ContextFormed;
    'dsh-im:inbound': { kind: 'dsh-im:inbound'; rpcId?: string; eventId?: string } & ContextFormed;
    'dsh-whale:todo-receipt': { kind: 'dsh-whale:todo-receipt'; cardId?: string; receiptId?: string } & ContextFormed;
    'dsh-whale:task': { kind: 'dsh-whale:task'; taskId?: string; generation?: number };
    'dsh-whale:relay': { kind: 'dsh-whale:relay'; form?: string };
  }
}
