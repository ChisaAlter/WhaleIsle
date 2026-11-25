/**
 * Host owner of the `authorization` Remote namespace: exposes registered
 * authorization flows, streaming interactive attempts (notices, prompts,
 * prompt withdrawal, settlement), prompt replies, and cancellation.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationEntry,
  AuthorizationNotice,
  AuthorizationPrompt,
  AuthorizationWirePrompt,
} from '@deepseek-ai/dsh-authorization/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { parseCredentialKeyOrBadRequest } from './key.ts'
import type { AuthorizationStreamEvent } from './types.ts'

interface PendingPrompt {
  readonly resolve: (answer: string) => void
  readonly reject: (error: unknown) => void
  readonly cleanup: () => void
}

/** Project one entry field-by-field so extra enumerable properties cannot leak across the wire. */
function projectAuthorizationEntry(entry: AuthorizationEntry): AuthorizationEntry {
  return {
    key: entry.key,
    label: entry.label,
    methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
    inFlight: entry.inFlight,
  }
}

/** Project one notice field-by-field for wire transport. */
function projectNotice(notice: AuthorizationNotice): AuthorizationNotice {
  return {
    message: notice.message,
    ...notice.url === undefined ? {} : { url: notice.url },
    ...notice.code === undefined ? {} : { code: notice.code },
  }
}

/** Strip non-serializable `signal` from a flow prompt and project declared fields only. */
function projectWirePrompt(prompt: AuthorizationPrompt): AuthorizationWirePrompt {
  switch (prompt.kind) {
    case 'text':
    case 'secret':
      return {
        kind: prompt.kind,
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    case 'select':
      return {
        kind: 'select',
        message: prompt.message,
        options: prompt.options.map(option => ({
          id: option.id,
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
      }
  }
}

function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code: unknown = Reflect.get(error, 'code')
    if (typeof code === 'string' && code.length > 0) return code
  }
  return 'INTERNAL'
}

class EventQueue<T> {
  private readonly items: T[] = []
  private waiter: (() => void) | undefined
  private ended = false

  push(item: T): void {
    if (this.ended) return
    this.items.push(item)
    this.waiter?.()
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.waiter?.()
  }

  async *drain(): AsyncIterable<T> {
    while (true) {
      while (this.items.length > 0) {
        const item = this.items.shift()
        if (item !== undefined) yield item
      }
      if (this.ended) return
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
      this.waiter = undefined
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 */
export class AuthorizationController extends TypertRemoteService {
  private readonly pendingPrompts = new Map<string, PendingPrompt>()

  /** @param ctx - Host context where `@deepseek-ai/dsh-authorization` may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
    ctx.effect(() => () => {
      for (const pending of [...this.pendingPrompts.values()]) {
        pending.cleanup()
        pending.reject(new Error('authorization controller disposed'))
      }
    }, 'authorizationController: pending prompts')
  }

  /**
   * List every registered authorization flow, or `[]` when `ctx.authorization` is absent.
   * @returns projected flow entries in registration order.
   */
  @Remote
  list(): AuthorizationEntry[] {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) return []
    return authorization.list().map(projectAuthorizationEntry)
  }

  /**
   * Describe one registered authorization flow by key.
   * @param key - credential key (`<scope>/<id>`) to inspect.
   * @returns the projected entry, or `null` when absent or `ctx.authorization` is unmounted.
   * @throws RemoteError when `key` is not a valid credential key.
   */
  @Remote
  describe(key: string): AuthorizationEntry | null {
    const branded = parseCredentialKeyOrBadRequest('authorization.describe', key)
    const entry = this.ctx.get('authorization')?.describe(branded)
    return entry === undefined ? null : projectAuthorizationEntry(entry)
  }

  /**
   * Start an interactive authorization attempt and stream notices, prompts,
   * prompt withdrawals, and the terminal settlement event.
   * @param key - credential key (`<scope>/<id>`) to authorize.
   * @param method - optional flow method id; defaults to the flow's preferred method.
   * @param signal - stream cancellation signal.
   * @returns stream of wire-safe authorization events.
   */
  @Remote({ mode: 'stream' })
  async *start(key: string, method: string | undefined, signal: AbortSignal): AsyncIterable<AuthorizationStreamEvent> {
    const branded = parseCredentialKeyOrBadRequest('authorization.start', key)
    if (method !== undefined && typeof method !== 'string') {
      throw new RemoteError('gateway/bad-request', 'invalid payload for authorization.start', {
        issues: [{ path: ['method'], message: 'authorization method must be a string or undefined' }],
      })
    }
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'authorization service is absent: mount @deepseek-ai/dsh-authorization in the profile composition',
        {},
      )
    }

    const queue = new EventQueue<AuthorizationStreamEvent>()
    let finished = false
    const streamPrompts = new Set<string>()

    const attempt = authorization.begin({
      key: branded,
      ...method === undefined ? {} : { method },
      signal,
      interaction: {
        notify: (notice) => {
          if (finished) return
          queue.push({ type: 'notice', notice: projectNotice(notice) })
        },
        prompt: prompt => new Promise<string>((resolve, reject) => {
          if (finished) {
            reject(new Error('authorization stream closed'))
            return
          }
          if (prompt.signal?.aborted === true) {
            reject(new Error('authorization prompt withdrawn'))
            return
          }
          const promptId = randomUUID()
          const onAbort = (): void => {
            if (!this.pendingPrompts.has(promptId)) return
            cleanup()
            queue.push({ type: 'prompt-withdrawn', promptId })
            reject(new Error('authorization prompt withdrawn'))
          }
          const cleanup = (): void => {
            this.pendingPrompts.delete(promptId)
            streamPrompts.delete(promptId)
            prompt.signal?.removeEventListener('abort', onAbort)
          }
          this.pendingPrompts.set(promptId, { resolve, reject, cleanup })
          streamPrompts.add(promptId)
          prompt.signal?.addEventListener('abort', onAbort, { once: true })
          queue.push({ type: 'prompt', promptId, prompt: projectWirePrompt(prompt) })
        }),
      },
    }).then(
      (outcome) => {
        finished = true
        queue.push({ type: 'done', status: outcome.status })
      },
      (error: unknown) => {
        finished = true
        queue.push({
          type: 'error',
          code: errorCodeOf(error),
          message: error instanceof Error ? error.message : String(error),
        })
      },
    ).finally(() => {
      queue.end()
    })

    try {
      yield* queue.drain()
    } finally {
      finished = true
      queue.end()
      for (const promptId of [...streamPrompts]) {
        const pending = this.pendingPrompts.get(promptId)
        if (pending === undefined) continue
        pending.cleanup()
        pending.reject(new Error('authorization stream closed'))
      }
      void attempt
    }
  }

  /**
   * Deliver a human's response (or `null` to decline) for an active prompt.
   * @param promptId - identifier emitted in an earlier `prompt` stream event.
   * @param answer - typed/selected answer, or `null` when the human declined.
   * @throws RemoteError `gateway/bad-request` when the payload or `promptId` is invalid/unknown.
   */
  @Remote
  respondPrompt(promptId: string, answer: string | null): void {
    if (typeof promptId !== 'string' || promptId.length === 0 || (answer !== null && typeof answer !== 'string')) {
      throw new RemoteError('gateway/bad-request', 'invalid payload for authorization.respondPrompt', {})
    }
    const pending = this.pendingPrompts.get(promptId)
    if (pending === undefined) {
      throw new RemoteError('gateway/bad-request', `unknown authorization prompt "${promptId}"`, {})
    }
    pending.cleanup()
    if (answer === null) {
      pending.reject(new AuthorizationDeclinedError())
    } else {
      pending.resolve(answer)
    }
  }

  /**
   * Cancel an in-flight authorization attempt for `key`, if any.
   * @param key - credential key (`<scope>/<id>`) whose attempt should stop.
   * @throws RemoteError when `key` is not a valid credential key.
   */
  @Remote
  cancel(key: string): void {
    const branded = parseCredentialKeyOrBadRequest('authorization.cancel', key)
    this.ctx.get('authorization')?.cancel(branded)
  }
}

export default AuthorizationController
