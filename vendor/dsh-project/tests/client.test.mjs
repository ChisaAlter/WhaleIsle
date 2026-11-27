import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(__dirname, '../client/client.js')
const clientSource = fs.readFileSync(clientPath, 'utf8')

const harnessRoot = path.resolve(__dirname, '../../deepseek-harness')
const clientRequire = createRequire(path.join(harnessRoot, 'packages/client/ui-conversation/package.json'))
const vendorRequire = createRequire(path.join(harnessRoot, 'package.json'))
const React = clientRequire('react')
const { JSDOM } = vendorRequire('jsdom')
const { act, createElement: h } = React
let createRoot = null

function makeBench(options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost:3000',
    pretendToBeVisual: true,
  })
  const saved = Object.fromEntries(
    ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'EventSource', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  )

  const storage = new Map(Object.entries(options.localStorage || {}))
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)) },
      removeItem: (k) => { storage.delete(k) },
    },
  })

  const copiedTexts = []
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { copiedTexts.push(text) } },
  })

  const resizeObservers = []
  let currentContainerWidth = options.containerWidth ?? 1200
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb
      this.elements = []
      this.disconnected = false
      resizeObservers.push(this)
    }
    observe(el) {
      this.elements.push(el)
      el.getBoundingClientRect = () => ({ width: currentContainerWidth, height: 800, left: 0, top: 0, right: currentContainerWidth, bottom: 800 })
      this.cb([{ target: el, contentRect: { width: currentContainerWidth, height: 800 } }])
    }
    disconnect() { this.disconnected = true }
    trigger(width) {
      currentContainerWidth = width
      for (const el of this.elements) {
        el.getBoundingClientRect = () => ({ width, height: 800, left: 0, top: 0, right: width, bottom: 800 })
      }
      this.cb([{ target: this.elements[0], contentRect: { width, height: 800 } }])
    }
  }

  const eventSources = []
  class FakeEventSource {
    constructor(url, init) {
      this.url = url
      this.init = init
      this.listeners = new Map()
      this.closed = false
      this.onerror = null
      eventSources.push(this)
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    }
    emit(type, data) {
      const set = this.listeners.get(type)
      if (!set) return
      for (const fn of [...set]) fn({ type, data: typeof data === 'string' ? data : JSON.stringify(data) })
    }
    fail() {
      if (typeof this.onerror === 'function') this.onerror(new Error('sse_error'))
    }
    close() { this.closed = true }
  }

  const projectsState = structuredClone(
    options.projects || [
      {
        id: 'p-11111111',
        name: 'Alpha Project',
        goal: 'Build v2 cleanly.',
        workspace: '/repo/alpha',
        autonomy: 'manual',
        concurrency: 3,
        paused: false,
        archived: false,
        worktreeIsolation: true,
        autoCompact: true,
        memoryBudget: 64000,
        model: 'deepseek/deepseek-reasoner',
        reasoningEffort: 'high',
        coordinatorSessionId: options.coordinatorSessionId ?? '',
        updatedAt: Date.now(),
        tasks: [
          {
            id: 't-run11111',
            title: 'Implement SSE backend',
            brief: 'Stream /projects-api/events',
            status: 'running',
            approved: true,
            childSessionId: 'sess-worker-1',
            childName: 'worker-sse',
            branch: 'project/t-run11111',
            worktreePath: '/tmp/wt/t-run11111',
            output: '',
            updatedAt: Date.now() - 1000,
          },
          {
            id: 't-rev22222',
            title: 'Audit diff endpoint',
            brief: 'Verify git diff parsing',
            status: 'review',
            approved: true,
            childSessionId: 'sess-worker-2',
            childName: 'worker-diff',
            output: 'All diff endpoints pass tests.',
            updatedAt: Date.now() - 2000,
          },
          {
            id: 't-fail3333',
            title: 'Fix flaky parser',
            brief: 'Check UTF-8 edges',
            status: 'failed',
            approved: true,
            output: 'Exit code 1',
            updatedAt: Date.now() - 3000,
          },
          {
            id: 't-que44444',
            title: 'Write docs',
            brief: 'Update handbook',
            status: 'queued',
            approved: false,
            output: '',
            updatedAt: Date.now() - 4000,
          },
          {
            id: 't-res55555',
            title: 'Bootstrap repo',
            brief: 'Initial scaffold',
            status: 'resolved',
            approved: true,
            output: 'Scaffold ready.',
            updatedAt: Date.now() - 5000,
          },
        ],
      },
      {
        id: 'p-22222222',
        name: 'Archived Legacy',
        goal: 'Old goal',
        workspace: '/repo/old',
        autonomy: 'auto',
        concurrency: 2,
        paused: false,
        archived: true,
        worktreeIsolation: false,
        autoCompact: true,
        memoryBudget: 64000,
        updatedAt: Date.now() - 10000,
        tasks: [],
      },
    ],
  )

  const memoryStore = structuredClone(
    options.memoryStore || {
      'p-11111111': {
        'architecture': {
          name: 'architecture',
          description: 'Core design notes',
          type: 'reference',
          modified: '2026-11-21T10:00:00.000Z',
          text: 'Use SSE and container-aware ResizeObserver.',
          stale: false,
        },
      },
    },
  )

  const diffStore = structuredClone(
    options.diffStore || {
      't-run11111': {
        available: true,
        branch: 'project/t-run11111',
        worktreePath: '/tmp/wt/t-run11111',
        baseRef: 'main',
        files: [{ path: 'lib/http.js', status: 'modified', additions: 12, deletions: 3 }],
        diff: '@@ -1,3 +1,5 @@\n-old\n+new\n context',
        truncated: false,
      },
    },
  )

  const apiCalls = []
  const intervals = []

  const summarizeProject = (p) => {
    const counts = { queued: 0, running: 0, review: 0, failed: 0, blocked: 0, resolved: 0 }
    for (const tk of p.tasks || []) counts[tk.status] = (counts[tk.status] || 0) + 1
    return {
      id: p.id,
      name: p.name,
      workspace: p.workspace,
      autonomy: p.autonomy,
      concurrency: p.concurrency,
      paused: p.paused,
      archived: p.archived,
      worktreeIsolation: p.worktreeIsolation,
      autoCompact: p.autoCompact,
      memoryBudget: p.memoryBudget,
      updatedAt: p.updatedAt,
      counts,
    }
  }

  const memoryPayloadFor = (pid) => {
    const map = memoryStore[pid] || {}
    const files = Object.values(map).map((f) => ({
      name: f.name,
      description: f.description,
      type: f.type,
      modified: f.modified,
      size: f.text.length,
      stale: Boolean(f.stale),
    }))
    const total = files.reduce((s, f) => s + f.size, 0)
    const proj = projectsState.find((p) => p.id === pid)
    return {
      files,
      indexFile: files.length
        ? { name: 'MEMORY.md', description: 'Generated index', type: 'index', modified: '2026-11-21T10:00:00.000Z', size: 120, readOnly: true, isIndex: true }
        : null,
      total,
      budget: (proj && proj.memoryBudget) || 64000,
    }
  }

  const fakeFetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const parsedUrl = new URL(url, 'http://localhost:3000')
    const pathname = parsedUrl.pathname.replace(/^\/projects-api/, '') || '/'
    const body = init.body ? JSON.parse(init.body) : undefined
    apiCalls.push({ method, pathname, search: parsedUrl.search, headers: init.headers || {}, body })

    if (options.onApi) {
      const custom = await options.onApi({ method, pathname, search: parsedUrl.search, headers: init.headers || {}, body })
      if (custom) {
        return { ok: custom.status >= 200 && custom.status < 300, status: custom.status, json: async () => custom.body }
      }
    }

    const ok = (payload, status = 200) => ({ ok: true, status, json: async () => payload })
    const err = (status, message) => ({ ok: false, status, json: async () => ({ error: message }) })

    if (method === 'GET' && pathname === '/models') {
      if (options.modelsCatalog) return ok(options.modelsCatalog)
      return ok({
        models: [
          {
            id: 'deepseek/deepseek-reasoner',
            provider: 'deepseek',
            model: 'deepseek-reasoner',
            label: 'DeepSeek Reasoner',
            efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
          },
        ],
        enumerable: true,
        presets: [],
        presetsEnumerable: false,
      })
    }
    if (method === 'POST' && pathname === '/open-path') return ok({ ok: true })
    if (method === 'POST' && pathname === '/sessions/restore') return ok({ restored: true })
    if (method === 'GET' && pathname === '/projects') {
      return ok({ projects: projectsState.map(summarizeProject) })
    }
    if (method === 'POST' && pathname === '/projects') {
      const created = {
        id: `p-new${projectsState.length + 1}`,
        name: body.name,
        goal: body.goal || '',
        workspace: body.workspace || '',
        autonomy: body.autonomy || 'manual',
        concurrency: body.concurrency || 3,
        paused: false,
        archived: false,
        worktreeIsolation: Boolean(body.worktreeIsolation),
        autoCompact: true,
        memoryBudget: 64000,
        updatedAt: Date.now(),
        tasks: [],
      }
      projectsState.unshift(created)
      return ok({ project: summarizeProject(created) }, 201)
    }

    const projMatch = /^\/projects\/([^/]+)$/.exec(pathname)
    if (projMatch) {
      const projIdx = projectsState.findIndex((p) => p.id === projMatch[1])
      if (projIdx < 0) return err(404, 'project_not_found')
      const proj = projectsState[projIdx]
      if (method === 'GET') return ok({ project: structuredClone(proj), memory: memoryPayloadFor(proj.id) })
      if (method === 'PATCH') {
        Object.assign(proj, body, { updatedAt: Date.now() })
        return ok({ project: structuredClone(proj) })
      }
      if (method === 'DELETE') {
        const archive = parsedUrl.searchParams.get('archiveSessions') === '1' || body?.archiveSessions === true
        projectsState.splice(projIdx, 1)
        const archived = archive && proj.coordinatorSessionId ? [proj.coordinatorSessionId] : []
        return ok({ deleted: true, projectId: proj.id, stoppedTasks: [], archivedSessions: archived, worktrees: { removed: [], failed: [] } })
      }
    }

    const ensureCoordMatch = /^\/projects\/([^/]+)\/coordinator\/ensure$/.exec(pathname)
    if (ensureCoordMatch && method === 'POST') {
      const proj = projectsState.find((p) => p.id === ensureCoordMatch[1])
      if (!proj) return err(404, 'project_not_found')
      if (proj.archived && !proj.coordinatorSessionId) return err(409, 'project_archived')
      let created = false
      if (!proj.coordinatorSessionId) {
        const sid = `sess-coord-${createdSessions.length + 1}`
        createdSessions.push({ sid, opts: { cwd: proj.workspace || undefined, presentation: { owner: 'dsh-project', title: proj.name } } })
        proj.coordinatorSessionId = sid
        created = true
      }
      const archived = Array.isArray(options.archivedSessionIds) && options.archivedSessionIds.includes(proj.coordinatorSessionId)
      return ok({
        project: structuredClone(proj),
        coordinatorSessionId: proj.coordinatorSessionId,
        created,
        archived: body?.restore ? false : archived,
      })
    }

    const memPostMatch = /^\/projects\/([^/]+)\/memory$/.exec(pathname)
    if (memPostMatch && method === 'POST') {
      const pid = memPostMatch[1]
      if (!memoryStore[pid]) memoryStore[pid] = {}
      memoryStore[pid][body.name] = {
        name: body.name,
        description: body.description || '',
        type: body.type || 'reference',
        modified: new Date().toISOString(),
        text: body.text,
        stale: false,
      }
      return ok({ saved: true, name: body.name, size: body.text.length })
    }

    const memItemMatch = /^\/projects\/([^/]+)\/memory\/([^/]+)$/.exec(pathname)
    if (memItemMatch) {
      const pid = memItemMatch[1]
      const name = decodeURIComponent(memItemMatch[2])
      if (method === 'GET') {
        if (name === 'MEMORY.md') {
          return ok({ name: 'MEMORY.md', description: 'Generated index', type: 'index', modified: '2026-11-21T10:00:00.000Z', size: 120, text: '# Shared memory index\n· architecture', readOnly: true, isIndex: true, archived: false })
        }
        const item = memoryStore[pid] && memoryStore[pid][name]
        if (!item) return err(404, 'memory_file_not_found')
        return ok({ ...item, size: item.text.length, archived: false })
      }
      if (method === 'DELETE') {
        if (memoryStore[pid]) delete memoryStore[pid][name]
        return ok({ deleted: true, name })
      }
    }

    const taskApprove = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/approve$/.exec(pathname)
    if (taskApprove && method === 'POST') {
      const proj = projectsState.find((p) => p.id === taskApprove[1])
      const task = proj && proj.tasks.find((tk) => tk.id === taskApprove[2])
      if (!task) return err(404, 'task_not_found')
      task.approved = true
      return ok({ task: structuredClone(task) })
    }

    const taskStop = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/stop$/.exec(pathname)
    if (taskStop && method === 'POST') {
      const proj = projectsState.find((p) => p.id === taskStop[1])
      const task = proj && proj.tasks.find((tk) => tk.id === taskStop[2])
      if (!task) return err(404, 'task_not_found')
      task.status = 'blocked'
      task.stopReason = 'stopped_by_user'
      return ok({ stopped: true, task: structuredClone(task) })
    }

    const taskRetry = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/retry$/.exec(pathname)
    if (taskRetry && method === 'POST') {
      const proj = projectsState.find((p) => p.id === taskRetry[1])
      const task = proj && proj.tasks.find((tk) => tk.id === taskRetry[2])
      if (!task) return err(404, 'task_not_found')
      task.status = 'queued'
      delete task.stopReason
      return ok({ retried: true, dispatched: Boolean(options.retryDispatches), task: structuredClone(task) })
    }

    const taskDiff = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/diff$/.exec(pathname)
    if (taskDiff && method === 'GET') {
      return ok(diffStore[taskDiff[2]] || { available: true, files: [], diff: '', truncated: false })
    }

    const taskMerge = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/worktree\/merge$/.exec(pathname)
    if (taskMerge && method === 'POST') {
      return ok({ merged: true })
    }

    const taskWtDel = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/worktree$/.exec(pathname)
    if (taskWtDel && method === 'DELETE') {
      const proj = projectsState.find((p) => p.id === taskWtDel[1])
      const task = proj && proj.tasks.find((tk) => tk.id === taskWtDel[2])
      if (task) { delete task.branch; delete task.worktreePath }
      return ok({ cleaned: true })
    }

    const taskSingle = /^\/projects\/([^/]+)\/tasks\/([^/]+)$/.exec(pathname)
    if (taskSingle) {
      const proj = projectsState.find((p) => p.id === taskSingle[1])
      const idx = proj ? proj.tasks.findIndex((tk) => tk.id === taskSingle[2]) : -1
      if (idx < 0) return err(404, 'task_not_found')
      if (method === 'PATCH') {
        proj.tasks[idx].status = body.status
        return ok({ task: structuredClone(proj.tasks[idx]) })
      }
      if (method === 'DELETE') {
        const archive = parsedUrl.searchParams.get('session') === 'archive'
        const target = proj.tasks[idx]
        if (archive && target.status === 'running') {
          return err(409, 'refusing to archive: the worker is still running')
        }
        proj.tasks.splice(idx, 1)
        return ok({ deleted: true, session: archive && target.childSessionId ? { id: target.childSessionId, archived: true } : null })
      }
    }

    return err(404, `unhandled:${method}:${pathname}`)
  }

  for (const [k, v] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: FakeResizeObserver,
    EventSource: FakeEventSource,
    fetch: fakeFetch,
  })) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v })
  }
  if (!createRoot) {
    createRoot = clientRequire('react-dom/client').createRoot
  }

  let loadedModule = null
  dom.window.__ModuleLoader__ = { load: (mod) => { loadedModule = mod } }

  const sandbox = {
    window: dom.window,
    document: dom.window.document,
    globalThis,
    console,
    URL,
    EventSource: FakeEventSource,
    ResizeObserver: FakeResizeObserver,
    fetch: fakeFetch,
    setTimeout,
    clearTimeout,
    setInterval: (fn, ms) => { intervals.push(ms); return setInterval(fn, ms) },
    clearInterval,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: clientPath })

  const Button = React.forwardRef(function MockButton({ variant, size, shape, icon, loading, feedback, children, ...rest }, ref) {
    return h('button', { type: 'button', ref, ...rest, disabled: rest.disabled || loading }, icon, children)
  })
  const Input = React.forwardRef(function MockInput({ variant, icon, ...rest }, ref) {
    return h('input', { ref, ...rest })
  })
  const Modal = ({ open, onClose, title, description, closeLabel, children, footer, headless }) =>
    !open
      ? null
      : h(
          'div',
          { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          headless
            ? children
            : h(
                React.Fragment,
                null,
                h('h2', null, title),
                description && h('p', null, description),
                closeLabel && h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
                children,
                footer,
              ),
        )
  const Pill = ({ active, onClick, children, ...rest }) =>
    onClick ? h('button', { type: 'button', 'aria-pressed': active ? 'true' : 'false', onClick, ...rest }, children) : h('span', rest, children)
  const SegmentedTabs = ({ items, value, onChange, label }) =>
    h(
      'div',
      { role: 'tablist', 'aria-label': label },
      items.map((item) =>
        h('button', {
          key: item.value,
          id: item.id,
          type: 'button',
          role: 'tab',
          'aria-selected': value === item.value ? 'true' : 'false',
          'aria-controls': item.panelId,
          onClick: () => onChange(item.value),
        }, item.label),
      ),
    )
  const SegmentedControl = ({ id, options: opts, value, onChange, label, disabled }) =>
    h(
      'div',
      { role: 'tablist', 'aria-label': label },
      (opts || []).map((opt) =>
        h('button', {
          key: opt.value,
          id: `${id}-${opt.value}`,
          type: 'button',
          role: 'tab',
          'aria-selected': value === opt.value ? 'true' : 'false',
          disabled: disabled || opt.disabled,
          onClick: () => onChange(opt.value),
        }, opt.label),
      ),
    )
  const Switch = ({ checked, onChange, label, disabled }) =>
    h('button', { type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label, disabled, onClick: () => onChange(!checked) })
  const StateDot = ({ state }) => h('span', { 'data-state-dot': state })
  const Tag = ({ tone, children }) => h('span', { 'data-tag-tone': tone }, children)
  const Tooltip = ({ label, children }) => children
  const Toast = ({ text, holdMs }) => h('div', { role: 'alert', 'data-toast': 'true', 'data-hold-ms': String(holdMs) }, text)

  const mockPrimitives = { Button, Input, Modal, Pill, SegmentedTabs, SegmentedControl, Switch, StateDot, Tag, Tooltip, Toast }

  const plugin = loadedModule.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return mockPrimitives
    throw new Error(`Unexpected require: ${id}`)
  })

  const slotInjections = []
  const registeredSlots = new Map()
  const registeredLocales = new Map()
  const createdSessions = []
  const retainedSessions = []
  const releasedSessions = []
  const promptCalls = []
  const unarchivedSessions = []

  const ctx = {
    effect: (fn) => { fn() },
    locale: {
      getLocale: () => ({ active: options.locale || 'zh' }),
      register: (ns, dicts) => { registeredLocales.set(ns, dicts); return () => {} },
    },
    slots: {
      inject: (name, cb) => {
        slotInjections.push(name)
        cb()
      },
      register: (meta, component) => {
        registeredSlots.set(`${meta.name}:${meta.key || meta.id || 'default'}`, { meta, component })
        return () => {}
      },
    },
    get: (service) => {
      if (service === 'uiWorkspace') {
        return {
          selectDirectory: async () => options.pickedDir ?? '/picked/dir',
          pickDirectory: async () => options.pickedDir ?? '/picked/dir',
          unarchiveSession: async (sid) => { unarchivedSessions.push(sid) },
        }
      }
      if (service === 'sessions') {
        return {
          create: async (opts) => {
            const sid = `sess-coord-${createdSessions.length + 1}`
            createdSessions.push({ sid, opts })
            return sid
          },
          retain: (target, opts) => {
            const ref = {
              target,
              opts,
              ready: Promise.resolve(),
              released: false,
              release: () => { ref.released = true; releasedSessions.push(target) },
              binding: {
                session: {
                  prompt: async (blocks, mode) => {
                    promptCalls.push({ target, blocks, mode })
                    if (options.rejectPrompt) return { ok: false, error: { message: 'prompt_denied' } }
                    return { ok: true }
                  },
                },
              },
            }
            retainedSessions.push(ref)
            return ref
          },
        }
      }
      return undefined
    },
  }

  plugin.apply(ctx)

  const container = dom.window.document.querySelector('main')
  const root = createRoot(container)
  const factoryCalls = []

  const SessionProvider = ({ session, children }) =>
    h('div', { 'data-session-provider': typeof session?.target === 'string' ? session.target : JSON.stringify(session?.target) }, children)

  const renderSlot = (slotName, slotProps) => {
    const entry = registeredSlots.get(`${slotName}:default`)
    if (!entry) return null
    return h(entry.component, {
      ...slotProps,
      sessionId: 'sess-mock',
      useSession: (sel) => sel({ blank: false, awaitingFirstTurn: false, running: false, openState: 'open' }),
      useSessions: (sel) => sel({ byId: {} }),
      renderFactorySlot: (name, args, opts) => {
        factoryCalls.push({ name, args, opts })
        const Views = opts && opts.slots && opts.slots.views
        return h('div', { 'data-embedded-conv': args.variant }, Views ? h(Views, { renderSlot: (n, p) => h('div', { 'data-conv-view': `${n}:${p.view}` }) }) : null)
      },
    })
  }

  const mountPage = async () => {
    const mainEntry = registeredSlots.get('main:projects')
    await act(async () => {
      root.render(
        h(mainEntry.component, {
          SessionProvider,
          renderSlot,
          useWorkspaces: (sel) => sel({ archivedSessionIds: options.archivedSessionIds || [] }),
        }),
      )
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  }

  const cleanup = async () => {
    await act(async () => { root.unmount() })
    for (const [k, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
    dom.window.close()
  }

  return {
    dom,
    container,
    loadedModule,
    plugin,
    slotInjections,
    registeredSlots,
    registeredLocales,
    resizeObservers,
    eventSources,
    apiCalls,
    intervals,
    projectsState,
    createdSessions,
    retainedSessions,
    releasedSessions,
    promptCalls,
    unarchivedSessions,
    factoryCalls,
    copiedTexts,
    storage,
    mountPage,
    cleanup,
  }
}

const plain = (value) => JSON.parse(JSON.stringify(value))

function setControlValue(dom, el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
}

test('contract: module id, strictly 4 slots, zero legacy hooks, zero hardcoded colors or forbidden CSS', async () => {
  const b = makeBench()
  try {
    assert.equal(b.loadedModule.id, 'dsh-project')
    assert.deepEqual(plain(b.plugin.inject), ['slots', 'locale', 'uiWorkspace', 'sessions'])
    assert.deepEqual(plain(b.slotInjections), ['sidebar.panellist', 'main', 'projects.conversation', 'tool.call.toolview'])
    assert.equal(b.registeredSlots.size, 4)

    const sidebar = b.registeredSlots.get('sidebar.panellist:projects')
    assert.equal(sidebar.meta.order, 30)
    assert.equal(sidebar.meta.label(), '项目')

    const main = b.registeredSlots.get('main:projects')
    assert.deepEqual(plain(main.meta.children), { 'projects.conversation': { kind: 'single', scope: 'session' } })

    const tool = b.registeredSlots.get('tool.call.toolview:projects_dispatch')
    assert.ok(tool)

    // Bilingual dictionary symmetry
    const dicts = b.registeredLocales.get('dsh-project')
    assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort())

    // Forbidden legacy patterns & design-language CSS checks
    assert.doesNotMatch(clientSource, /registerSessionNavigation/)
    assert.doesNotMatch(clientSource, /dsh-project-task-rail/)
    assert.doesNotMatch(clientSource, /window\.confirm/)
    assert.doesNotMatch(clientSource, /window\.innerWidth/)
    assert.doesNotMatch(clientSource, /::-webkit-scrollbar/)
    assert.doesNotMatch(clientSource, /\[data-ds-dark-theme\]|\[data-theme|prefers-color-scheme/)

    const cssBlocks = [...clientSource.matchAll(/const (?:DISPATCH_SHARED_CSS|PAGE_CSS) = `([\s\S]*?)`/g)].map((m) => m[1]).join('\n')
    assert.ok(cssBlocks.length > 500)
    assert.doesNotMatch(cssBlocks, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(cssBlocks, /\brgba?\s*\(|\bhsla?\s*\(/i)
    assert.doesNotMatch(clientSource, /pj-modal-solid/)
    assert.doesNotMatch(clientSource, /holdMs:\s*null/)
    assert.doesNotMatch(clientSource, /The board of the DSH project/)
    assert.doesNotMatch(clientSource, /启动协调者/)
    assert.match(cssBlocks, /\.pj-textarea,\.pj-select\{[^}]*box-sizing:border-box;width:100%;max-width:100%;min-width:0/)
    assert.match(cssBlocks, /\.pj-field-row > button\{flex:none;white-space:nowrap\}/)
  } finally {
    await b.cleanup()
  }
})

test('narrow container (600px) uses glass overlay tasks drawer and wide in-stage task detail without squeezing main stage', async () => {
  const b = makeBench({ containerWidth: 600 })
  try {
    await b.mountPage()
    // Below EXEC_DOCK_MIN (680px), tasks drawer stays closed in auto mode so main stage keeps full width
    assert.equal(b.container.querySelector('[data-projects-tasks-panel]'), null)
    assert.equal(b.container.querySelector('.pj-list'), null)

    // Toggle tasks drawer open -> renders as glass overlay (.pj-exec-overlay)
    const toggleBtn = b.container.querySelector('button.pj-tasks-toggle')
    assert.ok(toggleBtn)
    await act(async () => { toggleBtn.click() })
    const overlay = b.container.querySelector('.pj-exec.pj-exec-overlay')
    assert.ok(overlay)

    // Clicking a task card inside the overlay auto-closes the overlay and drills in inside wide .pj-stage
    const runCard = [...overlay.querySelectorAll('.pj-task-card')].find((el) => el.textContent.includes('Implement SSE backend'))
    assert.ok(runCard)
    await act(async () => { runCard.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    assert.ok(b.container.querySelector('.pj-stage [data-projects-task-detail]'), 'task detail must render in wide .pj-stage')
    assert.equal(b.container.querySelector('.pj-exec.pj-exec-overlay'), null, 'overlay must close when selecting a task')

    // Closing detail returns cleanly to coordinator conversation
    const backBtn = [...b.container.querySelectorAll('.pj-detail-bar button')].find((el) => el.textContent.includes('返回协调者'))
    assert.ok(backBtn)
    await act(async () => { backBtn.click() })
    assert.ok(b.container.querySelector('.pj-stage [data-embedded-conv="embedded"]'))
  } finally {
    await b.cleanup()
  }
})

test('container-aware ResizeObserver folding (never window.innerWidth) and width persistence', async () => {
  const b = makeBench({ containerWidth: 1200 })
  try {
    await b.mountPage()
    assert.equal(b.resizeObservers.length, 1)
    assert.ok(b.container.querySelector('[data-projects-tasks-panel="true"]'))
    assert.equal(b.container.querySelectorAll('[role="separator"]').length, 1)

    // Keyboard resizer nudge persists width
    const sep = b.container.querySelector('[role="separator"]')
    assert.ok(sep)
    await act(async () => {
      sep.dispatchEvent(new b.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    assert.ok(Number(b.storage.get('projects.execWidth')) > 0)

    // Shrink container below EXEC_DOCK_MIN (680px): tasks panel closes in auto mode
    await act(async () => { b.resizeObservers[0].trigger(580) })
    assert.equal(b.container.querySelector('[data-projects-tasks-panel]'), null)

    // Explicit toggle opens overlay drawer without crushing main stage
    const toggleBtn = b.container.querySelector('button.pj-tasks-toggle')
    assert.ok(toggleBtn)
    await act(async () => { toggleBtn.click() })
    assert.ok(b.container.querySelector('.pj-exec.pj-exec-overlay'))
  } finally {
    await b.cleanup()
  }
})

test('SSE real-time EventSource updates and reconnect recovery (zero 4s blind polling)', async () => {
  const b = makeBench()
  try {
    await b.mountPage()
    assert.equal(b.intervals.length, 0, 'must not register blind setInterval polling')
    assert.equal(b.eventSources.length, 1)
    assert.equal(b.eventSources[0].url, '/projects-api/events')
    assert.deepEqual(plain(b.eventSources[0].init), { withCredentials: true })

    // Mutate backend task and push SSE update event
    b.projectsState[0].tasks[0].status = 'review'
    b.projectsState[0].tasks[0].output = 'SSE push delivered!'
    await act(async () => {
      b.eventSources[0].emit('open', {})
      b.eventSources[0].emit('update', { type: 'task:updated', projectId: 'p-11111111', taskId: 't-run11111', ts: Date.now() })
      await new Promise((r) => setTimeout(r, 120))
    })
    assert.match(b.container.textContent, /SSE push delivered!/)

    // Disconnect triggers reconnect
    await act(async () => {
      b.eventSources[0].fail()
      await new Promise((r) => setTimeout(r, 1100))
    })
    assert.equal(b.eventSources.length, 2)
  } finally {
    await b.cleanup()
  }
})

test('coordinator lifecycle: auto-ensure isolated session (zero English prompt), embed real session, workspace/autonomy/pause header pills', async () => {
  const b = makeBench()
  try {
    await b.mountPage()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

    // Entering project auto-calls POST /coordinator/ensure and embeds native conversation with zero English prompt!
    assert.ok(b.apiCalls.some((c) => c.method === 'POST' && c.pathname === '/projects/p-11111111/coordinator/ensure'))
    assert.equal(b.createdSessions.length, 1)
    assert.equal(b.createdSessions[0].opts.cwd, '/repo/alpha')
    assert.equal(b.createdSessions[0].opts.presentation?.owner, 'dsh-project')
    assert.equal(b.promptCalls.length, 0, 'must never auto-send English starter prompt')
    assert.ok(b.container.querySelector('[data-embedded-conv="embedded"]'))
    assert.ok(b.container.querySelector('[data-conv-view="conversation.session:chat"]'))

    // Click workspace path pill -> POST /projects-api/open-path
    const wsPill = b.container.querySelector('button.pj-ws-pill')
    assert.ok(wsPill)
    await act(async () => { wsPill.click() })
    const openCall = b.apiCalls.find((c) => c.pathname === '/open-path')
    assert.ok(openCall)
    assert.equal(openCall.headers['x-projects-api'], '1')
    assert.equal(openCall.body.path, '/repo/alpha')

    // One-click autonomy & pause pills
    const autonomyBtn = b.container.querySelector('button[aria-label="派发模式"]')
    await act(async () => { autonomyBtn.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'PATCH' && c.body?.autonomy === 'auto'))

    const pauseBtn = b.container.querySelector('button[aria-label="暂停派发"]')
    await act(async () => { pauseBtn.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'PATCH' && c.body?.paused === true))
  } finally {
    await b.cleanup()
  }
})

test('new project modal via topbar switcher, settings general/memory modals, and in-app discard confirm modal', async () => {
  const b = makeBench({ pickedDir: '/picked/new-workspace' })
  try {
    await b.mountPage()

    // Open New Project modal via topbar project switcher menu
    const switcherBtn = b.container.querySelector('button[aria-label="切换项目"]')
    assert.ok(switcherBtn)
    await act(async () => { switcherBtn.click() })
    const newItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('新建项目'))
    assert.ok(newItem)
    await act(async () => { newItem.click() })
    const dialog = b.container.querySelector('[role="dialog"][aria-label="新建项目"]')
    assert.ok(dialog)

    const nameInput = dialog.querySelector('input[aria-label="项目名称"]')
    const autoTab = [...dialog.querySelectorAll('[role="tab"]')].find((el) => el.textContent.includes('自动并行'))
    const wtSwitch = dialog.querySelector('button[role="switch"]')
    const pickBtn = [...dialog.querySelectorAll('button')].find((el) => el.textContent.includes('选择文件夹'))
    const createBtn = [...dialog.querySelectorAll('button')].find((el) => el.textContent.includes('创建项目'))

    await act(async () => {
      setControlValue(b.dom, nameInput, 'Gamma Project')
      autoTab.click()
      wtSwitch.click()
    })
    await act(async () => {
      pickBtn.click()
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {
      createBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    const postCall = b.apiCalls.find((c) => c.method === 'POST' && c.pathname === '/projects')
    assert.ok(postCall, `expected POST /projects, got calls=${JSON.stringify(b.apiCalls.map(c => c.method + ' ' + c.pathname))}, toast=${b.container.querySelector('[data-toast]')?.textContent}`)
    assert.equal(postCall.body.name, 'Gamma Project')
    assert.equal(postCall.body.workspace, '/picked/new-workspace')
    assert.equal(postCall.body.autonomy, 'auto')
    assert.equal(postCall.body.worktreeIsolation, true)

    // Switch back to Alpha Project via topbar switcher, open Settings, verify Shared Memory tab & MEMORY.md read-only preview
    await act(async () => { b.container.querySelector('button[aria-label="切换项目"]').click() })
    const alphaItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('Alpha Project'))
    assert.ok(alphaItem)
    await act(async () => { alphaItem.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    const settingsBtn = b.container.querySelector('button[aria-label="项目设置"]')
    await act(async () => { settingsBtn.click() })

    // Mark instructions dirty, switch to Shared Memory nav inside Settings
    const goalArea = b.container.querySelector('textarea[aria-label="项目指令"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(b.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(goalArea, 'Modified unsaved goal')
      goalArea.dispatchEvent(new b.dom.window.Event('input', { bubbles: true }))
    })

    const memNav = [...b.container.querySelectorAll('.pj-settings-nav-btn')].find((el) => el.textContent.includes('共享记忆'))
    await act(async () => { memNav.click() })
    assert.ok(b.container.querySelector('[role="progressbar"]'))

    // Click MEMORY.md -> read-only preview (no edit/delete buttons)
    const indexRow = [...b.container.querySelectorAll('.pj-memory-row')].find((el) => el.textContent.includes('MEMORY.md'))
    assert.ok(indexRow)
    await act(async () => { indexRow.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const previewDlg = b.container.querySelector('[role="dialog"][aria-label="MEMORY.md"]')
    assert.ok(previewDlg)
    assert.equal([...previewDlg.querySelectorAll('button')].some((el) => el.textContent.includes('删除主题')), false)

    // Close preview & settings, then try switching to Gamma -> in-app ConfirmModal opens
    const closePreview = previewDlg.querySelector('button[aria-label="关闭"]')
    await act(async () => { closePreview.click() })
    const closeSettings = b.container.querySelector('.pj-settings-head button[aria-label="关闭"]')
    await act(async () => { closeSettings.click() })

    await act(async () => { b.container.querySelector('button[aria-label="切换项目"]').click() })
    const gammaItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('Gamma Project'))
    assert.ok(gammaItem)
    await act(async () => { gammaItem.click() })
    const discardDlg = b.container.querySelector('[role="dialog"][aria-label="放弃未保存修改？"]')
    assert.ok(discardDlg, 'must show in-app discard confirmation modal instead of window.confirm')
  } finally {
    await b.cleanup()
  }
})

test('threads 5 groups, approve/stop/retry/resolve, right-click 2-step delete, detail Chat & Diff tabs, and dispatch card jump', async () => {
  const b = makeBench({ coordinatorSessionId: 'sess-coord-main' })
  try {
    await b.mountPage()

    // 5 groups exist and Resolved is collapsed by default
    const groupButtons = [...b.container.querySelectorAll('.pj-group-btn')]
    assert.equal(groupButtons.length, 5)
    assert.equal(groupButtons[4].getAttribute('aria-expanded'), 'false')

    // Quick Approve on queued unapproved task
    const approveBtn = [...b.container.querySelectorAll('.pj-task-quick button')].find((el) => el.textContent === '批准')
    assert.ok(approveBtn)
    await act(async () => { approveBtn.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'POST' && c.pathname === '/projects/p-11111111/tasks/t-que44444/approve'))

    // Right-click failed task -> Retry
    const failedCard = [...b.container.querySelectorAll('.pj-task-card')].find((el) => el.textContent.includes('Fix flaky parser'))
    await act(async () => {
      failedCard.dispatchEvent(new b.dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
    })
    const retryMenuItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('重试'))
    assert.ok(retryMenuItem)
    await act(async () => { retryMenuItem.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'POST' && c.pathname === '/projects/p-11111111/tasks/t-fail3333/retry'))

    // Right-click review task -> 2-step Delete & Archive Session
    const reviewCard = [...b.container.querySelectorAll('.pj-task-card')].find((el) => el.textContent.includes('Audit diff endpoint'))
    await act(async () => {
      reviewCard.dispatchEvent(new b.dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
    })
    const delMenuItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('删除'))
    await act(async () => { delMenuItem.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 550)) })
    const delArchiveItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('删除并归档会话'))
    assert.ok(delArchiveItem)
    await act(async () => { delArchiveItem.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'DELETE' && c.pathname === '/projects/p-11111111/tasks/t-rev22222' && c.search === '?session=archive'))

    // Click running task card -> opens Master-Detail with native worker conversation + Diff tab
    const runCard = [...b.container.querySelectorAll('.pj-task-card')].find((el) => el.textContent.includes('Implement SSE backend'))
    assert.ok(runCard)
    await act(async () => { runCard.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    // Verify worker retained as continuable subagent session
    assert.ok(
      b.retainedSessions.some(
        (r) => typeof r.target === 'object' && r.target.childSessionId === 'sess-worker-1' && r.target.parentSessionId === 'sess-coord-main' && r.target.mode === 'continuable',
      ),
    )

    // Copy branch name
    const copyBranchBtn = b.container.querySelector('button[aria-label="复制分支名"]')
    assert.ok(copyBranchBtn)
    await act(async () => { copyBranchBtn.click() })
    assert.deepEqual(b.copiedTexts, ['project/t-run11111'])

    // Switch to Diff tab -> renders file list + unified diff + Merge/Cleanup buttons
    const diffTab = b.container.querySelector('#pj-tab-diff')
    assert.ok(diffTab)
    await act(async () => { diffTab.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    assert.match(b.container.textContent, /lib\/http\.js/)
    assert.match(b.container.textContent, /\+12/)

    // Merge worktree triggers ConfirmModal -> POST .../worktree/merge
    const mergeBtn = [...b.container.querySelectorAll('button')].find((el) => el.textContent === '合并到主分支')
    assert.ok(mergeBtn)
    await act(async () => { mergeBtn.click() })
    const mergeDlg = b.container.querySelector('[role="dialog"][aria-label="合并工作树到主分支？"]')
    assert.ok(mergeDlg)
    const confirmMerge = [...mergeDlg.querySelectorAll('button')].find((el) => el.textContent === '合并到主分支')
    await act(async () => { confirmMerge.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'POST' && c.pathname === '/projects/p-11111111/tasks/t-run11111/worktree/merge'))

    // Stop running task from detail header
    const stopBtn = [...b.container.querySelectorAll('.pj-detail-bar button')].find((el) => el.textContent.includes('停止'))
    assert.ok(stopBtn)
    await act(async () => { stopBtn.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'POST' && c.pathname === '/projects/p-11111111/tasks/t-run11111/stop'))

    // Close detail -> releases worker session ref
    const backBtn = [...b.container.querySelectorAll('.pj-detail-bar button')].find((el) => el.textContent.includes('返回协调者'))
    assert.ok(backBtn)
    await act(async () => { backBtn.click() })
    assert.ok(b.releasedSessions.some((r) => typeof r === 'object' && r.childSessionId === 'sess-worker-1'))

    // In-chat projects_dispatch card click jumps straight into wide task detail
    const toolEntry = b.registeredSlots.get('tool.call.toolview:projects_dispatch')
    const injected = toolEntry.meta.inject()
    const toolHost = b.dom.window.document.createElement('div')
    b.dom.window.document.body.appendChild(toolHost)
    const toolRoot = createRoot(toolHost)
    try {
      await act(async () => {
        toolRoot.render(
          h(toolEntry.component, {
            ...injected,
            phase: 'result',
            block: {
              args: { text: (k) => (k === 'project_id' ? 'p-11111111' : k === 'task_id' ? 't-run11111' : '') },
              content: [{ type: 'text', text: 'Dispatched task t-run11111' }],
            },
          }),
        )
      })
      const dispatchBtn = toolHost.querySelector('.pj-dispatch-card')
      assert.ok(dispatchBtn)
      assert.match(dispatchBtn.textContent, /Implement SSE backend/)
      await act(async () => { dispatchBtn.click() })
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
      assert.ok(b.container.querySelector('.pj-stage [data-projects-task-detail]'), 'clicking projects_dispatch card must open wide task detail')
    } finally {
      await act(async () => { toolRoot.unmount() })
    }
  } finally {
    await b.cleanup()
  }
})

test('threads search, filter popover, 409 running archive refusal, memory CRUD, archive toggle, and free-text model fallback', async () => {
  const b = makeBench({
    coordinatorSessionId: 'sess-coord-arch',
    archivedSessionIds: ['sess-coord-arch'],
    modelsCatalog: { models: [], enumerable: false, presets: [], presetsEnumerable: false },
  })
  try {
    await b.mountPage()

    // Archived coordinator banner renders and Restore triggers unarchiveSession
    assert.match(b.container.textContent, /协调者会话已归档/)
    const restoreBtn = [...b.container.querySelectorAll('.pj-banner button')].find((el) => el.textContent.includes('恢复会话'))
    assert.ok(restoreBtn)
    await act(async () => { restoreBtn.click() })
    assert.ok(b.unarchivedSessions.includes('sess-coord-arch'))

    // Search unfolds, filters by title/summary, and clears on close
    const searchToggle = b.container.querySelector('button[aria-label="搜索任务"]')
    await act(async () => { searchToggle.click() })
    const searchInput = b.container.querySelector('input[aria-label="搜索任务"]')
    assert.ok(searchInput)
    await act(async () => { setControlValue(b.dom, searchInput, 'flaky') })
    assert.equal(b.container.querySelectorAll('.pj-task-card').length, 1)
    await act(async () => { searchToggle.click() })
    assert.equal(b.container.querySelector('input[aria-label="搜索任务"]'), null)
    assert.ok(b.container.querySelectorAll('.pj-task-card').length >= 4)

    // Filter popover hides Running group and restores via Show all groups
    const filterBtn = b.container.querySelector('button[aria-label="筛选分组"]')
    await act(async () => { filterBtn.click() })
    const runCheck = [...b.container.querySelectorAll('[role="menuitemcheckbox"]')].find((el) => el.textContent.includes('执行中'))
    assert.ok(runCheck)
    await act(async () => { runCheck.click() })
    assert.equal(b.container.querySelectorAll('.pj-group-btn').length, 4)
    const showAll = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('显示全部分组'))
    assert.ok(showAll)
    await act(async () => { showAll.click() })
    assert.equal(b.container.querySelectorAll('.pj-group-btn').length, 5)

    // Right-click running task -> Delete and archive session -> 409 keeps task on board & shows toast
    const runCard = [...b.container.querySelectorAll('.pj-task-card')].find((el) => el.textContent.includes('Implement SSE backend'))
    await act(async () => {
      runCard.dispatchEvent(new b.dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
    })
    const delItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('删除'))
    await act(async () => { delItem.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 550)) })
    const archiveItem = [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('删除并归档会话'))
    await act(async () => {
      archiveItem.click()
      await new Promise((r) => setTimeout(r, 20))
    })
    assert.match(b.container.querySelector('[data-toast]')?.textContent || '', /执行者仍在运行/)
    assert.ok(b.projectsState[0].tasks.some((tk) => tk.id === 't-run11111'), '409 must keep running task')

    // Settings: free-text model fallback + 2-step Archive project + Memory create/edit/delete
    const settingsBtn = b.container.querySelector('button[aria-label="项目设置"]')
    await act(async () => { settingsBtn.click() })
    assert.ok(b.container.querySelector('input[aria-label="默认模型"]'), 'non-enumerable catalog must degrade to free-text input')

    // 2-step archive project
    const archiveBtn = [...b.container.querySelectorAll('button')].find((el) => el.textContent === '归档项目')
    await act(async () => { archiveBtn.click() })
    const confirmArchiveBtn = [...b.container.querySelectorAll('button')].find((el) => el.textContent === '确认归档')
    assert.ok(confirmArchiveBtn)
    await act(async () => { confirmArchiveBtn.click() })
    assert.ok(b.apiCalls.some((c) => c.method === 'PATCH' && c.body?.archived === true))

    // Switch to Shared Memory -> create topic -> delete topic
    const memNav = [...b.container.querySelectorAll('.pj-settings-nav-btn')].find((el) => el.textContent.includes('共享记忆'))
    await act(async () => { memNav.click() })
    const newTopicBtn = [...b.container.querySelectorAll('button')].find((el) => el.textContent.includes('新建主题'))
    await act(async () => { newTopicBtn.click() })
    const editorDlg = b.container.querySelector('[role="dialog"][aria-label="新建主题"]')
    assert.ok(editorDlg)
    await act(async () => {
      setControlValue(b.dom, editorDlg.querySelector('input[aria-label="主题标识"]'), 'release-notes')
      setControlValue(b.dom, editorDlg.querySelector('textarea[aria-label="正文内容"]'), 'Cut v2 cleanly.')
    })
    const saveTopicBtn = [...editorDlg.querySelectorAll('button')].find((el) => el.textContent === '保存')
    await act(async () => {
      saveTopicBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })
    assert.ok(b.apiCalls.some((c) => c.method === 'POST' && c.pathname === '/projects/p-11111111/memory' && c.body?.name === 'release-notes'))

    // Preview & 2-step delete created topic
    const topicRow = [...b.container.querySelectorAll('.pj-memory-row')].find((el) => el.textContent.includes('release-notes'))
    assert.ok(topicRow)
    await act(async () => {
      topicRow.click()
      await new Promise((r) => setTimeout(r, 20))
    })
    const previewDlg = b.container.querySelector('[role="dialog"][aria-label="release-notes"]')
    assert.ok(previewDlg)
    const delTopicBtn = [...previewDlg.querySelectorAll('button')].find((el) => el.textContent === '删除主题')
    await act(async () => { delTopicBtn.click() })
    const delTopicConfirm = [...previewDlg.querySelectorAll('button')].find((el) => el.textContent === '确认删除')
    assert.ok(delTopicConfirm)
    await act(async () => {
      delTopicConfirm.click()
      await new Promise((r) => setTimeout(r, 20))
    })
    assert.ok(b.apiCalls.some((c) => c.method === 'DELETE' && c.pathname === '/projects/p-11111111/memory/release-notes'))
  } finally {
    await b.cleanup()
  }
})

test('memory search debounces across identical SSE updates, re-queries on real content change, and falls back to latest memory on 500', async () => {
  let failMemorySearch = false
  let extraMatches = []
  const baseFiles = [
    { name: 'csrf-guide', description: 'CSRF defense notes', type: 'reference', modified: '2026-11-21T10:00:00.000Z', text: 'Always verify CSRF token.' },
  ]
  const b = makeBench({
    memoryStore: {
      'p-11111111': Object.fromEntries(baseFiles.map((f) => [f.name, structuredClone(f)])),
    },
    onApi({ method, pathname, search }) {
      if (method === 'GET' && pathname === '/projects/p-11111111/memory' && new URLSearchParams(search).has('q')) {
        if (failMemorySearch) return { status: 500, body: { error: 'search_failed' } }
        const q = new URLSearchParams(search).get('q') || ''
        if (q === 'CSRF') {
          return {
            status: 200,
            body: {
              matches: [
                { name: 'csrf-guide', description: 'CSRF defense notes', type: 'reference', modified: '2026-11-21T10:00:00.000Z', size: 25 },
                ...extraMatches,
              ],
            },
          }
        }
        return { status: 200, body: { matches: [] } }
      }
      return null
    },
  })

  try {
    await b.mountPage()
    const memTab = b.container.querySelector('#pj-drawer-tab-memory')
    assert.ok(memTab)
    await act(async () => { memTab.click() })

    const searchInput = b.container.querySelector('input[type="search"]')
    assert.ok(searchInput)

    // Case a) Type CSRF and fire 3 identical-memory SSE updates during the 160ms debounce window
    await act(async () => {
      setControlValue(b.dom, searchInput, 'CSRF')
      b.eventSources[0].emit('open', {})
    })
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 45))
        b.eventSources[0].emit('update', { type: 'task:updated', projectId: 'p-11111111', ts: Date.now() + i })
      })
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 240)) })

    const csrfCalls = () => b.apiCalls.filter((c) => c.method === 'GET' && c.pathname === '/projects/p-11111111/memory' && c.search === '?q=CSRF')
    assert.equal(csrfCalls().length, 1, 'identical SSE refreshes must not reset debounce or double-fetch')
    assert.ok(b.container.querySelector('[data-memory-topic="csrf-guide"]'))

    // Case b) Real memory content addition via SSE triggers exactly 1 new search and renders new item
    extraMatches = [{ name: 'csrf-extra', description: 'CSRF token rotation', type: 'reference', modified: '2026-11-27T00:00:00.000Z', size: 18 }]
    await globalThis.fetch('/projects-api/projects/p-11111111/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'csrf-extra',
        description: 'CSRF token rotation',
        type: 'reference',
        text: 'Rotate CSRF token.',
      }),
    })
    await act(async () => {
      b.eventSources[0].emit('update', { type: 'memory:updated', projectId: 'p-11111111', ts: Date.now() + 99 })
      await new Promise((r) => setTimeout(r, 150))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 260))
    })
    assert.equal(csrfCalls().length, 2, 'real memory change must re-run search once')
    assert.ok(b.container.querySelector('[data-memory-topic="csrf-extra"]'))

    // Case c) Search endpoint 500 falls back to latest memory content added via SSE
    failMemorySearch = true
    await globalThis.fetch('/projects-api/projects/p-11111111/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'offline-notes',
        description: 'offline fallback entry',
        type: 'reference',
        text: 'Offline fallback.',
      }),
    })
    await act(async () => {
      b.eventSources[0].emit('update', { type: 'memory:updated', projectId: 'p-11111111', ts: Date.now() + 199 })
      await new Promise((r) => setTimeout(r, 150))
    })
    await act(async () => {
      setControlValue(b.dom, searchInput, 'offline')
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 260))
    })
    assert.ok(b.container.querySelector('[data-memory-topic="offline-notes"]'))
  } finally {
    await b.cleanup()
  }
})
