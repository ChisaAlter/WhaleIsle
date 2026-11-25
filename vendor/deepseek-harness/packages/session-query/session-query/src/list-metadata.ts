/** Session-list metadata projection definition registered by `SessionQueryEngine`. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { SessionListMetadata } from './types.ts'

const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
  presentation: z.object({
    owner: z.string().min(1).max(240),
    title: z.string().min(1).max(240),
    workingDirectory: z.string().min(1).max(32768).optional(),
    composer: z.literal('managed').optional(),
  }).optional(),
})

/** Advance blankness and human-prompt recency without retaining history. */
function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  if (event.type === 'session/presentation') {
    const { presentation: _previous, ...rest } = state
    return event.data === null ? rest : { ...rest, presentation: event.data }
  }
  const blank = state.blank && event.type !== 'turn/start'
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : state.presentation === undefined
      ? { blank, lastPromptAt }
      : { blank, lastPromptAt, presentation: state.presentation }
}

/** Blankness and latest human-prompt time folded per Session; persisted at state version 1. */
export const sessionListMetadataDefinition = {
  key: 'sessionListMetadata',
  stateSchema: sessionListMetadataSchema,
  init: () => ({ blank: true, lastPromptAt: null }),
  apply: applySessionListMetadata,
  wire: { viewSchema: sessionListMetadataSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'sessionListMetadata', SessionListMetadata>
