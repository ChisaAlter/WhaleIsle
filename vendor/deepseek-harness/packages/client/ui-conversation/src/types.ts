/** Conversation plugin configuration shared by the Host and Client faces; types only. */
import type { Volatile } from '@deepseek-ai/cordis'
import type { ConversationSettings } from './submission-settings.ts'

/** Live preferences; the browser receives every field through its synced Config. */
export type ConversationConfig =
  & { [K in keyof ConversationSettings]: Volatile<ConversationSettings[K]> }
  & {
    /** Maximum generic-file uploads allowed to run concurrently in browser Workers. */
    maxConcurrentFileUploads: Volatile<number>
  }
