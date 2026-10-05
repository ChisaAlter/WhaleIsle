import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { selectChecks } from './ci-scope.mjs'

test('DSH component source uses its own native workflow without Harness regression builds', () => {
  assert.deepEqual(selectChecks(['vendor/whalebridge/main.go', 'scripts/build-whalebridge.mjs', '.github/workflows/whalebridge.yml']),
    { product: false, vendor: false, tools: false, motion: false })
  assert.equal(selectChecks(['src/main/ipc-components.js']).product, true)
})

test('documentation and retired governance records do not build the product', () => {
  assert.deepEqual(selectChecks(['docs/features/remote.md', 'AGENTS.md', 'README.i18n.yaml', 'vendor/deepseek-harness/docs/testing.md', '.github/pull_request_template.md']),
    { product: false, tools: false, vendor: false, motion: false })
})
test('desktop code gets product checks without the upstream matrix', () => {
  assert.deepEqual(selectChecks(['src/main/update.js']),
    { product: true, tools: false, vendor: false, motion: false })
})
test('upstream runtime, lock and native window changes select their actual consumers', () => {
  assert.equal(selectChecks(['vendor/deepseek-harness/packages/core/session/src/index.ts']).vendor, true)
  assert.equal(selectChecks(['package-lock.json']).tools, true)
  assert.equal(selectChecks(['package-lock.json']).product, true)
  assert.equal(selectChecks(['src/main/native-window-motion.js']).motion, true)
  assert.equal(selectChecks(['src/main/update.test.js']).product, true)
})
test('tool test edits run independently and manual builds have full scope', () => {
  assert.deepEqual(selectChecks(['scripts/release-download.test.mjs', 'scripts/verify-md-links.mjs', 'scripts/publish-release.mjs']),
    { product: false, tools: true, vendor: false, motion: false })
  assert.ok(Object.values(selectChecks([], { manual: true })).every(Boolean))
})
test('development CI produces assets; release has no rebuild and no PR trigger', () => {
  const ci = load(readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8'))
  const release = load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'))
  assert.ok(Object.hasOwn(ci.on, 'pull_request'))
  assert.deepEqual(ci.on.push.branches, ['main'])
  const commands = ci.jobs.windows.steps.map(s => s.run)
  assert.ok(commands.indexOf('npm run dist') < commands.indexOf('npm run smoke:packaged'))
  const upload = ci.jobs.windows.steps.find(s => s.with?.name === 'Whale-Isle-windows-x64')
  assert.equal(upload.with['if-no-files-found'], 'error')
  assert.ok(release.on.workflow_run.workflows.includes(ci.name))
  assert.deepEqual(release.on.workflow_run.branches, ['main'])
  assert.equal(release.on.pull_request, undefined)
  assert.ok(release.jobs.publish.steps.some(s => s.run === 'node scripts/publish-release.mjs'))
  assert.ok(!release.jobs.publish.steps.some(s => /npm (test|run (dist|setup:harness))/.test(s.run || '')))
})
