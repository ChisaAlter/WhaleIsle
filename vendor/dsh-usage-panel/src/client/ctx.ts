// dsh-usage-panel · structural types for the browser-side context.
// The runtime shapes are exactly what v0.1.0 already exercised; types are
// local so the client bundle stays independent of host-side type packages.
import type { ReactNode } from 'react'

export interface SlotsLike {
  inject(slot: string, register: () => () => void): void
  register(options: SlotRegisterOptions, render: (props?: unknown) => ReactNode): () => void
}

export interface SlotRegisterOptions {
  name: string
  id: string
  order: number
  label?: string | (() => string)
  /** Locale namespace bound to the entry's `t` (list-slot entries). */
  locale?: string
  /** Child slots this entry declares and renders. */
  children?: Record<string, { kind: 'list'; scope: 'root' }>
}

/** The render share the host passes to an entry that declares children. */
export interface ChildRenderProps {
  renderSlot?: (key: string, props: object) => ReactNode
}

export interface RpcResultLike<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details: Record<string, unknown> }
}

export interface RpcLike {
  call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>>
}

export interface ClientCtx {
  slots: SlotsLike
  connection: { rpc: RpcLike }
  locale?: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string, params?: Record<string, unknown>) => string
    getSnapshot(): { active: string }
    subscribe?(fn: () => void): () => void
  }
  /** Cordis Context is the event emitter itself: ctx.on('locale/change', …). */
  on?(event: string, cb: (snapshot: unknown) => void): () => void
  effect(fn: () => (() => void) | void): void
}
