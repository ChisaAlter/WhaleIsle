/** Additive host-managed Team events shared by runtime and projection. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TeamId, TeamTaskId, TeamMessageId } from './types.ts'

/** Additive events leave existing member, task and message generations unchanged. */
export type TeamControl =
  | { kind: 'retry-member'; memberId: SessionId }
  | { kind: 'policy'; policy: string }
  | { kind: 'cold'; memberId: SessionId; taskId: TeamTaskId; cold: boolean }
  | { kind: 'cancel'; messageId: TeamMessageId }
  | { kind: 'message-context'; messageId: TeamMessageId; senderAssignment: string; targetAssignment: string }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Host management facts; never a replacement for roster/task/mailbox records. */
    'team/control': { version: 1; teamId: TeamId; control: TeamControl }
  }
}


/** Strict decoder for the additive host control vocabulary. */
export const teamControlEventSchema = z.object({
  version: z.literal(1), teamId: z.string().min(1).transform(TeamId),
  control: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('policy'), policy: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('retry-member'), memberId: z.string().min(1).transform(value => brandString<SessionId>(value)) }).strict(),
    z.object({ kind: z.literal('cold'), memberId: z.string().min(1).transform(value => brandString<SessionId>(value)), taskId: z.string().min(1).transform(TeamTaskId), cold: z.boolean() }).strict(),
    z.object({ kind: z.literal('cancel'), messageId: z.string().min(1).transform(TeamMessageId) }).strict(),
    z.object({ kind: z.literal('message-context'), messageId: z.string().min(1).transform(TeamMessageId), senderAssignment: z.string().min(1), targetAssignment: z.string().min(1) }).strict(),
  ]),
}).strict()
