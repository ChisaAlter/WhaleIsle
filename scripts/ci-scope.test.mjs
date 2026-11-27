import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as load } from 'yaml'
import { applyReleaseScope, selectChecks, versionChanged } from './ci-scope.mjs'

test('desktop IPC changes select product and tools checks', () => {
  assert.equal(selectChecks(['src/main/ipc-components.js']).product, true)
  assert.equal(selectChecks(['src/main/ipc-components.js']).tools, true)
})

test('documentation and retired governance records do not build the product', () => {
  assert.deepEqual(selectChecks(['docs/features/remote.md', 'AGENTS.md', 'README.i18n.yaml', 'vendor/deepseek-harness/docs/testing.md', '.github/pull_request_template.md']),
    { product: false, harness: false, vendor_plugins: false, whale_web: false, tools: false, motion: false })
})
test('desktop code gets product and typecheck checks without the upstream matrix', () => {
  assert.deepEqual(selectChecks(['src/main/update.js']),
    { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: false })
  assert.deepEqual(selectChecks(['src/launcher/components/index.js', 'src/main/update.test.js']),
    { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: false })
})
test('relocated ACP source and tests retain plugin checks while its docs stay lightweight', () => {
  for (const file of ['dsh-acp/lib/index.js', 'dsh-acp/tests/plugin.test.mjs']) {
    assert.deepEqual(selectChecks([file]), { product: true, harness: false, vendor_plugins: true, whale_web: false, tools: false, motion: false })
  }
  assert.deepEqual(selectChecks(['dsh-acp/README.md']),
    { product: false, harness: false, vendor_plugins: false, whale_web: false, tools: false, motion: false })
})
test('upstream runtime, lock and native window changes select their actual consumers', () => {
  assert.equal(selectChecks(['vendor/deepseek-harness/packages/core/session/src/index.ts']).harness, true)
  assert.equal(selectChecks(['package-lock.json']).tools, true)
  assert.equal(selectChecks(['package-lock.json']).product, true)
  assert.equal(selectChecks(['src/main/native-window-motion.js']).motion, true)
  assert.equal(selectChecks(['src/main/update.test.js']).product, true)
})
test('18-row truth table routes harness, vendor_plugins, whale_web, native motion and root manifests accurately', () => {
  const cases = [
    ['docs/** markdown', ['docs/features/remote.md'], { product: false, harness: false, vendor_plugins: false, whale_web: false, tools: false, motion: false }],
    ['AGENTS.md', ['AGENTS.md'], { product: false, harness: false, vendor_plugins: false, whale_web: false, tools: false, motion: false }],
    ['plugin README.md', ['vendor/dsh-whale/README.md'], { product: false, harness: false, vendor_plugins: false, whale_web: false, tools: false, motion: false }],
    ['src/main/update.js', ['src/main/update.js'], { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: false }],
    ['src/native/window-acrylic.cpp', ['src/native/window-acrylic.cpp'], { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: false, motion: true }],
    ['scripts/build-window-acrylic.cjs', ['scripts/build-window-acrylic.cjs'], { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: true }],
    ['root package.json', ['package.json'], { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: true }],
    ['root package-lock.json', ['package-lock.json'], { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: true }],
    ['.nvmrc', ['.nvmrc'], { product: true, harness: true, vendor_plugins: false, whale_web: true, tools: true, motion: false }],
    ['deepseek-harness source', ['vendor/deepseek-harness/packages/core/session/src/index.ts'], { product: true, harness: true, vendor_plugins: false, whale_web: true, tools: true, motion: true }],
    ['vendor/harness-upstream.json', ['vendor/harness-upstream.json'], { product: true, harness: true, vendor_plugins: false, whale_web: true, tools: true, motion: false }],
    ['src/shared/harness-desktop-forks.js', ['src/shared/harness-desktop-forks.js'], { product: true, harness: true, vendor_plugins: false, whale_web: true, tools: true, motion: false }],
    ['vendor/dsh-whale client tsx', ['vendor/dsh-whale/src/client/BotSidebarCard.tsx'], { product: true, harness: false, vendor_plugins: true, whale_web: true, tools: true, motion: false }],
    ['vendor/dsh-project/lib/runner.js', ['vendor/dsh-project/lib/runner.js'], { product: true, harness: false, vendor_plugins: true, whale_web: false, tools: true, motion: false }],
    ['vendor/dsh-im/src/index.js', ['vendor/dsh-im/src/index.js'], { product: true, harness: false, vendor_plugins: true, whale_web: false, tools: true, motion: false }],
    ['vendor/chisacode-remote server ts', ['vendor/chisacode-remote/packages/server/src/index.ts'], { product: true, harness: false, vendor_plugins: true, whale_web: false, tools: true, motion: false }],
    ['dsh-acp/lib/index.js', ['dsh-acp/lib/index.js'], { product: true, harness: false, vendor_plugins: true, whale_web: false, tools: false, motion: false }],
    ['scripts/setup-harness.js', ['scripts/setup-harness.js'], { product: true, harness: true, vendor_plugins: false, whale_web: true, tools: true, motion: false }],
  ]
  for (const [label, files, expected] of cases) {
    assert.deepEqual(selectChecks(files), expected, label)
  }
  assert.ok(Object.values(selectChecks([], { manual: true })).every(Boolean))
  const rel = applyReleaseScope(selectChecks(['src/main/update.js']), true)
  assert.deepEqual({ harness: rel.harness, whale_web: rel.whale_web, motion: rel.motion, release: rel.release },
    { harness: true, whale_web: true, motion: true, release: true })
})
test('vendor content changes gate the tools job that runs the provenance check', () => {
  assert.equal(selectChecks(['vendor/dsh-pad/lib/index.js']).tools, true)
  assert.equal(selectChecks(['vendor/provenance.json']).tools, true)
  const ci = load(readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8'))
  assert.ok(ci.jobs.tools.steps.some(s => s.run === 'npm run check:vendor'))
})
test('registered generated artifacts and their inputs gate the tools job', () => {
  for (const file of [
    'mobile/web/chisacode/entry.mjs',
    'mobile/web/chisacode/daemon-client.bundle.js',
    'src/renderer/welcome/welcome.js',
    'assets/icon.svg',
    'dsh-acp/tools/runtime-build/entry.ts',
    'dsh-acp/client-src/index.js',
    'dsh-acp/client/client.js',
  ]) {
    assert.equal(selectChecks([file]).tools, true, file)
  }
  const ci = load(readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8'))
  assert.ok(ci.jobs.tools.steps.some(s => s.run === 'npm run check:generated'))
})
test('lint config and its suppression ledger select product and tools checks', () => {
  assert.deepEqual(selectChecks(['eslint.config.mjs']),
    { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: false })
  assert.deepEqual(selectChecks(['eslint-suppressions.json']),
    { product: true, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: false })
})
test('tool test edits run independently and manual builds have full scope', () => {
  assert.deepEqual(selectChecks(['scripts/release-download.test.mjs', 'scripts/verify-md-links.mjs', 'scripts/lib/cnb-client.mjs', 'scripts/publish-release.mjs', 'scripts/publish-macos-supplement.mjs', 'scripts/sync-magpie-cnb.mjs', '.github/workflows/cnb-mirror.yml', '.github/workflows/magpie-cnb-mirror.yml']),
    { product: false, harness: false, vendor_plugins: false, whale_web: false, tools: true, motion: false })
  assert.ok(Object.values(selectChecks([], { manual: true })).every(Boolean))
})
test('the main push that bumps the version also builds the macOS installer', () => {
  assert.equal(versionChanged('{"version":"0.3.14"}', '{"version":"0.3.15"}'), true)
  assert.equal(versionChanged('{"version":"0.3.14","a":1}', '{"version":"0.3.14","a":2}'), false)
  const raw = readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8')
  const ci = load(raw)
  assert.equal(/needs\.scope\.outputs\.vendor\b/.test(raw), false, 'stale scope.outputs.vendor must be removed')
  assert.deepEqual(Object.keys(ci.jobs.scope.outputs).sort(), [...Object.keys(selectChecks([])), 'release'].sort())
  assert.equal(ci.jobs.scope.outputs.release, '${{ steps.changes.outputs.release }}')
  assert.equal(ci.jobs.macos.needs, 'scope')
  assert.match(ci.jobs.macos.if, /needs\.scope\.outputs\.release == 'true'/)
  assert.match(ci.jobs.macos.if, /github\.event_name == 'workflow_dispatch' && inputs\.include_macos/)
  assert.equal(ci.jobs.result.name, 'CI')
  for (const jobName of Object.keys(ci.jobs)) {
    if (jobName === 'result') continue
    assert.ok(ci.jobs.result.needs.includes(jobName), `result.needs missing ${jobName}`)
  }
})
test('Linux and macOS lanes run the product behavior tests and gate CI', () => {
  const ci = load(readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8'))
  for (const [name, runner] of [['linux-tests', 'ubuntu-latest'], ['macos-tests', 'macos-latest']]) {
    const job = ci.jobs[name]
    assert.equal(job['runs-on'], runner)
    assert.equal(job.needs, 'scope')
    assert.equal(job.if, "needs.scope.outputs.product == 'true'")
    assert.ok(job.steps.some(s => /npm test$/.test(s.run || '')))
    assert.ok(ci.jobs.result.needs.includes(name))
  }
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
