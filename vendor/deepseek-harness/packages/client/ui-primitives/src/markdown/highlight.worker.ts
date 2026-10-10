/**
 * Review-diff highlight Worker entry — bundled self-contained by tsdown (see
 * the `?raw` interception in `tsdown.config.ts`) and run from a Blob URL, so
 * the whole shiki engine plus its per-rule scanner builds execute off the
 * main thread. The scanner build for a rule set is a single indivisible
 * `tokenizeLine2` descent (~50-200 ms measured) that no main-thread slicing
 * can interrupt; this file is the boundary the review-diff D5 budget needs.
 *
 * Protocol (one shared Worker per page, FIFO, run-scoped so concurrent panels
 * never invalidate each other):
 * - `{op:'job', run, job, code, lang}` — tokenize one hunk side in one call
 *   (no per-task budget off the main thread) and reply `done` with per-line
 *   spans plus the worker-side milliseconds, or `missing` when the resolved
 *   grammar is not registered in this realm.
 * - `{op:'langs', registrations}` — register grammar data the main thread
 *   fetched from the lazy table, after which the reposted job tokenizes.
 * The client submits one job per run at a time. Cancellation stops subsequent
 * submissions and callbacks; a submitted synchronous tokenize cannot be interrupted.
 *
 * The engine module this imports must stay free of dynamic imports: a
 * self-contained bundle inlines every `import()` it can see, which would pull
 * all forty-plus lazy grammars into the Worker text.
 */

import {
  grammarForHint, grammarRegistered, registerGrammarModules, tokenizeLines,
  type HighlightSpan, type LangModule,
} from './highlight-engine.ts'

/** Messages the main thread posts in. */
type WorkerRequest =
  | { readonly op: 'job'; readonly run: number; readonly job: number; readonly code: string; readonly lang?: string }
  | { readonly op: 'langs'; readonly registrations: LangModule['default'] }

/** Messages posted back out; `ready` arrives once, at script evaluation end. */
type WorkerReply =
  | { readonly op: 'ready' }
  | { readonly op: 'done'; readonly run: number; readonly job: number; readonly spans: HighlightSpan[][] | undefined; readonly workMs: number }
  | { readonly op: 'missing'; readonly run: number; readonly job: number; readonly resolved: string }

const reply = (message: WorkerReply): void => { globalThis.postMessage(message) }

globalThis.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  switch (message.op) {
    case 'langs':
      registerGrammarModules(message.registrations)
      return
    case 'job': {
      const resolved = grammarForHint(message.lang)
      if (resolved !== undefined && !grammarRegistered(resolved)) {
        reply({ op: 'missing', run: message.run, job: message.job, resolved })
        return
      }
      const started = performance.now()
      const spans = tokenizeLines(message.code, message.lang)
      reply({ op: 'done', run: message.run, job: message.job, spans, workMs: performance.now() - started })
      return
    }
  }
}

reply({ op: 'ready' })
