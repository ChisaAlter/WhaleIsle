// Keyless, real-profile edit flow: first/later prompts, cancel, resend, repeat,
// reload, and model history all retain the original Session identity.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  renderSeedFixture, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/message-edit', import.meta.url))
const MODE = webSnapshotMode()
const REVISED = 'Answer with EDITED instead.'
const REPEATED = 'Answer with EDITED AGAIN instead.'

function seed(turns: number): string {
  const session = Session.create(SessionId('fixture'))
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `Original prompt ${turn}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('request/header', {
      header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      reason: turn === 1 ? 'initial' : 'resume',
    })
    session.append('assistant/message', {
      turn, step: 1, message: createAssistantMessage({
        content: [{ type: 'text', text: `Original reply ${turn}` }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return renderSeedFixture(JSON.stringify({
    type: 'session', version: 0, id: '{{sessionId}}', createdAt: 0,
  }), session.snapshotEvents())
}

function textChunks(text: string, deltas: readonly string[] = [text]): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...deltas.map(delta => ({ type: 'text-delta' as const, index: 0, text: delta })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 64, outputTokens: 8 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function replies(): ReplayOverrideDoc {
  return ['EDITED-REPLY', 'EDITED-AGAIN-REPLY'].map(text => ({
    kind: 'chunks' as const, chunks: textChunks(text),
  }))
}

describe('web e2e: editing stays in the current conversation', () => {
  it.skipIf(MODE === 'record').each([1, 2])('edits the latest of %i turns in place', async (turns) => {
    const replayDir = await mkdtemp(join(tmpdir(), 'dsh-message-edit-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(replies()))
    const scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'), replayOverride,
    })
    const browser = await chromium.launch({ executablePath: process.env.DSH_TEST_CHROMIUM_PATH })
    const page = await newEnglishPage(browser)
    const id = SessionId(`message-edit-${turns}-web-e2e`)
    let failed = false
    try {
      await seedSession(scaffold, seed(turns), id)
      const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
      await workspace.attachSession(id)
      await scaffold.ctx.sessionController.selectModel({
        sessionId: id, provider: 'deepseek-official', model: 'deepseek-v4-flash',
      })
      await scaffold.ctx.sessionController.rename({ sessionId: id, title: 'Message edit fixture' })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-phase="hero"] [data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
      const group = page.locator(`[data-row-key="workspace:${workspace.id}"]`)
      await group.waitFor({ timeout: 30_000 })
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      await expect.poll(() => group.getAttribute('aria-expanded')).toBe('true')
      await page.locator(`[data-row-key="session:${id}"]`).click()
      await expect.poll(() => page.getByText(`Original reply ${turns}`, { exact: true }).count(), { timeout: 20_000 }).toBe(1)
      const count = await page.getByRole('treeitem').count()
      const url = page.url()
      const read = async () => {
        using observed = await scaffold.ctx.sessionQuery.observeSession(id)
        return { header: observed.header, events: [...observed.events] }
      }
      const { header, events: originalLog } = await read()
      const initialAgentIds = scaffold.ctx.agents.list().map(agent => agent.id).sort()
      const prompts = vi.spyOn(scaffold.ctx.sessionController, 'prompt')
      const composer = page.locator('[data-composer-input]')
      const banner = page.locator('[data-edit-session]')
      const bubble = page.locator('[data-message-editing]')
      const pencil = page.getByRole('button', { name: 'Edit', exact: true })

      await composer.fill('saved draft')
      await pencil.click()
      await banner.waitFor()
      await expect.poll(() => composer.innerText()).toBe(`Original prompt ${turns}`)
      expect(scaffold.ctx.agents.list().map(agent => agent.id).sort()).toEqual(initialAgentIds)
      expect((await read()).events).toEqual(originalLog)
      expect(await bubble.count()).toBe(1)
      expect(await composer.evaluate(el => el === document.activeElement)).toBe(true)
      await page.keyboard.press('Escape')
      await expect.poll(() => banner.count()).toBe(0)
      await expect.poll(() => composer.innerText()).toBe('saved draft')
      expect(await composer.evaluate(el => el === document.activeElement)).toBe(true)

      await pencil.click()
      await bubble.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect.poll(() => banner.count()).toBe(0)
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Edit')
      await pencil.click()
      await banner.waitFor()
      const aria = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)).split(id).join('{{seededId}}')
      await page.screenshot({ path: join(replayDir, `editor-${turns}.png`), fullPage: true })
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, turns === 1 ? 'editor-first.expected.md' : 'editor.expected.md'), aria, MODE)

      for (const [prompt, reply] of [[REVISED, 'EDITED-REPLY'], [REPEATED, 'EDITED-AGAIN-REPLY']] as const) {
        await composer.fill(prompt)
        if (prompt === REPEATED) await composer.press('Enter')
        else await page.getByRole('button', { name: 'Send message', exact: true }).click()
        await expect.poll(() => prompts.mock.calls.length, { timeout: 5_000 }).toBe(prompt === REVISED ? 1 : 2)
        await expect.poll(() => page.getByText(reply, { exact: true }).count(), { timeout: 20_000 }).toBe(1)
        await expect.poll(() => banner.count()).toBe(0)
        expect(await page.getByText(`Original prompt ${turns}`, { exact: true }).count()).toBe(0)
        expect(await page.getByText(`Original reply ${turns}`, { exact: true }).count()).toBe(0)
        if (turns === 2) expect(await page.getByText('Original reply 1', { exact: true }).count()).toBe(1)
        expect(await page.getByRole('treeitem').count()).toBe(count)
        expect(page.url()).toBe(url)
        expect(scaffold.ctx.agents.list().map(agent => agent.id).sort()).toEqual([...new Set([...initialAgentIds, id])].sort())
        const agent = scaffold.ctx.agents.get(id)!
        expect(agent.session.header).toEqual(header)
        expect(agent.session.snapshotEvents().slice(0, originalLog.length)).toEqual(originalLog)
        const modelText = JSON.stringify(agent.session.deriveMessages())
        expect(modelText).toContain(prompt)
        expect(modelText).not.toContain(`Original prompt ${turns}`)
        expect(modelText).not.toContain(`Original reply ${turns}`)
        await expect.poll(() => composer.innerText()).toBe('saved draft')
        if (prompt === REVISED) {
          await expect.poll(() => pencil.getAttribute('aria-disabled')).toBeNull()
          await pencil.click()
          await banner.waitFor()
        }
      }
      expect(await page.getByText(REVISED, { exact: true }).count()).toBe(0)
      await page.reload({ waitUntil: 'load' })
      await expect.poll(() => page.getByText('EDITED-AGAIN-REPLY', { exact: true }).count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByText(`Original prompt ${turns}`, { exact: true }).count()).toBe(0)
      expect(await page.getByText(REVISED, { exact: true }).count()).toBe(0)
      expect(tripwire.pageErrors).toEqual([])
      await page.getByRole('button', { name: 'Select model, current DeepSeek-V4-Flash', exact: true }).waitFor()
      await expect.poll(() => page.locator('[data-dsh-motion-part="outgoing"]').count()).toBe(0)
      await page.screenshot({ path: join(replayDir, `same-session-${turns}.png`), fullPage: true })
      await page.setViewportSize({ width: 960, height: 640 })
      await page.screenshot({ path: join(replayDir, `same-session-${turns}-narrow.png`), fullPage: true })
      console.log('Message-edit screenshots:', replayDir)
    } catch (error) {
      failed = true
      await saveFailureShot(page, `web-e2e-message-edit-${turns}`)
      throw error
    } finally {
      await browser.close()
      try {
        await scaffold.close()
      } catch (error) {
        // A failed UI assertion may leave replay calls unused; retain the first failure.
        if (!failed) throw error
      }
    }
  }, 120_000)

  it.skipIf(MODE === 'record')('removes every failed-turn artifact when the edited prompt is resent', async () => {
    const failedPrompt = 'Read failed-turn-only.txt and explain its contents.'
    const revisedPrompt = 'Do not read the file. Answer with RECOVERED instead.'
    const oldReasoning = 'Thinking about the request that will fail.'
    const oldResponse = 'This response belongs only to the failed request.'
    const oldPartial = 'Quota interrupted this old partial analysis.'
    const oldToolResult = 'This tool result belongs only to the failed request.'
    const recoveredReply = 'RECOVERED: the replacement request succeeded.'
    const callId = ToolCallId('message-edit-failed-read')
    const argumentsJson = JSON.stringify({ file_path: 'failed-turn-only.txt' })
    const replayDir = await mkdtemp(join(tmpdir(), 'dsh-message-edit-quota-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    const toolChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: oldReasoning },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: oldReasoning } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: oldResponse },
      { type: 'block-end', index: 1, block: { type: 'text', text: oldResponse } },
      { type: 'block-start', index: 2, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 2, id: callId, name: 'read', argumentsDelta: argumentsJson },
      { type: 'block-end', index: 2, block: { type: 'tool-call', id: callId, name: 'read', arguments: argumentsJson } },
      { type: 'usage', usage: { inputTokens: 64, outputTokens: 24 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    const replay: ReplayOverrideDoc = [
      { kind: 'chunks', chunks: toolChunks },
      {
        kind: 'throw', code: 'QUOTA', message: 'Provider quota exhausted', chunks: [
          { type: 'block-start', index: 0, blockType: 'reasoning' },
          ...[...oldPartial].map(text => ({ type: 'reasoning-delta' as const, index: 0, text })),
          { type: 'block-end', index: 0, block: { type: 'reasoning', text: oldPartial } },
        ],
      },
      // Incremental recovery exposes the committed edit before its reply settles.
      { kind: 'chunks', chunks: textChunks(recoveredReply, [...recoveredReply]) },
    ]
    await writeFile(replayOverride, JSON.stringify(replay))
    const scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'), replayOverride, paceMs: 40,
    })
    const browser = await chromium.launch({ executablePath: process.env.DSH_TEST_CHROMIUM_PATH })
    const page = await newEnglishPage(browser)
    const id = SessionId('message-edit-quota-web-e2e')
    const shots = {
      before: join(replayDir, 'failed-turn.png'),
      running: join(replayDir, 'edited-running.png'),
      after: join(replayDir, 'edited-success.png'),
      reload: join(replayDir, 'edited-reloaded.png'),
    }
    let failed = false
    try {
      await page.setViewportSize({ width: 1280, height: 900 })
      await writeFile(join(scaffold.workspaceCwd, 'failed-turn-only.txt'), oldToolResult)
      await seedSession(scaffold, seed(1), id)
      const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
      await workspace.attachSession(id)
      const model = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
      await scaffold.ctx.sessionController.selectModel({ sessionId: id, ...model })
      await scaffold.ctx.sessionController.rename({ sessionId: id, title: 'Failed-turn message edit' })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-phase="hero"] [data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
      const group = page.locator(`[data-row-key="workspace:${workspace.id}"]`)
      await group.waitFor({ timeout: 30_000 })
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      await expect.poll(() => group.getAttribute('aria-expanded')).toBe('true')
      await page.locator(`[data-row-key="session:${id}"]`).click()
      await page.getByText('Original reply 1', { exact: true }).waitFor({ timeout: 20_000 })
      const count = await page.getByRole('treeitem').count()
      const url = page.url()
      const composer = page.locator('[data-composer-input]')
      const notice = page.getByRole('alert').filter({ hasText: 'Request quota exhausted.' })
      const failure = page.getByRole('status').filter({ hasText: 'QUOTA' })
      const failedTurn = page.locator('[data-chat-turn="2"]')
      const tool = page.locator(`[data-chat-call-id="${callId}"] [data-tool="read"]`)
      const failedSettled = scaffold.whenTurnSettled()
      await composer.fill(failedPrompt)
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await expandOwningTurnProcess(page, tool)
      await expect.poll(() => tool.getAttribute('data-state')).toBe('ok')
      await tool.getByRole('button', { expanded: false }).first().click()
      await expect.poll(() => tool.textContent()).toContain(oldToolResult)
      expect(await failedSettled).toBe(id)
      await notice.waitFor({ timeout: 10_000 })
      await failure.waitFor({ timeout: 10_000 })
      expect(await failure.textContent()).toContain('Request quota exhausted.')
      expect(await failedTurn.allTextContents()).toEqual(expect.arrayContaining([
        expect.stringContaining(oldReasoning), expect.stringContaining(oldResponse),
      ]))
      const agent = scaffold.ctx.agents.get(id)!
      const header = agent.session.header
      const failedLog = agent.session.snapshotEvents()
      expect(JSON.stringify(failedLog)).toContain(oldPartial)
      const agentIds = scaffold.ctx.agents.list().map(current => current.id).sort()
      await page.screenshot({ path: shots.before, fullPage: true })

      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.locator('[data-edit-session]').waitFor()
      await expect.poll(() => composer.innerText()).toBe(failedPrompt)
      await composer.fill(revisedPrompt)
      const recoveredSettled = scaffold.whenTurnSettled()
      expect(await notice.isVisible()).toBe(true)
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await page.getByText(revisedPrompt, { exact: true }).waitFor({ timeout: 10_000 })
      const assertRemoved = async () => {
        expect(await failedTurn.count()).toBe(0)
        expect(await tool.count()).toBe(0)
        expect(await failure.count()).toBe(0)
        expect(await notice.count()).toBe(0)
        const body = await page.locator('body').textContent()
        for (const marker of [failedPrompt, oldReasoning, oldResponse, oldPartial, oldToolResult]) {
          expect(body).not.toContain(marker)
        }
        expect(await page.getByText('Original prompt 1', { exact: true }).count()).toBe(1)
        expect(await page.getByText('Original reply 1', { exact: true }).count()).toBe(1)
        expect(await page.getByText(revisedPrompt, { exact: true }).count()).toBe(1)
        expect(await page.getByRole('treeitem').count()).toBe(count)
        expect(page.url()).toBe(url)
      }
      await assertRemoved()
      expect(await page.getByText(recoveredReply, { exact: true }).count()).toBe(0)
      await page.getByRole('status').filter({ hasText: 'Deep diving' }).waitFor({ timeout: 5_000 })
      await page.screenshot({ path: shots.running, fullPage: true })
      expect(await recoveredSettled).toBe(id)
      await page.getByText(recoveredReply, { exact: true }).waitFor({ timeout: 10_000 })
      await assertRemoved()
      expect(scaffold.ctx.agents.list().map(current => current.id).sort()).toEqual(agentIds)
      expect(agent.session.header).toEqual(header)
      expect(agent.session.snapshotEvents().slice(0, failedLog.length)).toEqual(failedLog)
      const request = agent.session.snapshotEvents().findLast(event => event.type === 'request/header')
      expect(request?.data.header.config).toMatchObject(model)
      const modelText = JSON.stringify(agent.session.deriveMessages())
      for (const marker of [failedPrompt, oldReasoning, oldResponse, oldPartial, oldToolResult, callId]) {
        expect(modelText).not.toContain(marker)
      }
      expect(modelText).toContain(revisedPrompt)
      expect(modelText).toContain('Original reply 1')
      await page.screenshot({ path: shots.after, fullPage: true })

      await page.reload({ waitUntil: 'load' })
      await page.getByText(recoveredReply, { exact: true }).waitFor({ timeout: 20_000 })
      await assertRemoved()
      expect(tripwire.pageErrors).toEqual([])
      await page.screenshot({ path: shots.reload, fullPage: true })
      console.log('Message-edit failed-turn screenshots:', JSON.stringify(shots))
    } catch (error) {
      failed = true
      await saveFailureShot(page, 'web-e2e-message-edit-quota')
      throw error
    } finally {
      await browser.close()
      try {
        await scaffold.close()
      } catch (error) {
        if (!failed) throw error
      }
    }
  }, 120_000)
})
