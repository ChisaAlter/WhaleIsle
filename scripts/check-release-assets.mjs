#!/usr/bin/env node
// Read-only release-asset validator for the promotion workflow.
//
// Background: publish.yml used to only count files and compare the Setup
// SHA256 by hand. It never parsed latest.yml, so a manifest that referenced a
// different installer (or a blockmap whose stem did not match the Setup) could
// still be promoted. This helper is the single source of truth for that
// decision: the workflow CLI and the test suite call the same function, so the
// shipped gate and the tested logic cannot drift.
//
// What this proves:
//   1. Exactly one expected Windows Setup executable, its correspondingly named
//      `.exe.blockmap`, and `latest.yml` exist.
//   2. Every required asset is a regular file: symlinks/junctions are rejected
//      and paths may not escape the asset directory.
//   3. Setup filename, release tag, package version and parsed metadata version
//      all agree.
//   4. The Setup SHA256 equals the operator-supplied digest.
//   5. The metadata file entry names that exact local Setup filename with a
//      matching byte size and matching base64 SHA512.
//   6. Legacy top-level path/sha512, when present, agree with the files[] entry.
//   7. Malformed YAML, duplicate keys, wrong types, contradictory metadata,
//      unexpected executable references, absolute/remote URLs, traversal,
//      oversized metadata and read failures are rejected.
//
// What this does NOT prove:
//   - That the `.exe.blockmap` bytes correspond to the Setup. The blockmap is a
//     differential-download index derived from the installer, and the
//     v26 electron-updater metadata carries no blockmap digest, so only the
//     filename stem can be checked. Do not invent a blockmap-hash field.
//
// Data-only, bounded, offline: `yaml` is a locked direct dependency in
// package.json (no transitive phantom import). The installer is hashed
// with a stream and never read fully into memory. Importing this module has no
// side effects.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

export const SETUP_PREFIX = 'Whale-Isle-Setup-'
export const SETUP_SUFFIX = '.exe'
export const BLOCKMAP_SUFFIX = '.blockmap'
const BLOCKMAP_FILE_SUFFIX = `${SETUP_SUFFIX}${BLOCKMAP_SUFFIX}`
export const METADATA_NAME = 'latest.yml'
// electron-builder's latest.yml is a few hundred bytes; 512 KiB is far above
// any legitimate payload and blocks a memory blowup via a crafted file.
export const MAX_METADATA_BYTES = 512 * 1024

const SHA256_HEX = /^[0-9a-f]{64}$/
// base64 SHA-512 is 88 chars: 86 payload chars + "==".
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/
const STABLE_TAG = /^v\d+\.\d+\.\d+$/
const STABLE_VERSION = /^\d+\.\d+\.\d+$/

export class ReleaseAssetError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReleaseAssetError'
  }
}

function fail(message) {
  throw new ReleaseAssetError(message)
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}

function assertSha512(value, label) {
  if (typeof value !== 'string' || !SHA512_BASE64.test(value)) {
    fail(`${label} must be a base64-encoded SHA-512 (88 chars)`)
  }
  return value
}

function assertSize(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer`)
  return value
}

/** Reject everything that is not a plain filename inside the asset directory. */
function localNameOf(raw, label) {
  if (typeof raw !== 'string' || raw.length === 0) fail(`${label} must be a non-empty string`)
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('/')) {
    fail(`${label} must be a local filename, not an absolute/remote URL: ${raw}`)
  }
  if (raw.includes('\\')) fail(`${label} must use forward slashes: ${raw}`)
  if (raw.includes('%')) fail(`${label} must not be percent-encoded: ${raw}`)
  const segments = raw.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label} must not traverse or contain empty path segments: ${raw}`)
  }
  if (segments.length !== 1) fail(`${label} must not contain directories: ${raw}`)
  return raw
}

function hashFile(file, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    hash.setEncoding(encoding)
    hash.on('error', reject)
    createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('error', reject)
      .on('end', () => {
        hash.end()
        resolve(hash.read())
      })
      .pipe(hash, { end: false })
  })
}

async function hashAsset(file, algorithm, encoding, label) {
  try {
    return await hashFile(file, algorithm, encoding)
  } catch (error) {
    fail(`cannot hash ${label}: ${error.message}`)
  }
}

/**
 * Resolve one required asset and reject symlinks/junctions or any path that
 * escapes the asset directory. Returns `{ absolute, size }`.
 */
async function requireRegularAsset(lexicalRoot, realRoot, name, label) {
  const candidate = path.resolve(lexicalRoot, name)
  if (candidate !== lexicalRoot && !candidate.startsWith(lexicalRoot + path.sep)) {
    fail(`${label} escapes the asset directory: ${name}`)
  }
  let linkInfo
  try {
    linkInfo = await lstat(candidate)
  } catch (error) {
    fail(`cannot read ${label} ${name}: ${error.message}`)
  }
  if (linkInfo.isSymbolicLink()) fail(`${label} must not be a symlink or junction: ${name}`)
  if (!linkInfo.isFile()) fail(`${label} must be a regular file: ${name}`)
  let resolved
  try {
    resolved = await realpath(candidate)
  } catch (error) {
    fail(`cannot resolve ${label} ${name}: ${error.message}`)
  }
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
    fail(`${label} resolves outside the asset directory: ${name}`)
  }
  return { absolute: candidate, size: linkInfo.size }
}

async function describeNonRegularCandidate(absolute, info) {
  if (info.isSymbolicLink()) {
    try {
      await realpath(absolute)
      return 'symlink or junction'
    } catch {
      return 'dangling symlink or junction'
    }
  }
  if (info.isDirectory()) return 'directory'
  return 'non-regular file'
}

function requireSingleCandidate(candidates, label) {
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate.name)) {
      fail(`duplicate/conflicting ${label} candidate names: ${candidate.name}`)
    }
    seen.add(candidate.name)
  }
  if (candidates.length !== 1) {
    const names = candidates.map((candidate) => candidate.name).join(', ') || 'none'
    fail(`duplicate/conflicting ${label} candidate names: expected exactly one, found ${candidates.length}: ${names}`)
  }
  return candidates[0]
}

/** Bounded read + data-only YAML parse. Duplicate keys, custom tags, and YAML 1.1 extras throw. */
async function readMetadata(metadataPath) {
  let info
  try {
    info = await lstat(metadataPath)
  } catch (error) {
    fail(`cannot read ${METADATA_NAME}: ${error.message}`)
  }
  if (info.isSymbolicLink()) fail(`${METADATA_NAME} must not be a symlink or junction`)
  if (!info.isFile()) fail(`${METADATA_NAME} must be a regular file`)
  if (info.size > MAX_METADATA_BYTES) {
    fail(`${METADATA_NAME} is ${info.size} bytes; limit is ${MAX_METADATA_BYTES}`)
  }
  let raw
  try {
    raw = await readFile(metadataPath)
  } catch (error) {
    fail(`cannot read ${METADATA_NAME}: ${error.message}`)
  }
  // Re-check after the read so a file that grew between lstat and read cannot
  // slip past the bound.
  if (raw.length > MAX_METADATA_BYTES) {
    fail(`${METADATA_NAME} is ${raw.length} bytes; limit is ${MAX_METADATA_BYTES}`)
  }
  let parsed
  try {
    // YAML 1.2 core schema with resolveKnownTags:false and stringKeys:true keeps
    // scalars data-only, rejects custom/!!js/YAML 1.1 tags via warnings/errors,
    // and enforces unique keys even across coerced scalars (e.g. 1 vs "1").
    const doc = parseDocument(raw.toString('utf8'), {
      schema: 'core',
      resolveKnownTags: false,
      uniqueKeys: true,
      strict: true,
      stringKeys: true,
      logLevel: 'silent',
    })
    if (doc.errors.length > 0) throw doc.errors[0]
    if (doc.warnings.length > 0) throw doc.warnings[0]
    parsed = doc.toJS({ maxAliasCount: 100 })
  } catch (error) {
    fail(`cannot parse ${METADATA_NAME}: ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${METADATA_NAME} must parse to a mapping`)
  }
  return parsed
}

/**
 * Validate one candidate asset directory against a release tag, package
 * version and expected Setup SHA256. Resolves with a summary on success and
 * rejects with a `ReleaseAssetError` otherwise. Pure read-only: nothing is
 * written, network and GitHub credentials are never used.
 */
export async function validateReleaseAssets({
  assetDir,
  releaseTag,
  packageVersion,
  expectedSetupSha256,
} = {}) {
  assertNonEmptyString(assetDir, 'assetDir')
  assertNonEmptyString(releaseTag, 'releaseTag')
  assertNonEmptyString(packageVersion, 'packageVersion')
  assertNonEmptyString(expectedSetupSha256, 'expectedSetupSha256')

  const tag = releaseTag.trim()
  if (!STABLE_TAG.test(tag)) fail(`releaseTag must be a stable vMAJOR.MINOR.PATCH tag: ${releaseTag}`)
  const version = packageVersion.trim()
  if (!STABLE_VERSION.test(version)) fail(`packageVersion must be MAJOR.MINOR.PATCH: ${packageVersion}`)
  if (tag.slice(1) !== version) fail(`releaseTag ${tag} does not match packageVersion ${version}`)

  const digest = expectedSetupSha256.trim().toLowerCase()
  if (!SHA256_HEX.test(digest)) fail('expectedSetupSha256 must be 64 hexadecimal characters')

  const lexicalRoot = path.resolve(assetDir)
  let realRoot
  try {
    realRoot = await realpath(lexicalRoot)
  } catch (error) {
    fail(`cannot resolve assetDir ${assetDir}: ${error.message}`)
  }
  const rootInfo = await lstat(lexicalRoot).catch((error) => fail(`cannot read assetDir: ${error.message}`))
  if (!rootInfo.isDirectory()) fail(`assetDir is not a directory: ${assetDir}`)

  let dirents
  try {
    dirents = await readdir(lexicalRoot, { withFileTypes: true })
  } catch (error) {
    fail(`cannot list assetDir ${assetDir}: ${error.message}`)
  }
  // Enumerate every matching directory entry before filtering by type. A
  // matching directory, symlink or dangling link must be rejected explicitly;
  // dropping it here would let the later workflow globs select a path this
  // validator never approved.
  const setupCandidates = []
  const blockmapCandidates = []
  const metadataCandidates = []
  for (const dirent of dirents) {
    const matches = []
    if (dirent.name.startsWith(SETUP_PREFIX) && dirent.name.endsWith(SETUP_SUFFIX)) {
      matches.push({ label: 'Windows Setup executable', candidates: setupCandidates })
    }
    if (dirent.name.endsWith(BLOCKMAP_FILE_SUFFIX)) {
      matches.push({ label: 'blockmap', candidates: blockmapCandidates })
    }
    if (dirent.name === METADATA_NAME) {
      matches.push({ label: METADATA_NAME, candidates: metadataCandidates })
    }
    if (matches.length === 0) continue
    if (matches.length > 1) {
      fail(`asset candidate ${dirent.name} matches conflicting candidate patterns: ${matches.map((match) => match.label).join(', ')}`)
    }

    const absolute = path.join(lexicalRoot, dirent.name)
    const info = await lstat(absolute).catch((error) => {
      fail(`cannot inspect ${matches[0].label} candidate ${dirent.name}: ${error.message}`)
    })
    if (info.isSymbolicLink() || !info.isFile()) {
      const kind = await describeNonRegularCandidate(absolute, info)
      fail(`${matches[0].label} candidate ${dirent.name} is not a regular file (${kind}); matching release assets must be regular files`)
    }
    matches[0].candidates.push({ name: dirent.name, absolute, info })
  }

  const expectedName = `${SETUP_PREFIX}${version}${SETUP_SUFFIX}`
  const setupCandidate = requireSingleCandidate(setupCandidates, 'Windows Setup executable')
  const setupName = setupCandidate.name
  if (setupName !== expectedName) {
    fail(`expected exactly one Windows Setup executable matching ${expectedName}; found ${setupName}`)
  }

  // electron-builder writes the blockmap as `<full installer filename>.blockmap`,
  // e.g. `Whale-Isle-Setup-0.3.2.exe.blockmap`, so the stem is the
  // whole Setup filename up to its final `.blockmap`.
  const expectedBlockmap = `${setupName}.blockmap`
  const blockmapCandidate = requireSingleCandidate(blockmapCandidates, '.exe.blockmap')
  if (blockmapCandidate.name !== expectedBlockmap) {
    fail(`blockmap ${blockmapCandidate.name} does not match Setup ${setupName}; expected ${expectedBlockmap}`)
  }

  requireSingleCandidate(metadataCandidates, METADATA_NAME)

  const setup = await requireRegularAsset(lexicalRoot, realRoot, setupName, 'Setup executable')
  await requireRegularAsset(lexicalRoot, realRoot, expectedBlockmap, 'blockmap')
  const metadata = await requireRegularAsset(lexicalRoot, realRoot, METADATA_NAME, 'metadata')
  const doc = await readMetadata(metadata.absolute)

  if (typeof doc.version !== 'string' || doc.version.length === 0) {
    fail(`${METADATA_NAME} version must be a non-empty string`)
  }
  if (doc.version !== version) {
    fail(`${METADATA_NAME} version ${doc.version} does not match package version ${version}`)
  }

  if (!Array.isArray(doc.files) || doc.files.length === 0) {
    fail(`${METADATA_NAME} files must be a non-empty array`)
  }
  for (const entry of doc.files) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${METADATA_NAME} files[] entries must be mappings`)
    }
  }
  const setupEntries = doc.files.filter(
    (entry) => typeof entry.url === 'string' && entry.url.endsWith(SETUP_SUFFIX),
  )
  if (setupEntries.length !== 1) {
    fail(`${METADATA_NAME} must reference exactly one Setup in files[], found ${setupEntries.length}`)
  }
  const entry = setupEntries[0]
  const entryName = localNameOf(entry.url, `${METADATA_NAME} files[].url`)
  if (entryName !== setupName) {
    fail(`${METADATA_NAME} references ${entryName}, not the local Setup ${setupName}`)
  }
  const entrySha512 = assertSha512(entry.sha512, `${METADATA_NAME} files[].sha512`)
  const entrySize = assertSize(entry.size, `${METADATA_NAME} files[].size`)
  if (entrySize !== setup.size) {
    fail(`${METADATA_NAME} size ${entrySize} does not match Setup bytes ${setup.size}`)
  }

  // Any other files[] entry is an unexpected reference even when it is not an
  // executable; the promotion path promotes a single Setup.
  for (const candidate of doc.files) {
    const name = localNameOf(candidate.url, `${METADATA_NAME} files[].url`)
    if (name !== setupName) fail(`${METADATA_NAME} references an unexpected asset: ${name}`)
  }

  // Legacy top-level fields are optional (electron-updater accepts files[]
  // only) but must never contradict the modern entry.
  if (doc.path !== undefined) {
    const legacyName = localNameOf(doc.path, `${METADATA_NAME} path`)
    if (legacyName !== entryName) fail(`${METADATA_NAME} path ${legacyName} contradicts files[].url ${entryName}`)
  }
  if (doc.sha512 !== undefined) {
    const legacySha = assertSha512(doc.sha512, `${METADATA_NAME} sha512`)
    if (legacySha !== entrySha512) fail(`${METADATA_NAME} sha512 contradicts files[].sha512`)
  }

  const actualSha512 = await hashAsset(setup.absolute, 'sha512', 'base64', setupName)
  if (actualSha512 !== entrySha512) {
    fail(`Setup SHA512 does not match ${METADATA_NAME} files[].sha512`)
  }
  const actualSha256 = await hashAsset(setup.absolute, 'sha256', 'hex', setupName)
  if (actualSha256 !== digest) {
    fail(`Setup SHA256 ${actualSha256} does not match the supplied digest ${digest}`)
  }

  const finalSize = (await lstat(setup.absolute).catch((error) => fail(`cannot stat ${setupName}: ${error.message}`))).size
  if (finalSize !== entrySize) fail(`Setup size changed during validation (${finalSize} != ${entrySize})`)

  return {
    releaseTag: tag,
    version,
    setupName,
    setupPath: setup.absolute,
    blockmapName: expectedBlockmap,
    metadataPath: metadata.absolute,
    sha256: actualSha256,
    sha512: actualSha512,
    size: entrySize,
  }
}

function printUsage() {
  process.stderr.write(
    'usage: node scripts/check-release-assets.mjs ' +
      '<asset-dir> <release-tag> <package-version> <expected-setup-sha256>\n',
  )
}

function main(argv) {
  const [assetDir, releaseTag, packageVersion, expectedSetupSha256, ...rest] = argv
  if (!assetDir || !releaseTag || !packageVersion || !expectedSetupSha256 || rest.length > 0) {
    printUsage()
    process.exitCode = 2
    return
  }
  validateReleaseAssets({ assetDir, releaseTag, packageVersion, expectedSetupSha256 })
    .then((result) => {
      process.stdout.write(
        `release assets verified: ${result.setupName} sha256=${result.sha256} size=${result.size}\n`,
      )
    })
    .catch((error) => {
      process.stderr.write(`release asset validation failed: ${error.message}\n`)
      process.exitCode = 1
    })
}

const invokedDirectly =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (invokedDirectly) main(process.argv.slice(2))
