/** Chromium geometry over the shipped Project and native Team composition, with isolated Host fixture data. */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SpawnTeammateRequest } from '@deepseek-ai/dsh-experimental-agent-team'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-todo'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const TEAM_PATCH = fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url))
const TEAM_ANCHOR = fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url))
const PROJECT_DIR = fileURLToPath(new URL('../../../../dsh-project/', import.meta.url))
const REQUEST_ID = 'project-composer-request'
const WORK_ID = 'project-composer-work'
const MEMBER_ID = SessionId('session-project-composer-member')
const DELEGATION = 'project-composer-delegation'
const RUN_ID = 'project-composer-run'
const DRAFT = 'Preserve this unfinished Project draft.'
const TITLE = 'Stable Project composer'
const WIDTHS = [1680, 800, 390] as const
const PLAN = [
  { content: 'Inspect the existing composer', status: 'completed' as const },
  { content: 'Keep Project status in the header', status: 'in_progress' as const },
  { content: 'Verify the result in Chromium', status: 'pending' as const },
]

interface ProjectRecord {
  id: string
  title: string
  coordinatorSessionId: string
  canonicalWorkingDirectory: string
  lifecycle: 'creating' | 'ready' | 'archived'
  paused: boolean
  diagnostics: string[]
  updatedAt: number
}
interface AssignmentSource {
  sessionId: string
  messageId: string
  callId: string
  text: string
  requestId: string
  requestRevision: number
}
interface Report {
  delegationRef: string
  outcome: 'completed' | 'blocked' | 'failed'
  summary: string
  artifacts: []
  evidence: string[]
  remainingIssues: string[]
  at: number
  callId: string
}
interface WorkRecord {
  id: string
  projectId: string
  title: string
  brief: string
  status: 'open' | 'running' | 'blocked' | 'done'
  workerSessionId: string
  blockedBy: string[]
  blockedReason: string
  currentDelegationRef: string
  delegations: {
    ref: string
    source: AssignmentSource
    brief: string
    scope: 'readonly'
    writePaths: string[]
    phase: 'queued' | 'preparing' | 'accepted' | 'failed' | 'stopped'
    messageId: string
    runId: string
    error: string
    createdAt: number
    report?: Report
    waitingReason?: { kind: 'dependencies' | 'directory' | 'capacity'; workTitles: string[] }
  }[]
  settlements: {
    runId: string
    delegationRefs: string[]
    stopReason: string
    summary: string
    at: number
    merged: boolean
    noticeMessageId: string
    summarizedBy: string
  }[]
  pendingSummary: boolean
  summaryFailure?: { turn: number; at: number; delegationRef: string; runId: string; error: { code: string; message: string } }
  archived: boolean
  createdAt: number
  updatedAt: number
}
interface WorkerRecord {
  sessionId: string
  projectId: string
  workstreamId: string
  cwd: string
  role: 'readonly'
  mode: 'existing'
  phase: 'provisioning' | 'active' | 'idle' | 'failed' | 'stopping'
  directoryHeld: boolean
  stopped: boolean
  materialized: boolean
  activeRunId: string
  writePaths: string[]
  consumedDelegationRef: string
  error: string
  updatedAt: number
}
interface RequestRecord {
  id: string
  projectId: string
  title: string
  revision: number
  versions: {
    revision: number
    title: string
    goal: string
    constraints: string[]
    conditions: string[]
    scope: 'readonly'
    writePaths: string[]
    source: AssignmentSource
    at: number
  }[]
  queue: { state: 'active'; order: number }
  createdAt: number
  updatedAt: number
}
interface DeliveryRecord {
  id: string
  projectId: string
  requestId: string
  requestRevision: number
  title: string
  summary: string
  outcome: 'completed'
  evidence: string[]
  remainingIssues: string[]
  reportRefs: { workstreamId: string; delegationRef: string; reportId: string }[]
  requiredDelegations: { workstreamId: string; delegationRef: string; runId: string }[]
  declaredCallId: string
  sessionId: string
  turn: number
  status: 'delivered'
  replyMessageId: string
  at: number
}
interface ProjectCatalog {
  projects: ProjectRecord[]
  workstreams: WorkRecord[]
  workers: WorkerRecord[]
  requests: RequestRecord[]
  deliveries: DeliveryRecord[]
}
/** Only the existing private Host fixture operations used by this scenario. */
interface ProjectFixtureService {
  available: boolean
  error?: string
  desktop(action: string, input: { workingDirectory?: string }): Promise<Record<string, unknown>>
  create(input: { requestId: string; workingDirectory: string }): Promise<{ project: ProjectRecord }>
  serial(work: () => Promise<void>): Promise<void>
  write(change: (catalog: ProjectCatalog) => void): Promise<void>
  held: Set<string>
  ensureTask(work: WorkRecord): Promise<unknown>
  assignTask(root: Agent, work: WorkRecord, worker: WorkerRecord): Promise<void>
  memberRequest(worker: WorkerRecord, work: WorkRecord): SpawnTeammateRequest
  state(): ProjectCatalog
}

type FixtureState = 'running' | 'provisioning' | 'queued' | 'stopping' | 'paused' | 'blocked' | 'summaryFailed' | 'pendingDelivery' | 'done'
const STATES: FixtureState[] = ['running', 'provisioning', 'queued', 'stopping', 'paused', 'blocked', 'summaryFailed', 'pendingDelivery', 'done']
interface Box { left: number; top: number; width: number; height: number }
interface Geometry { composer: Box; requests: Box; team: Box; header: Box }
interface GeometryProbe { baseline: Geometry; samples: number; maxShift: number; overflow: number; running: boolean }
interface ProbeWindow extends Window { __projectComposerProbe?: GeometryProbe }

function currentGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (selector: string): Box => {
      const element = document.querySelector<HTMLElement>(selector)
      if (element === null) throw new Error(`Project geometry element missing: ${selector}`)
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
    return {
      composer: box('[data-composer-seat] [data-composer-card]'),
      requests: box('[data-project-header-panel="requests"] button'),
      team: box('[data-team-action] button[aria-haspopup="dialog"]'),
      header: box('[data-project-header-panel="requests"]'),
    }
  })
}

/** Observe every animation frame so a transient layout jump cannot pass by settling back later. */
async function startGeometryProbe(page: Page): Promise<void> {
  const baseline = await currentGeometry(page)
  await page.evaluate((baseline) => {
    const host = window as ProbeWindow
    const probe: GeometryProbe = { baseline, samples: 0, maxShift: 0, overflow: 0, running: true }
    host.__projectComposerProbe = probe
    const selectors = {
      composer: '[data-composer-seat] [data-composer-card]',
      requests: '[data-project-header-panel="requests"] button',
      team: '[data-team-action] button[aria-haspopup="dialog"]',
      header: '[data-project-header-panel="requests"]',
    }
    const sample = (): void => {
      if (!probe.running) return
      for (const key of ['composer', 'requests', 'team', 'header'] as const) {
        const element = document.querySelector<HTMLElement>(selectors[key])
        if (element === null) { probe.maxShift = Number.POSITIVE_INFINITY; continue }
        const rect = element.getBoundingClientRect(), reference = probe.baseline[key]
        for (const field of ['left', 'top', 'width', 'height'] as const) {
          probe.maxShift = Math.max(probe.maxShift, Math.abs(rect[field] - reference[field]))
        }
      }
      probe.overflow = Math.max(probe.overflow, document.documentElement.scrollWidth - innerWidth)
      probe.samples += 1
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, baseline)
}

async function stopGeometryProbe(page: Page): Promise<GeometryProbe> {
  return await page.evaluate(() => {
    const probe = (window as ProbeWindow).__projectComposerProbe
    if (probe === undefined) throw new Error('Project geometry probe was not started')
    probe.running = false
    return probe
  })
}

async function settleViewport(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 1000 })
  await page.locator('[data-composer-seat]').evaluate(async (seat) => {
    let previous = seat.getBoundingClientRect().width, stable = 0
    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
      const next = seat.getBoundingClientRect().width
      stable = Math.abs(next - previous) < 0.01 ? stable + 1 : 0
      if (stable >= 5) return
      previous = next
    }
    throw new Error('Project conversation width did not settle')
  })
}

async function assertPopoverInViewport(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.locator(selector).evaluate((panel) => {
    const rect = panel.getBoundingClientRect()
    return panel.parentElement === document.body && rect.left >= 15 && rect.top >= 15
      && rect.right <= innerWidth - 15 && rect.bottom <= innerHeight - 15
      && panel.contains(document.elementFromPoint(rect.left + 12, rect.top + 12))
  }), { timeout: 5000 }).toBe(true)
}

describe('web e2e: Project composer stays fixed while status changes', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let projects: ProjectFixtureService
  let project: ProjectRecord
  let lead: Agent
  let member: AgentHandle
  let tripwire: ReturnType<typeof watchConsole>
  let releaseController: (() => void) | undefined
  let job: { id: JobId; finish(outcome: JobOutcome): void } | undefined
  let disconnected = false

  async function finishJob(): Promise<void> {
    if (job === undefined) return
    const current = job
    job = undefined
    current.finish({ status: 'completed' })
    await scaffold.ctx.jobs.wait(current.id, 5000, MEMBER_ID)
  }

  function startJob(): void {
    const completion = Promise.withResolvers<JobOutcome>()
    const id = scaffold.ctx.jobs.start({
      kind: 'bash', owner: MEMBER_ID, label: 'Project composer fixture background command',
      run: () => ({ done: completion.promise, cancel: () => { completion.resolve({ status: 'killed' }) } }),
    })
    job = { id, finish: completion.resolve }
  }

  async function setState(state: FixtureState): Promise<void> {
    await finishJob()
    await projects.serial(() => projects.write((catalog) => {
      const currentProject = catalog.projects.find(item => item.id === project.id)
      const work = catalog.workstreams.find(item => item.id === WORK_ID)
      const worker = catalog.workers.find(item => item.sessionId === MEMBER_ID)
      if (currentProject === undefined || work === undefined || worker === undefined) throw new Error('Project fixture identity disappeared')
      currentProject.paused = state === 'paused'
      currentProject.lifecycle = 'ready'
      currentProject.diagnostics = []
      worker.phase = state === 'stopping' ? 'stopping' : state === 'blocked' ? 'failed' : state === 'provisioning' ? 'provisioning' : 'idle'
      worker.stopped = state === 'paused'
      worker.activeRunId = ''
      worker.error = state === 'blocked' ? 'Fixture command failed with a recorded error.' : ''
      work.status = state === 'blocked' ? 'blocked' : state === 'done' ? 'done' : 'open'
      work.blockedReason = worker.error
      work.pendingSummary = state === 'pendingDelivery' || state === 'summaryFailed'
      delete work.summaryFailure
      const receipt = work.delegations[0]
      if (receipt === undefined) throw new Error('Project fixture assignment disappeared')
      receipt.phase = state === 'queued' ? 'queued' : state === 'provisioning' ? 'preparing' : state === 'blocked' ? 'failed' : 'accepted'
      receipt.error = worker.error
      delete receipt.waitingReason
      delete receipt.report
      work.settlements = []
      catalog.deliveries = []
      if (state === 'queued') receipt.waitingReason = { kind: 'dependencies', workTitles: ['Review the prior result'] }
      if (state === 'summaryFailed') work.summaryFailure = {
        turn: 1, at: Date.now(), delegationRef: DELEGATION, runId: RUN_ID,
        error: { code: 'FIXTURE_SUMMARY_FAILED', message: 'The result remains available; the summary failed.' },
      }
      if (state === 'pendingDelivery' || state === 'done') {
        receipt.report = {
          delegationRef: DELEGATION, outcome: 'completed', summary: 'The composer remains stable.', artifacts: [],
          evidence: ['Measured in Chromium.'], remainingIssues: [], at: Date.now(), callId: 'project-composer-report',
        }
        work.settlements = [{
          runId: RUN_ID, delegationRefs: [DELEGATION], stopReason: 'completed', summary: 'Recorded fixture settlement.',
          at: Date.now(), merged: true, noticeMessageId: 'project-composer-notice', summarizedBy: '',
        }]
      }
      if (state === 'done') {
        work.pendingSummary = false
        catalog.deliveries = [{
          id: 'project-composer-delivery', projectId: project.id, requestId: REQUEST_ID, requestRevision: 1,
          title: TITLE, summary: 'The requested composer stability has been delivered.', outcome: 'completed',
          evidence: ['Measured in Chromium.'], remainingIssues: [],
          reportRefs: [{ workstreamId: WORK_ID, delegationRef: DELEGATION, reportId: 'project-composer-report' }],
          requiredDelegations: [{ workstreamId: WORK_ID, delegationRef: DELEGATION, runId: RUN_ID }],
          declaredCallId: 'project-composer-deliver', sessionId: lead.id, turn: 1, status: 'delivered',
          replyMessageId: 'project-composer-delivery-reply', at: Date.now(),
        }]
      }
    }))
    // Jobs alone must count as a running member even when no model turn is active.
    scaffold.ctx.emit('api-session/status', MEMBER_ID, false)
    if (state === 'running') startJob()
    await expect.poll(() => page.locator('[data-project-header-panel="requests"]').getAttribute('data-state'), { timeout: 15_000 })
      .toBe(state)
    await expect.poll(() => page.locator('[data-team-running-count]').textContent(), { timeout: 15_000 })
      .toBe(state === 'running' ? '1' : '0')
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: [TEAM_PATCH, join(PROJECT_DIR, 'cordis.patch.yml')],
      extraInstallAnchors: [TEAM_ANCHOR, join(PROJECT_DIR, 'package.json')],
    })
    const service = scaffold.ctx.get('projects') as ProjectFixtureService | undefined
    if (service === undefined || !service.available) throw new Error(`Project Host did not mount: ${service?.error ?? 'missing service'}`)
    projects = service
    // Seeded queued states remain observations; this fixture sends no executable model input.
    projects.held.add(MEMBER_ID)
    // Directory selection is the desktop environment input; every subsequent Project operation is real.
    projects.desktop = async (action, input) => {
      if (action !== 'select-directory' && action !== 'check-directory') throw new Error(`Unexpected Project desktop action: ${action}`)
      return { allowed: true, canonicalPath: input.workingDirectory, identity: 'project-composer-fixture-directory' }
    }
    project = (await projects.create({ requestId: randomUUID(), workingDirectory: scaffold.workspaceCwd })).project
    const root = scaffold.ctx.agents.get(SessionId(project.coordinatorSessionId))
    if (root === undefined) throw new Error('Project did not create its original Lead')
    lead = root
    const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: TITLE }] })
    lead.session.append('turn/start', { turn: 1 })
    lead.session.append('user/message', input, { surfaceOp: 'append' })
    lead.session.append('step/start', { turn: 1, step: 1 })
    lead.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: 'Project fixture ready.' }] }),
    }, { surfaceOp: 'append' })
    lead.session.append('todo/write', { todos: PLAN })
    lead.session.append('step/end', { turn: 1, step: 1 })
    lead.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(lead.session)

    const now = Date.now()
    const source: AssignmentSource = { sessionId: lead.id, messageId: input.id, callId: 'project-composer-request-call', text: TITLE, requestId: REQUEST_ID, requestRevision: 1 }
    const work: WorkRecord = {
      id: WORK_ID, projectId: project.id, title: 'Verify stable Project status', brief: 'Inspect composer geometry without changing the application.',
      status: 'open', workerSessionId: MEMBER_ID, blockedBy: [], blockedReason: '', currentDelegationRef: DELEGATION,
      delegations: [{ ref: DELEGATION, source, brief: 'Measure the real UI.', scope: 'readonly', writePaths: [], phase: 'accepted', messageId: 'project-composer-assignment', runId: RUN_ID, error: '', createdAt: now }],
      settlements: [], pendingSummary: false, archived: false, createdAt: now, updatedAt: now,
    }
    const worker: WorkerRecord = {
      sessionId: MEMBER_ID, projectId: project.id, workstreamId: WORK_ID, cwd: scaffold.workspaceCwd, role: 'readonly', mode: 'existing',
      phase: 'idle', directoryHeld: false, stopped: false, materialized: true, activeRunId: '', writePaths: [],
      consumedDelegationRef: DELEGATION, error: '', updatedAt: now,
    }
    await projects.serial(() => projects.write((catalog) => {
      catalog.workstreams.push(work)
      catalog.workers.push(worker)
      catalog.requests.push({
        id: REQUEST_ID, projectId: project.id, title: TITLE, revision: 1,
        versions: [{ revision: 1, title: TITLE, goal: 'Keep the main conversation composer fixed while Project state changes.', constraints: ['Preserve the draft.'], conditions: ['No added status row moves the composer.'], scope: 'readonly', writePaths: [], source, at: now }],
        queue: { state: 'active', order: 1 }, createdAt: now, updatedAt: now,
      })
    }))
    member = await scaffold.ctx.agents.create({
      sessionId: MEMBER_ID, parentAgent: lead,
      meta: { cwd: scaffold.workspaceCwd, parentSession: lead.id, origin: 'subagent', agentPreset: 'project-worker', delegationDepth: 1 },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    member.agent.session.append('turn/start', { turn: 1 })
    member.agent.session.append('subagent/descriptor', {
      version: 4, mode: 'continuable', provider: 'spawn', label: work.title,
      agentPreset: 'project-worker', admissionPolicy: 'dsh-project-local',
    })
    member.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(member.agent.session)
    await scaffold.ctx.agentTeams.adoptMember(lead, projects.memberRequest(worker, work))
    await projects.ensureTask(work)
    await projects.assignTask(lead, work, worker)
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    releaseController = scaffold.ctx.jobs.attachController('project-composer-browser-fixture')

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    tripwire = watchConsole(page)
    await page.route('**/dsh-project/list', async (route) => {
      if (disconnected) await route.abort('failed')
      else await route.continue()
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const row = page.locator(`[data-row-key="session:${lead.id}"]`)
    await row.waitFor({ state: 'attached', timeout: 30_000 })
    if (!await row.isVisible()) {
      const group = page.locator('[data-row-key^="workspace:"][aria-expanded="false"]').first()
      if (await group.count()) await group.click()
    }
    await row.waitFor({ state: 'visible', timeout: 30_000 })
    await row.click()
    await page.locator('[data-project-header-panel="requests"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-composer-input][contenteditable="true"]').first().fill(DRAFT)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    try { if (scaffold !== undefined) await finishJob() } catch (error) { failures.push(error) }
    releaseController?.()
    try { await page?.close() } catch (error) { failures.push(error) }
    try { await browser?.close() } catch (error) { failures.push(error) }
    try { await member?.dispose() } catch (error) { failures.push(error) }
    try { await scaffold?.close() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'Project composer fixture cleanup failed')
  })

  it('keeps card and header rectangles fixed through real Project states and click-open details', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-project-composer-stability'))
    const measurements: { width: number; states: number; frames: number; maxShift: number; overflow: number }[] = []
    for (const width of WIDTHS) {
      await setState('running')
      await settleViewport(page, width)
      await startGeometryProbe(page)
      for (const state of STATES) {
        await setState(state)
        expect(await page.locator('[data-composer-input]').first().textContent()).toBe(DRAFT)
        expect(await page.locator('[data-sidebar-right-open] [data-team-sidebar], [data-sidebar-right-open] .dsh-project-requests').count()).toBe(0)
        expect(await page.locator('[data-composer-seat] [data-testid="todo-panel"]').count()).toBe(0)
        expect(await page.locator('[data-composer-seat] [data-testid="project-checklist"], [data-composer-seat] .dsh-project-activity').count()).toBe(0)
      }
      await setState('pendingDelivery')
      const requestsTrigger = page.locator('[data-project-header-panel="requests"] button').first()
      await requestsTrigger.hover()
      await page.waitForTimeout(450)
      expect(await requestsTrigger.getAttribute('aria-expanded')).toBe('false')
      await requestsTrigger.click()
      const requests = page.locator('[data-project-panel="requests"]')
      await assertPopoverInViewport(page, '[data-project-panel="requests"]')
      const card = requests.locator(`[data-project-request-id="${REQUEST_ID}"]`)
      await card.getByRole('tab', { name: 'Plan', exact: true }).click()
      for (const todo of PLAN) await card.locator('[data-project-request-tab="plan"]').getByText(todo.content, { exact: true }).waitFor()
      await card.getByRole('tab', { name: 'Work', exact: true }).click()
      await card.locator('[data-project-request-tab="work"]').getByText('Verify stable Project status', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await requests.waitFor({ state: 'hidden' })

      const teamTrigger = page.locator('[data-team-action] button[aria-haspopup="dialog"]')
      await teamTrigger.hover()
      await page.waitForTimeout(450)
      expect(await teamTrigger.getAttribute('aria-expanded')).toBe('false')
      await teamTrigger.click()
      await assertPopoverInViewport(page, '[data-team-panel]:not([hidden])')
      await page.locator('[data-team-panel]:not([hidden])').getByText('Verify stable Project status', { exact: true }).first().waitFor()
      await page.keyboard.press('Escape')
      await page.locator('[data-team-panel]').waitFor({ state: 'hidden' })
      const probe = await stopGeometryProbe(page)
      expect(probe.samples).toBeGreaterThan(1)
      expect(probe.maxShift, `Project composer/header movement at ${width}px`).toBeLessThanOrEqual(1)
      expect(probe.overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(1)
      measurements.push({ width, states: STATES.length, frames: probe.samples, maxShift: probe.maxShift, overflow: probe.overflow })
    }
    console.log('Project composer geometry:', JSON.stringify(measurements))
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 240_000)

  it('retains draft and geometry when Project status becomes unknown and recovers', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-project-composer-disconnected'))
    await setState('pendingDelivery')
    await settleViewport(page, 800)
    await startGeometryProbe(page)
    try {
      disconnected = true
      await expect.poll(() => page.locator('[data-project-header-panel="requests"]').getAttribute('data-state'), { timeout: 15_000 }).toBe('unknown')
      await expect.poll(() => page.locator('[data-team-running-count]').textContent(), { timeout: 5000 }).toBe('?')
      expect(await page.locator('[data-composer-input]').first().textContent()).toBe(DRAFT)
      disconnected = false
      await expect.poll(() => page.locator('[data-project-header-panel="requests"]').getAttribute('data-state'), { timeout: 15_000 }).toBe('pendingDelivery')
      await expect.poll(() => page.locator('[data-team-running-count]').textContent(), { timeout: 5000 }).toBe('0')
    } finally {
      disconnected = false
    }
    const probe = await stopGeometryProbe(page)
    expect(probe.maxShift).toBeLessThanOrEqual(1)
    expect(probe.overflow).toBeLessThanOrEqual(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 45_000)

  it('covers the resident composer card exactly during archive takeover and returns the draft on restore', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-project-composer-archive'))
    for (const width of WIDTHS) {
      await setState('pendingDelivery')
      await settleViewport(page, width)
      const before = (await currentGeometry(page)).composer
      await projects.serial(() => projects.write((catalog) => {
        const current = catalog.projects.find(item => item.id === project.id)
        if (current === undefined) throw new Error('Project disappeared before archive fixture')
        current.lifecycle = 'archived'
        current.paused = true
      }))
      const takeover = page.locator('[data-project-composer-takeover] > [role="note"]')
      await takeover.waitFor({ timeout: 15_000 })
      await expect.poll(() => takeover.evaluate((element, reference) => {
        const box = element.getBoundingClientRect()
        return Math.max(...(['left', 'top', 'width', 'height'] as const).map(key => Math.abs(box[key] - reference[key])))
      }, before), { timeout: 5000 }).toBeLessThanOrEqual(1)
      await projects.serial(() => projects.write((catalog) => {
        const current = catalog.projects.find(item => item.id === project.id)
        if (current === undefined) throw new Error('Project disappeared before restore fixture')
        current.lifecycle = 'ready'
        current.paused = false
      }))
      await takeover.waitFor({ state: 'detached', timeout: 15_000 })
      expect(await page.locator('[data-composer-input]').first().textContent()).toBe(DRAFT)
      const restored = (await currentGeometry(page)).composer
      for (const field of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(restored[field] - before[field])).toBeLessThanOrEqual(1)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('restores full composer geometry after explicitly pinning and returning Requests and Team', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-project-composer-observer-return'))
    await setState('pendingDelivery')
    const measurements: { width: number; surface: string; maxShift: number }[] = []
    for (const width of [800, 390]) {
      await settleViewport(page, width)
      const original = (await currentGeometry(page)).composer
      for (const surface of ['requests', 'team'] as const) {
        const trigger = surface === 'requests'
          ? page.locator('[data-project-header-panel="requests"] button').first()
          : page.locator('[data-team-action] button[aria-haspopup="dialog"]')
        const floating = page.locator(surface === 'requests' ? '[data-project-panel="requests"]:not([hidden])' : '[data-team-panel]:not([hidden])')
        const observer = page.locator(surface === 'requests'
          ? '[data-sidebar-right-open] .dsh-project-requests'
          : '[data-sidebar-right-open] [data-team-sidebar]')
        await trigger.click()
        await floating.waitFor()
        if (surface === 'requests') await floating.locator(`[data-project-request-id="${REQUEST_ID}"]`).getByRole('tab', { name: 'Work', exact: true }).click()
        expect(await page.getByRole('button', { name: 'Keep observing', exact: true }).count()).toBe(1)
        await floating.getByRole('button', { name: 'Keep observing', exact: true }).click()
        await observer.waitFor()
        await floating.waitFor({ state: 'hidden' })
        expect(await page.getByRole('button', { name: 'Keep observing', exact: true }).count()).toBe(0)
        expect(await page.getByRole('button', { name: 'Return to popover', exact: true }).count()).toBe(1)
        if (surface === 'requests') expect(await observer.locator(`[data-project-request-id="${REQUEST_ID}"]`).getByRole('tab', { name: 'Work', exact: true }).getAttribute('aria-selected')).toBe('true')
        await observer.getByRole('button', { name: 'Return to popover', exact: true }).click()
        await floating.waitFor()
        await expect.poll(async () => {
          const current = (await currentGeometry(page)).composer
          return Math.max(...(['left', 'top', 'width', 'height'] as const).map(key => Math.abs(current[key] - original[key])))
        }, { timeout: 5000 }).toBeLessThanOrEqual(1)
        expect(await page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').count()).toBe(0)
        expect(await page.getByRole('button', { name: 'Return to popover', exact: true }).count()).toBe(0)
        expect(await page.getByRole('button', { name: 'Keep observing', exact: true }).count()).toBe(1)
        if (surface === 'requests') {
          const card = floating.locator(`[data-project-request-id="${REQUEST_ID}"]`)
          expect(await card.getByRole('tab', { name: 'Work', exact: true }).getAttribute('aria-selected')).toBe('true')
          expect(await card.locator('[data-project-request-tab="work"]').getByText('Verify stable Project status', { exact: true }).count()).toBe(1)
        }
        expect(await page.locator('[data-composer-input]').first().textContent()).toBe(DRAFT)
        const restored = (await currentGeometry(page)).composer
        measurements.push({ width, surface, maxShift: Math.max(...(['left', 'top', 'width', 'height'] as const).map(key => Math.abs(restored[key] - original[key]))) })
        await page.keyboard.press('Escape')
        await floating.waitFor({ state: 'hidden' })
      }
    }
    console.log('Project observer return geometry:', JSON.stringify(measurements))
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 45_000)

  it('uses the resident member card geometry while reading its managed conversation', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-project-composer-member'))
    await setState('pendingDelivery')
    await settleViewport(page, 800)
    await page.locator('[data-team-action] button[aria-haspopup="dialog"]').click()
    await page.locator('[data-team-panel]:not([hidden])').getByRole('button').filter({ hasText: 'Verify stable Project status' }).first().click()
    const takeover = page.locator('[data-project-composer-takeover] > [role="note"]')
    await takeover.waitFor({ timeout: 15_000 })
    for (const width of WIDTHS) {
      await settleViewport(page, width)
      await expect.poll(() => page.evaluate(() => {
        const card = document.querySelector('[data-composer-seat] [data-chain-overlay-fallback="conversation.composer"] [data-composer-card]')
        const managed = document.querySelector('[data-project-composer-takeover] > [role="note"]')
        if (card === null || managed === null) return Number.POSITIVE_INFINITY
        const input = card.getBoundingClientRect(), output = managed.getBoundingClientRect()
        return Math.max(...(['left', 'top', 'width', 'height'] as const).map(key => Math.abs(input[key] - output[key])))
      }), { timeout: 5000 }).toBeLessThanOrEqual(1)
    }
    await takeover.getByRole('button', { name: 'Back to coordinator', exact: true }).click()
    await takeover.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.locator('[data-composer-input]').first().textContent()).toBe(DRAFT)
    expect(tripwire.pageErrors).toEqual([])
  }, 45_000)
})
