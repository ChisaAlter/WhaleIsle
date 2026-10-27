#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { readAndroidVersion } from './android-version.mjs'

const { apkName } = await readAndroidVersion()
const apk = resolve(process.argv[2] || join('dist/android/release', apkName))
const directory = resolve('dist/android/smoke')
const applicationId = 'ai.deepseek.harness.mobile'
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 60000 }).trim()
const steps = []
await mkdir(directory, { recursive: true })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function uiUntil(predicate, label) {
  const deadline = Date.now() + 30000
  let xml = ''
  while (Date.now() < deadline) {
    adb('shell', 'uiautomator', 'dump', '/sdcard/whale-ui.xml')
    xml = adb('shell', 'cat', '/sdcard/whale-ui.xml')
    if (predicate(xml)) return xml
    await pause(300)
  }
  await writeFile(join(directory, 'failed-ui.xml'), xml)
  throw new Error('Android UI did not reach: ' + label)
}
async function capture(name, xml) {
  await writeFile(join(directory, name + '.xml'), xml)
  await writeFile(join(directory, name + '.png'), execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000 }))
}
function tap(xml, text) {
  const nodes = xml.match(/<node\b[^>]*>/g) || []
  const node = nodes.find(value => value.includes('text="' + text + '"'))
  assert.ok(node, 'Visible control missing: ' + text)
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  assert.ok(bounds, 'Control bounds missing: ' + text)
  const [, left, top, right, bottom] = bounds.map(Number)
  adb('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)))
}
try {
  adb('wait-for-device')
  adb('install', '-r', apk)
  steps.push('signed-release-installed')
  adb('logcat', '-c')
  adb('shell', 'am', 'start', '-W', '-n', applicationId + '/.MainActivity')
  let xml = await uiUntil(value => value.includes('扫描二维码') && value.includes('粘贴配对链接'), 'native connection entry')
  await capture('connect-light', xml)
  steps.push('native-connect-rendered')
  tap(xml, '粘贴配对链接')
  xml = await uiUntil(value => value.includes('收起粘贴输入') && value.includes('粘贴含 #offer='), 'paste field expanded')
  await capture('paste-expanded', xml)
  steps.push('paste-entry-expanded')
  // The focused field opens the IME; Android Back must first dismiss it.
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
  xml = await uiUntil(value => value.includes('收起粘贴输入'), 'paste field retained after keyboard back')
  tap(xml, '连接')
  xml = await uiUntil(value => value.includes('无效的配对链接'), 'invalid pairing input rejected')
  await capture('invalid-pairing', xml)
  steps.push('invalid-pairing-rejected')
  tap(xml, '收起粘贴输入')
  xml = await uiUntil(value => value.includes('粘贴配对链接') && !value.includes('收起粘贴输入'), 'paste field collapsed')
  steps.push('paste-entry-collapsed')
  adb('shell', 'cmd', 'uimode', 'night', 'yes')
  xml = await uiUntil(value => value.includes('扫描二维码') && value.includes('粘贴配对链接'), 'dark theme connection entry')
  await capture('connect-dark', xml)
  steps.push('dark-theme-rendered')
  adb('shell', 'am', 'force-stop', applicationId)
  adb('shell', 'am', 'start', '-W', '-n', applicationId + '/.MainActivity')
  xml = await uiUntil(value => value.includes('扫描二维码') && value.includes('粘贴配对链接'), 'cold relaunch')
  steps.push('cold-relaunch-rendered')
  assert.ok(adb('shell', 'pidof', applicationId), 'App process must remain alive')
  const log = adb('logcat', '-d', '-s', 'AndroidRuntime:E')
  await writeFile(join(directory, 'android-runtime.log'), log)
  assert.ok(!log.includes('FATAL EXCEPTION'), 'Android runtime must not crash')
  const report = { ok: true, applicationId, apiLevel: adb('shell', 'getprop', 'ro.build.version.sdk'), steps,
    limitations: ['No physical-device camera, public pairing, streamed live conversation or legacy-signature upgrade was tested.'] }
  await writeFile(join(directory, 'smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  await writeFile(join(directory, 'smoke.json'), JSON.stringify({ ok: false, steps, error: error.message }, null, 2) + '\n')
  throw error
}
