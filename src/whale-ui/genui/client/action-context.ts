import { createContext, useContext } from 'react'

/** Acknowledgements describe the host outcome, never merely the click. */
export type GenuiActionAck =
  | { status: 'queued' | 'completed'; message?: string }
  | { status: 'failed' | 'cancelled'; message: string }
export type GenuiActionHandler = (action: string, payload: Record<string, unknown>) => Promise<GenuiActionAck>
export const GenuiActionContext = createContext<GenuiActionHandler | undefined>(undefined)
export function useGenuiAction(): GenuiActionHandler | undefined { return useContext(GenuiActionContext) }

/** Normalize thrown bridge errors while preserving explicit rejection results. */
export async function invokeGenuiAction(handler: GenuiActionHandler, action: string, payload: Record<string, unknown>): Promise<GenuiActionAck> {
  try {
    const ack = await handler(action, payload)
    if (ack?.status === 'queued' || ack?.status === 'completed' || ack?.status === 'failed' || ack?.status === 'cancelled') return ack
    return { status: 'failed', message: 'The host did not acknowledge the action.' }
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
