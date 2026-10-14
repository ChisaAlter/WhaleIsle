/** Browser-safe values for the next-message suggestion request. */
import { z } from 'zod'

/** Endpoint on the existing authenticated Connection API channel. */
export const NEXT_PROMPT_ENDPOINT = 'conversation.next-prompt'

/** Latest completed turn and its optional next-message suggestion. */
export interface NextPromptResult {
  readonly turn: number | null
  readonly seq: number | null
  readonly text: string | null
}

/** Validate the completed-turn identity and suggestion returned over the wire. */
export const nextPromptResultSchema: z.ZodType<NextPromptResult> = z.object({
  turn: z.number().int().nonnegative().nullable(),
  seq: z.number().int().nonnegative().nullable(),
  text: z.string().min(1).max(160).nullable(),
}).strict().refine(value => (value.turn === null) === (value.seq === null)
  && (value.seq !== null || value.text === null))
