#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseAndroidVersion(gradle) {
  const names = [...gradle.matchAll(/^[ \t]*versionName[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*(?:\/\/[^\r\n]*)?\r?$/gm)]
  const codes = [...gradle.matchAll(/^[ \t]*versionCode[ \t]*=[ \t]*(\d+)[ \t]*(?:\/\/[^\r\n]*)?\r?$/gm)]
  assert.equal(names.length, 1, 'Android Gradle must declare exactly one literal versionName')
  assert.equal(codes.length, 1, 'Android Gradle must declare exactly one literal versionCode')
  const version = names[0][1]
  const versionCode = Number(codes[0][1])
  assert.ok(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version) &&
    version.split('.').every(part => Number.isSafeInteger(Number(part))), 'Android versionName must be a stable version')
  assert.ok(Number.isSafeInteger(versionCode) && versionCode > 0 && versionCode <= 2100000000,
    'Android versionCode must be a positive Android version code')
  return { version, versionCode, apkName: `Whale-Isle-${version}-android.apk` }
}

export async function readAndroidVersion(gradleFile = new URL('../mobile/android/app/build.gradle.kts', import.meta.url)) {
  return parseAndroidVersion(await readFile(gradleFile, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const version = await readAndroidVersion()
  if (process.argv[2] === '--github-env' && process.argv.length === 3) {
    console.log(`ANDROID_VERSION=${version.version}\nANDROID_VERSION_CODE=${version.versionCode}\nANDROID_APK_NAME=${version.apkName}`)
  } else {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/android-version.mjs [--github-env]')
    console.log(JSON.stringify(version))
  }
}
