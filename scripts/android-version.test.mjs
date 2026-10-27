import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAndroidVersion, readAndroidVersion } from './android-version.mjs'
import { validateAndroidManifest } from './record-android-release.mjs'

const gradle = (version = '0.3.11', code = '5') => `android {\n    defaultConfig {\n        versionCode = ${code}\n        versionName = "${version}"\n    }\n}\n`
const manifest = (version = '0.3.11', code = '5') => `E: manifest\n  A: package="ai.deepseek.harness.mobile"\n  A: android:versionCode(0x0101021b)=(type 0x10)0x${code}\n  A: android:versionName(0x0101021c)="${version}"\n  E: uses-sdk\n    A: android:minSdkVersion(0x0101020c)=(type 0x10)0x1a\n    A: android:targetSdkVersion(0x01010270)=(type 0x10)0x24\n`

// This also catches accidentally reverting code 5 while the published code 4 APK
// remains the baseline for the same-certificate upgrade check.
test('Android candidate identity is 0.3.11/code 5 with its matching APK filename', async () => {
  assert.deepEqual(await readAndroidVersion(), { version: '0.3.11', versionCode: 5, apkName: 'Whale-Isle-0.3.11-android.apk' })
})

test('version and APK name follow literal Gradle values without running Gradle', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'android-version-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'build.gradle.kts')
  await writeFile(file, gradle('1.2.3', '26'))
  assert.deepEqual(await readAndroidVersion(file), { version: '1.2.3', versionCode: 26, apkName: 'Whale-Isle-1.2.3-android.apk' })
  assert.deepEqual(parseAndroidVersion(gradle().replaceAll('\n', '\r\n')), parseAndroidVersion(gradle()))
})

test('missing, duplicate, nonliteral or invalid Gradle versions fail closed', () => {
  const invalid = [
    '', gradle().replace('versionName', '// versionName'), gradle().replace('versionCode', '// versionCode'),
    gradle() + gradle(), gradle().replace('"0.3.11"', 'providers.gradleProperty("version").get()'),
    gradle('0.3.11-rc.1'), gradle('00.3.11'), gradle('9007199254740992.0.0'),
    gradle('0.3.11', '-1'), gradle('0.3.11', '0'), gradle('0.3.11', '5.5'), gradle('0.3.11', '2100000001'),
  ]
  for (const source of invalid) assert.throws(() => parseAndroidVersion(source), /Android/)
})

test('workflow environment output and JSON resolve the repository Gradle file from another cwd', async () => {
  const script = fileURLToPath(new URL('./android-version.mjs', import.meta.url))
  const current = await readAndroidVersion()
  const run = args => execFileSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: 'utf8' }).trim()
  assert.deepEqual(JSON.parse(run([])), current)
  assert.equal(run(['--github-env']), `ANDROID_VERSION=${current.version}\nANDROID_VERSION_CODE=${current.versionCode}\nANDROID_APK_NAME=${current.apkName}`)
})

test('recording checks actual manifest version name/code against the Gradle candidate', async () => {
  const current = await readAndroidVersion()
  validateAndroidManifest(manifest(), current)
  for (const source of [manifest('0.3.10', '4'), manifest('0.3.11', '4'), manifest('0.3.10', '5'),
    manifest('0x3x11', '5'), manifest('0.3.11', '50'),
    manifest().replace('ai.deepseek.harness.mobile', 'other.application'),
    manifest().replace('0x1a', '0x19'), manifest().replace('0x24', '0x23'),
    manifest() + '  A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff\n']) {
    assert.throws(() => validateAndroidManifest(source, current), { code: 'ERR_ASSERTION' })
  }
  validateAndroidManifest(manifest('0.3.10', '4'), { version: '0.3.10', versionCode: 4 })
})
