#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'
import { assertReleaseVersion } from './check-release-version.mjs'
import { validateReleaseAssets } from './check-release-assets.mjs'

export function releaseDecision({ run, repo, sha, version, latest, existing, artifacts }) {
  if (run.status !== 'completed' || run.conclusion !== 'success' ||
      run.path !== '.github/workflows/test.yml' || run.head_branch !== 'main' ||
      run.head_repository?.full_name !== repo || !['push', 'workflow_dispatch'].includes(run.event) ||
      run.head_sha !== sha) throw new Error('Release requires a successful main Development CI run for the checked-out commit')
  const tag = 'v' + version
  assertReleaseVersion(tag, version)
  if (existing && !existing.draft) return { skip: tag + ' is already published' }
  if (latest && !semver.gt(version, latest.tag_name)) return { skip: tag + ' is not newer than ' + latest.tag_name }
  const windows = artifacts.filter(a => a.name === 'Whale-Isle-windows-x64')
  if (!windows.length) return { skip: 'This CI run has no installer (documentation or tools only)' }
  if (windows.length !== 1) throw new Error('Expected one Windows installer artifact')
  if (windows[0].expired) throw new Error('Installer artifact expired; a new development build is needed')
  if (existing && existing.target_commitish !== sha) throw new Error('Existing draft belongs to another commit')
  return { tag, macos: artifacts.some(a => a.name === 'Whale-Isle-macos-arm64' && !a.expired) }
}
async function hash(file, algorithm) {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
async function findRelease(request, prefix, tag) {
  // The tag endpoint is documented for published releases. List releases also
  // includes drafts for this workflow's write token, so interrupted uploads resume.
  for (let page = 1; ; page += 1) {
    const releases = await request(prefix + '/releases?per_page=100&page=' + page)
    const found = releases.find(release => release.tag_name === tag)
    if (found || releases.length < 100) return found || null
  }
}
export async function publish({ repo, runId, request, gh, sha, root = process.cwd(), output = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(String(runId))) throw new Error('Repository and numeric CI run ID are required')
  const prefix = 'repos/' + repo
  const run = await request(prefix + '/actions/runs/' + runId)
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const tag = 'v' + version
  const [latest, existing, artifactList] = await Promise.all([
    request(prefix + '/releases/latest', { missing: true }),
    findRelease(request, prefix, tag),
    request(prefix + '/actions/runs/' + runId + '/artifacts?per_page=100'),
  ])
  const decision = releaseDecision({ run, repo, sha, version, latest, existing, artifacts: artifactList.artifacts })
  if (decision.skip) { output(decision.skip); return { skipped: decision.skip } }
  const tagged = await request(prefix + '/commits/' + tag, { missing: true })
  if (tagged && tagged.sha !== sha) throw new Error('Existing tag belongs to another commit')

  const directory = await mkdtemp(join(tmpdir(), 'whale-release-'))
  const windowsDir = join(directory, 'windows')
  await gh(['run', 'download', String(runId), '--repo', repo, '--name', 'Whale-Isle-windows-x64', '--dir', windowsDir])
  const setupName = 'Whale-Isle-Setup-' + version + '.exe'
  const digest = await hash(join(windowsDir, setupName), 'sha256')
  const verified = await validateReleaseAssets({ assetDir: windowsDir, releaseTag: tag, packageVersion: version, expectedSetupSha256: digest })
  const files = [setupName, verified.blockmapName, 'latest.yml'].map(name => join(windowsDir, name))
  if (decision.macos) {
    const macDir = join(directory, 'macos')
    await gh(['run', 'download', String(runId), '--repo', repo, '--name', 'Whale-Isle-macos-arm64', '--dir', macDir])
    const names = await readdir(macDir)
    const expected = 'Whale-Isle-' + version + '-mac-arm64.dmg'
    if (names.length !== 1 || names[0] !== expected) throw new Error('macOS artifact does not match the release version')
    files.push(join(macDir, expected))
  }
  // The installed updater consumes this filename and SHA-512 format.
  const sums = await Promise.all(files.map(async file => (await hash(file, 'sha512')) + '  ' + basename(file)))
  const checksumFile = join(directory, 'SHA512SUMS.txt')
  await writeFile(checksumFile, sums.join('\n') + '\n')
  files.push(checksumFile)
  const notes = await readFile(join(root, '.github/release-notes.md'), 'utf8')
  const english = await readFile(join(root, '.github/release-notes.en.md'), 'utf8')
  const body = notes + '\n\n<details>\n<summary>English</summary>\n\n' + english + '\n\n</details>\n'
  const release = existing || await request(prefix + '/releases', {
    method: 'POST', body: { tag_name: tag, target_commitish: sha, name: 'Whale Isle ' + tag, body, draft: true },
  })
  // Failed uploads leave a draft. Retry the same run without rebuilding.
  await gh(['release', 'upload', tag, ...files, '--repo', repo, '--clobber'])
  const published = await request(prefix + '/releases/' + release.id, {
    method: 'PATCH', body: { body, draft: false, make_latest: 'true' },
  })
  output(published.html_url)
  return { url: published.html_url, sha256: verified.sha256 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const token = process.env.GH_TOKEN
    if (!token) throw new Error('GH_TOKEN is required')
    const request = async (path, { method = 'GET', body, missing = false } = {}) => {
      const response = await fetch('https://api.github.com/' + path, {
        method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (missing && response.status === 404) return null
      if (!response.ok) throw new Error('GitHub ' + method + ' ' + path + ': HTTP ' + response.status)
      return response.json()
    }
    await publish({
      repo: process.env.GITHUB_REPOSITORY, runId: process.env.RUN_ID, request,
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      gh: args => execFileSync(process.env.GH_PATH || 'gh', args, { stdio: 'inherit' }),
    })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
