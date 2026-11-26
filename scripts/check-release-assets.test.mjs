// Tests for scripts/check-release-assets.mjs.
//
// Every case builds a synthetic asset directory (fake Setup bytes, fake
// blockmap, generated latest.yml) — no real installer is ever read. These
// tests import the SAME exported validator the workflow invokes; there is no
// duplicated verification logic here.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  METADATA_NAME,
  MAX_METADATA_BYTES,
  ReleaseAssetError,
  SETUP_PREFIX,
  SETUP_SUFFIX,
  validateReleaseAssets,
} from './check-release-assets.mjs'
import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VERSION = '0.3.2'
const TAG = `v${VERSION}`
const SETUP_NAME = `${SETUP_PREFIX}${VERSION}${SETUP_SUFFIX}`
const BLOCKMAP_NAME = `${SETUP_NAME}.blockmap`
const DEFAULT_SETUP_BYTES = Buffer.from('synthetic-installer-bytes')
/** Marker file a mutation fixture writes when the operator digest must differ. */
const EXPECTED_DIGEST_NAME = '.expected-setup-digest'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha512 = (bytes) => createHash('sha512').update(bytes).digest('base64')

/**
 * Minimal v26 `latest.yml` renderer (generic provider): version, files[],
 * legacy path/sha512, releaseDate. Pass `omitLegacy` to drop the deprecated
 * pair, which electron-updater still accepts.
 */
function renderMetadata({
  setupBytes = DEFAULT_SETUP_BYTES,
  version = VERSION,
  url = SETUP_NAME,
  sha,
  size,
  omitLegacy = false,
  extraEntries = [],
  extraLines = [],
} = {}) {
  const sums = {
    sha512: sha ?? sha512(setupBytes),
    size: size ?? setupBytes.length,
  }
  const lines = [
    `version: ${version}`,
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sums.sha512}`,
    `    size: ${sums.size}`,
  ]
  for (const entry of extraEntries) {
    lines.push(`  - url: ${entry.url}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`)
  }
  if (!omitLegacy) {
    lines.push(`path: ${url}`, `sha512: ${sums.sha512}`)
  }
  lines.push('releaseDate: 2026-09-20T00:00:00.000Z', ...extraLines)
  return `${lines.join('\n')}\n`
}

/** Create a throwaway asset directory; auto-removed when the test ends. */
function createFixture(t, { setupBytes = DEFAULT_SETUP_BYTES, metadata = renderMetadata({ setupBytes }), blockmapName = BLOCKMAP_NAME, blockmapBytes = Buffer.from('synthetic-blockmap') } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshd-release-assets-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, SETUP_NAME), setupBytes)
  if (blockmapName) writeFileSync(path.join(dir, blockmapName), blockmapBytes)
  if (metadata !== null) writeFileSync(path.join(dir, METADATA_NAME), metadata)
  return {
    dir,
    setupBytes,
    digest: sha256(setupBytes),
    write: (name, contents) => writeFileSync(path.join(dir, name), contents),
    remove: (name) => rmSync(path.join(dir, name), { force: true }),
    replace: (name, contents) => {
      rmSync(path.join(dir, name), { force: true, recursive: true })
      writeFileSync(path.join(dir, name), contents)
    },
  }
}

/** Read the current Setup so a mutated fixture still validates its own bytes. */
function digestOf(dir) {
  return sha256(readFileSync(path.join(dir, SETUP_NAME)))
}

/**
 * Validate a fixture. The digest defaults to `fallbackDigest` so tests that
 * delete or corrupt the Setup do not read it back first.
 */
function validate(dir, { fallbackDigest = sha256(DEFAULT_SETUP_BYTES), ...overrides } = {}) {
  return validateReleaseAssets({
    assetDir: dir,
    releaseTag: TAG,
    packageVersion: VERSION,
    expectedSetupSha256: overrides.expectedSetupSha256 ?? safeDigestOf(dir, fallbackDigest),
    ...overrides,
  })
}

function safeDigestOf(dir, fallback) {
  try {
    return digestOf(dir)
  } catch {
    return fallback
  }
}

async function rejects(fn, pattern) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof ReleaseAssetError, `expected ReleaseAssetError, got ${error}`)
    assert.match(error.message, pattern)
    return true
  })
}

/**
 * The mutation harness. A guard is proven discriminating by copying the
 * validator OUTSIDE the checkout, disabling exactly that guard, and confirming
 * the mutated copy then ACCEPTS the fixture the shipped validator rejects.
 * Without this, a test could pass for the wrong reason (the rejection could
 * come from an unrelated later check).
 *
 * `buildFixture(dir, { invalid })` fills two directories: `validDir` gets a
 * completely well-formed asset set (the shipped validator must accept it, so a
 * later "ACCEPTED" cannot just mean the driver accepts everything) and
 * `invalidDir` gets the defect under test. The shipped validator must reject
 * `invalidDir` with `expectMessage`, and the mutated copy must then ACCEPT it.
 * That reversal is the whole proof: it shows this guard — not an unrelated
 * later check — is what rejected the defect, so deleting the guard would make
 * the suite fail.
 *
 * A fixture may write `EXPECTED_DIGEST_NAME` into its directory to declare the
 * operator-supplied digest explicitly (the SHA256 case needs a digest that does
 * NOT match the bytes on disk); otherwise the Setup's own digest is used.
 *
 * The scratch copies are deleted by the test's own cleanup hook; nothing inside
 * the checkout is written.
 */
function proveGuardDiscriminates(t, {
  mutations,
  buildFixture,
  expectMessage,
}) {
  const source = fileURLToPath(new URL('./check-release-assets.mjs', import.meta.url))
  const raw = readFileSync(source, 'utf8')
  for (const { before } of mutations) {
    assert.ok(
      raw.includes(before),
      `mutation anchor not found in the validator; the guard was refactored and this proof must be updated: ${before}`,
    )
  }
  // The scratch copy lives outside the checkout, so the bare `yaml`
  // specifier no longer resolves. Rewrite ONLY that specifier to an absolute
  // file URL so the mutated copy tests the same guard against the same parser;
  // assert the rewrite happened exactly once so it cannot silently no-op.
  const YAML_IMPORT = "from 'yaml'"
  assert.equal(
    raw.split(YAML_IMPORT).length - 1,
    1,
    'expected exactly one bare yaml import to rewrite',
  )
  const scratch = mkdtempSync(path.join(tmpdir(), 'dshd-release-mutation-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const yamlEntry = fileURLToPath(import.meta.resolve
    ? new URL(import.meta.resolve('yaml'))
    : path.join(process.cwd(), 'node_modules', 'yaml', 'dist', 'index.js'))
  const rewritten = raw
    .split(YAML_IMPORT)
    .join(`from ${JSON.stringify(pathToFileURL(yamlEntry).href)}`)
  const mutatedPath = path.join(scratch, 'check-release-assets.mutated.mjs')
  const controlPath = path.join(scratch, 'check-release-assets.control.mjs')
  writeFileSync(controlPath, rewritten)
  let mutatedSource = rewritten
  for (const { before, after } of mutations) {
    mutatedSource = mutatedSource.split(before).join(after)
  }
  assert.notEqual(mutatedSource, rewritten, 'no mutation was actually applied')
  writeFileSync(mutatedPath, mutatedSource)

  // Two independent fixtures: the well-formed control, and the defective set
  // whose rejection must be attributable to the disabled guard.
  const validDir = mkdtempSync(path.join(scratch, 'valid-'))
  t.after(() => rmSync(validDir, { recursive: true, force: true }))
  const invalidDir = mkdtempSync(path.join(scratch, 'invalid-'))
  t.after(() => rmSync(invalidDir, { recursive: true, force: true }))
  buildFixture(validDir)
  buildFixture(invalidDir, { invalid: true })

  // The copied validator sets `process.exitCode = 1` from its own `main()` when
  // it thinks it is the entry script. Importing it from a driver keeps
  // `process.argv[1]` pointing at the driver, so only the exported validator
  // runs and the driver owns the exit code.
  const driverPath = path.join(scratch, 'driver.mjs')
  writeFileSync(driverPath, [
    "import * as control from './check-release-assets.control.mjs'",
    "import * as mutated from './check-release-assets.mutated.mjs'",
    'const [, , which, assetDir, tag, version, digest] = process.argv',
    'const mod = which === "control" ? control : mutated',
    'mod.validateReleaseAssets({ assetDir, releaseTag: tag, packageVersion: version, expectedSetupSha256: digest })',
    "  .then((result) => { process.stdout.write(`ACCEPTED:${result.setupName}\\n`) })",
    "  .catch((error) => { process.stdout.write(`REJECTED:${error.message}\\n`) })",
    '',
  ].join('\n'))

  const run = (which, dir) => spawnSync(
    process.execPath,
    [driverPath, which, dir, TAG, VERSION, digestFor(dir)],
    { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
  )
  const digestFor = (dir) => {
    const declared = path.join(dir, EXPECTED_DIGEST_NAME)
    if (existsSync(declared)) return readFileSync(declared, 'utf8').trim()
    return sha256(readFileSync(path.join(dir, SETUP_NAME)))
  }

  // Sanity: the shipped validation ACCEPTS the well-formed set, so the mutated
  // "ACCEPTED" below cannot be explained by the fixture being malformed in a way
  // the driver ignores.
  const controlValid = run('control', validDir)
  assert.equal(controlValid.status, 0, `control driver crashed: ${controlValid.stderr}`)
  assert.match(controlValid.stdout, /^ACCEPTED/, `the shipped validator rejected a valid fixture: ${controlValid.stdout}`)

  // The defect under test must be rejected by the SHIPPED validator, with the
  // expected reason — otherwise the fixture does not exercise this guard.
  const controlInvalid = run('control', invalidDir)
  assert.equal(controlInvalid.status, 0, `control driver crashed: ${controlInvalid.stderr}`)
  assert.match(
    controlInvalid.stdout,
    /^REJECTED:/,
    `the shipped validator unexpectedly accepted the defective fixture: ${controlInvalid.stdout}`,
  )
  assert.match(controlInvalid.stdout, expectMessage)

  // The mutated copy must now ACCEPT the defective set. If it still rejects, the
  // rejection came from somewhere else and this fixture does not prove anything
  // about the guard named in the mutation.
  const mutatedInvalid = run('mutated', invalidDir)
  assert.equal(mutatedInvalid.status, 0, `mutated driver crashed: ${mutatedInvalid.stderr}`)
  assert.match(
    mutatedInvalid.stdout,
    /^ACCEPTED/,
    `disabling the guard did not change the outcome, so the fixture is caught by a different check: ${mutatedInvalid.stdout}`,
  )
}

test('accepts a valid v26 generic-provider asset set', async (t) => {
  const f = createFixture(t)
  const result = await validate(f.dir)
  assert.equal(result.setupName, SETUP_NAME)
  assert.equal(result.blockmapName, BLOCKMAP_NAME)
  assert.equal(result.version, VERSION)
  assert.equal(result.releaseTag, TAG)
  assert.equal(result.size, f.setupBytes.length)
  assert.equal(result.sha256, f.digest)
  assert.equal(result.sha512, sha512(f.setupBytes))
})

test('permits metadata without the legacy path/sha512 pair', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ omitLegacy: true }) })
  const result = await validate(f.dir)
  assert.equal(result.setupName, SETUP_NAME)
})

test('rejects a Setup SHA256 that differs from the supplied digest', async (t) => {
  const f = createFixture(t)
  await rejects(validate(f.dir, { expectedSetupSha256: '0'.repeat(64) }), /SHA256/)
})

test('rejects a metadata byte size that differs from the Setup', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ size: DEFAULT_SETUP_BYTES.length + 1 }) })
  await rejects(validate(f.dir), /size/)
})

test('rejects a metadata version that differs from the package version', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ version: '9.9.9' }) })
  await rejects(validate(f.dir), /version/)
})

test('rejects a release tag that does not match the package version', async (t) => {
  const f = createFixture(t)
  await rejects(validate(f.dir, { releaseTag: 'v9.9.9' }), /does not match/)
})

test('rejects a metadata sha512 that differs from the Setup bytes', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ sha: sha512(Buffer.from('other')) }) })
  await rejects(validate(f.dir), /SHA512/)
})

test('rejects a stale/mismatched blockmap stem', async (t) => {
  const f = createFixture(t, { blockmapName: `${SETUP_PREFIX}0.3.1${SETUP_SUFFIX}.blockmap` })
  await rejects(validate(f.dir), /blockmap/)
})

test('rejects duplicate Setup executables', async (t) => {
  const f = createFixture(t)
  f.write(`${SETUP_PREFIX}${VERSION}-x64${SETUP_SUFFIX}`, Buffer.from('other'))
  await rejects(validate(f.dir), /duplicate\/conflicting Windows Setup executable candidate names/)
})

test('rejects duplicated YAML mapping keys', async (t) => {
  const yaml = renderMetadata().replace(`version: ${VERSION}\n`, `version: ${VERSION}\nversion: ${VERSION}\n`)
  const f = createFixture(t, { metadata: yaml })
  await rejects(validate(f.dir), /parse|duplicated|unique/i)
})

test('rejects custom tags, YAML 1.1 extra tags, and coerced duplicate keys', async (t) => {
  for (const extra of [
    'notes: !evil payload',
    'notes: !!js/function "function(){return 1}"',
    'extraDate: !!timestamp 2026-09-20',
    '1: first\n"1": second',
  ]) {
    const f = createFixture(t, { metadata: `${renderMetadata()}${extra}\n` })
    await rejects(validate(f.dir), /parse|tag|unique|duplicate/i)
  }
})

test('rejects malformed YAML', async (t) => {
  const f = createFixture(t, { metadata: 'version: [unclosed\nfiles: nope\n' })
  await rejects(validate(f.dir), /parse/)
})

test('rejects a wrong metadata type for files[]', async (t) => {
  const f = createFixture(t, { metadata: `version: ${VERSION}\nfiles: not-an-array\n` })
  await rejects(validate(f.dir), /files/)
})

test('rejects a non-mapping files[] entry', async (t) => {
  const f = createFixture(t, {
    metadata: `version: ${VERSION}\nfiles:\n  - scalar-entry\n`,
  })
  await rejects(validate(f.dir), /mappings/)
})

test('rejects a contradictory legacy sha512', async (t) => {
  const yaml = renderMetadata().replace(`path: ${SETUP_NAME}\nsha512: `, `path: ${SETUP_NAME}\nsha512: ${sha512(Buffer.from('other'))}\nlegacyIgnored: `)
  // The replacement above keeps a syntactically valid line; assert on the
  // result to be sure the fixture really carries a contradictory value.
  assert.notEqual(yaml, renderMetadata())
  const f = createFixture(t, { metadata: yaml })
  await rejects(validate(f.dir), /contradicts|SHA512/)
})

test('rejects a contradictory legacy path', async (t) => {
  const yaml = renderMetadata().replace(`path: ${SETUP_NAME}`, `path: ${SETUP_NAME}0`)
  const f = createFixture(t, { metadata: yaml })
  await rejects(validate(f.dir), /contradicts|references/)
})

test('rejects path traversal in the metadata URL', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ url: `../${SETUP_NAME}` }) })
  await rejects(validate(f.dir), /traverse|unexpected asset|references/)
})

test('rejects an unexpected executable reference', async (t) => {
  const f = createFixture(t, {
    metadata: renderMetadata({
      extraEntries: [
        { url: `${SETUP_PREFIX}${VERSION}-evil${SETUP_SUFFIX}`, sha512: sha512(Buffer.from('evil')), size: 4 },
      ],
    }),
  })
  await rejects(validate(f.dir), /unexpected asset|exactly one Setup/)
})

test('rejects a remote URL in the metadata', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ url: `https://example.com/${SETUP_NAME}` }) })
  await rejects(validate(f.dir), /remote|absolute|local|references/)
})

test('rejects an absolute URL in the metadata', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ url: `/${SETUP_NAME}` }) })
  await rejects(validate(f.dir), /remote|absolute|local|references/)
})

test('rejects percent-encoded traversal in a URL', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata({ url: `..%2F${SETUP_NAME}` }) })
  await rejects(validate(f.dir), /percent|traverse|local|references|unexpected asset/)
})

test('rejects oversized metadata', async (t) => {
  const padding = 'x'.repeat(MAX_METADATA_BYTES)
  const f = createFixture(t, { metadata: `${renderMetadata()}releaseNotes: ${padding}\n` })
  await rejects(validate(f.dir), /limit is/)
})

test('rejects a missing Setup file', async (t) => {
  const f = createFixture(t, { metadata: renderMetadata() })
  f.remove(SETUP_NAME)
  await rejects(validate(f.dir, { expectedSetupSha256: '0'.repeat(64) }), /Setup/)
})

test('rejects a missing blockmap file', async (t) => {
  const f = createFixture(t, { blockmapName: null })
  await rejects(validate(f.dir), /blockmap/)
})

test('rejects a missing latest.yml file', async (t) => {
  const f = createFixture(t, { metadata: null })
  await rejects(validate(f.dir), /latest\.yml/)
})

test('rejects a symlinked Setup executable', async (t) => {
  const f = createFixture(t)
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'dshd-release-target-'))
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }))
  const real = path.join(elsewhere, SETUP_NAME)
  writeFileSync(real, f.setupBytes)
  f.remove(SETUP_NAME)
  try {
    symlinkSync(real, path.join(f.dir, SETUP_NAME), 'file')
  } catch (error) {
    if (error.code === 'EPERM' && !process.env.CI && !process.env.GITHUB_ACTIONS) {
      t.skip('environment blocked: file symlink privilege unavailable; required to execute in CI')
      return
    }
    throw error
  }
  assert.equal(lstatSync(path.join(f.dir, SETUP_NAME)).isSymbolicLink(), true)
  await rejects(validate(f.dir), /exactly one Windows Setup|symlink|regular file/)
})

test('rejects a directory standing in for the metadata file', async (t) => {
  const f = createFixture(t, { metadata: null })
  mkdirSync(path.join(f.dir, METADATA_NAME))
  await rejects(validate(f.dir), /latest\.yml/)
})

test('rejects a directory standing in for the Setup executable', async (t) => {
  const f = createFixture(t)
  f.remove(SETUP_NAME)
  mkdirSync(path.join(f.dir, SETUP_NAME))
  await rejects(validate(f.dir, { expectedSetupSha256: '0'.repeat(64) }), /exactly one Windows Setup|regular file/)
})

test('rejects a read failure on the blockmap path (permission/type)', async (t) => {
  const f = createFixture(t)
  f.remove(BLOCKMAP_NAME)
  mkdirSync(path.join(f.dir, BLOCKMAP_NAME))
  await rejects(validate(f.dir), /blockmap/)
})

test('rejects a matching extra directory beside a valid asset set', async (t) => {
  const f = createFixture(t)
  mkdirSync(path.join(f.dir, `${SETUP_PREFIX}${VERSION}-extra${SETUP_SUFFIX}`))
  await rejects(validate(f.dir), /is not a regular file \(directory\).*matching release assets must be regular files/)
})

test('rejects a matching extra file symlink beside a valid asset set', async (t) => {
  const f = createFixture(t)
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'dshd-release-link-target-'))
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }))
  const target = path.join(elsewhere, SETUP_NAME)
  writeFileSync(target, f.setupBytes)
  const link = path.join(f.dir, `${SETUP_PREFIX}${VERSION}-link${SETUP_SUFFIX}`)
  try {
    symlinkSync(target, link, 'file')
  } catch (error) {
    if (error.code === 'EPERM' && !process.env.CI && !process.env.GITHUB_ACTIONS) {
      // An unexercised fixture is a SKIP, never a pass: `return` here would
      // report success for a check that never ran.
      t.skip(`file-symlink creation unavailable (EPERM): ${error.message}`)
      return
    }
    throw error
  }
  assert.equal(existsSync(link), true, 'file symlink must exist before asserting rejection')
  const linkInfo = lstatSync(link)
  assert.equal(linkInfo.isSymbolicLink(), true, 'created path must be a symlink before asserting rejection')
  await rejects(validate(f.dir), /is not a regular file \(symlink or junction\).*matching release assets must be regular files/)
})

test('rejects a matching dangling file symlink beside a valid asset set', async (t) => {
  const f = createFixture(t)
  const link = path.join(f.dir, `${SETUP_PREFIX}${VERSION}-dangling${SETUP_SUFFIX}`)
  try {
    symlinkSync(path.join(f.dir, 'missing-target'), link, 'file')
  } catch (error) {
    if (error.code === 'EPERM' && !process.env.CI && !process.env.GITHUB_ACTIONS) {
      t.skip(`dangling-symlink creation unavailable (EPERM): ${error.message}`)
      return
    }
    throw error
  }
  assert.equal(existsSync(link), false, 'a dangling link target must not exist')
  const linkInfo = lstatSync(link)
  assert.equal(linkInfo.isSymbolicLink(), true, 'created dangling path must be a symlink before asserting rejection')
  await rejects(validate(f.dir), /is not a regular file \(dangling symlink or junction\).*matching release assets must be regular files/)
})

test('rejects replacement of the installer or metadata after the initial verification', async (t) => {
  const f = createFixture(t)
  const first = await validate(f.dir)
  assert.equal(first.setupName, SETUP_NAME)

  // The promotion writes checksums into the Windows asset directory after the
  // first validation; the final re-validation must still accept that known
  // generated file while rejecting changes to the verified assets.
  writeFileSync(path.join(f.dir, 'SHA512SUMS.txt'), Buffer.from('generated after validation'))
  const afterChecksum = await validate(f.dir)
  assert.equal(afterChecksum.sha256, first.sha256)

  // Keep the byte length unchanged so this case reaches the hash comparison
  // rather than being rejected only by the metadata size check.
  const replacementBytes = Buffer.alloc(DEFAULT_SETUP_BYTES.length, 0x78)
  writeFileSync(path.join(f.dir, SETUP_NAME), replacementBytes)
  await rejects(validate(f.dir, { expectedSetupSha256: first.sha256 }), /SHA256|SHA512/)

  writeFileSync(path.join(f.dir, SETUP_NAME), f.setupBytes)
  const replacementMetadata = renderMetadata({ version: '9.9.9' })
  writeFileSync(path.join(f.dir, METADATA_NAME), replacementMetadata)
  await rejects(validate(f.dir), /version/)
})

/**
 * Write one asset directory. `invalid` selects the defect the calling mutation
 * test is about; a well-formed set is written otherwise.
 */
function writeMutationFixture(dir, { invalid, kind }) {
  const setupBytes = invalid && kind === 'sha256'
    ? Buffer.from('a-different-installer-payload')
    : DEFAULT_SETUP_BYTES
  let metadata = renderMetadata({
    setupBytes,
    ...(invalid && kind === 'sha512' ? { sha: sha512(Buffer.from('unrelated-bytes')) } : {}),
    ...(invalid && kind === 'size' ? { size: DEFAULT_SETUP_BYTES.length + 1 } : {}),
    ...(invalid && kind === 'entry-name'
      ? { url: `${SETUP_PREFIX}${VERSION}-other${SETUP_SUFFIX}` }
      : {}),
  })
  writeFileSync(path.join(dir, SETUP_NAME), setupBytes)
  writeFileSync(path.join(dir, BLOCKMAP_NAME), Buffer.from('synthetic-blockmap'))
  writeFileSync(path.join(dir, METADATA_NAME), metadata)
  metadata = null
  // The SHA256 case needs an operator digest that deliberately does NOT match
  // the bytes on disk; every other case uses the Setup's real digest.
  if (invalid && kind === 'sha256') {
    writeFileSync(path.join(dir, EXPECTED_DIGEST_NAME), sha256(DEFAULT_SETUP_BYTES))
  }
}

/**
 * Every entry here disables ONE guard in a scratch copy of the validator and
 * asserts that the copy then accepts a fixture the shipped validator rejects.
 * `alsoDisable` names additional guards that independently reject the same
 * fixture, so they must be disabled too before the proof is meaningful; leaving
 * them enabled would make the case pass for the wrong reason.
 */
const MUTATION_CASES = [
  {
    name: 'Setup SHA256 against the operator digest',
    kind: 'sha256',
    disable: [{ before: 'if (actualSha256 !== digest) {', after: 'if (false) {' }],
    expectMessage: /SHA256/,
  },
  {
    name: 'Setup SHA512 against the metadata entry',
    kind: 'sha512',
    disable: [{ before: 'if (actualSha512 !== entrySha512) {', after: 'if (false) {' }],
    expectMessage: /SHA512/,
  },
  {
    name: 'metadata files[].url against the local Setup name',
    kind: 'entry-name',
    disable: [
      { before: 'if (entryName !== setupName) {', after: 'if (false) {' },
      {
        // This one-line statement sits inside the files[] loop, so it is
        // disabled with `continue` rather than a dangling `if (false)`.
        before: 'if (name !== setupName) fail(`${METADATA_NAME} references an unexpected asset: ${name}`)',
        after: 'continue',
      },
    ],
    expectMessage: /references|unexpected asset/,
  },
  {
    name: 'metadata files[].size against the Setup bytes',
    kind: 'size',
    disable: [
      { before: 'if (entrySize !== setup.size) {', after: 'if (false) {' },
      // The post-hash size re-check is a deliberate second layer; it is listed
      // here as an equivalent companion guard, not as the guard under test.
      {
        before: 'if (finalSize !== entrySize) fail(`Setup size changed during validation (${finalSize} != ${entrySize})`)',
        after: 'void 0',
      },
    ],
    expectMessage: /size/,
  },
]

for (const mutationCase of MUTATION_CASES) {
  test(`mutation: deleting the ${mutationCase.name} check makes the validator accept a bad asset set`, (t) => {
    proveGuardDiscriminates(t, {
      mutations: mutationCase.disable,
      buildFixture: (dir, { invalid } = {}) => writeMutationFixture(dir, {
        invalid,
        kind: mutationCase.kind,
      }),
      expectMessage: mutationCase.expectMessage,
    })
  })
}
