#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { readAndroidVersion } from './android-version.mjs'

export function validateAndroidManifest(manifest, { version, versionCode }) {
  assert.match(manifest, /package="ai\.deepseek\.harness\.mobile"/)
  assert.match(manifest, new RegExp('android:versionCode[^\\n]*\\(type 0x10\\)0x' + versionCode.toString(16) + '\\b', 'i'))
  assert.match(manifest, new RegExp('android:versionName[^\\n]*"' + version.replaceAll('.', '\\.') + '"'))
  assert.match(manifest, /android:minSdkVersion[^\n]*\(type 0x10\)0x1a\b/)
  assert.match(manifest, /android:targetSdkVersion[^\n]*\(type 0x10\)0x24\b/)
  assert.doesNotMatch(manifest, /android:debuggable[^\n]*(?:0xffffffff|true)/)
}

async function recordAndroidRelease() {
  const directory = 'dist/android'
  const { version, versionCode, apkName: name } = await readAndroidVersion()
  const file = join(directory, 'release', name)
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  assert.ok(sdk, 'Android SDK is required')
  const tools = join(sdk, 'build-tools/36.0.0')
  const signed = execFileSync(join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', file], { encoding: 'utf8' })
  const cert = signed.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1].toLowerCase()
  assert.equal(cert, process.env.ANDROID_SIGNING_CERT_SHA256?.toLowerCase(), 'APK must use the durable release signing identity')
  // xmltree reads the binary manifest directly without resolving framework icons.
  const manifest = execFileSync(join(tools, 'aapt'), ['dump', 'xmltree', file, 'AndroidManifest.xml'], { encoding: 'utf8' })
  validateAndroidManifest(manifest, { version, versionCode })
  const smoke = JSON.parse(await readFile(join(directory, 'smoke/smoke.json'), 'utf8'))
  assert.equal(smoke.ok, true, 'Emulator check must pass before publication')
  const lint = await readFile('mobile/android/app/build/reports/lint-results-release.xml', 'utf8')
  assert.doesNotMatch(lint, /severity="(?:Error|Fatal)"/)
  const bytes = await readFile(file)
  const sourceSha = process.env.ANDROID_SOURCE_SHA
  assert.match(sourceSha || '', /^[a-f0-9]{40}$/)
  const record = {
    schemaVersion: 1, version, versionCode, applicationId: 'ai.deepseek.harness.mobile', minSdk: 26, targetSdk: 36, sourceSha,
    apk: { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('hex'), signingCertificateSha256: cert },
    checks: { jvm: 'passed', lint: 'passed', emulator: 'passed' },
  }
  await writeFile(join(directory, 'release/android-release.json'), JSON.stringify(record, null, 2) + '\n')
  await writeFile(join(directory, 'signing-verification.txt'), signed)
  await writeFile(join(directory, 'package-manifest.txt'), manifest)
  console.log(JSON.stringify(record))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await recordAndroidRelease()
}
