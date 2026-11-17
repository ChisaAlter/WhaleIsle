'use strict';
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pruneRuntimeFiles } = require('./production-runtime');
function nodeDistMirror() {
  return process.env.DSH_NODE_DIST_MIRROR || 'https://nodejs.org/dist';
}

function nodeDistSha256(shasumsText, archiveName) {
  for (const line of shasumsText.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(\S+)\s*$/.exec(line.trim());
    if (match && match[2] === archiveName) {
      return match[1];
    }
  }
  return null;
}

function verifyNodeDistArchive(archive, shasumsText, archiveName) {
  const expected = nodeDistSha256(shasumsText, archiveName);
  if (!expected) {
    throw new Error(`Node 发行校验和清单缺少 ${archiveName}`);
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (actual !== expected) {
    throw new Error(`Node 发行包 SHA-256 不匹配：期望 ${expected}，实际 ${actual}`);
  }
}

function probeBundledNode(bin, version) {
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  const actual = (probe.stdout || '').trim();
  if (probe.status !== 0 || actual !== `v${version}`) {
    throw new Error(`官方 Node 构建自检失败：期望 v${version}，实际 ${actual || probe.stderr || '无法运行'}`);
  }
}

/** 官方独立 Node 只链系统库；Homebrew/源码装的瘦二进制会列出 libnode 与 homebrew、/opt/*、/usr/local/* 前缀依赖 —— 打进安装包后目标机没有这些前缀库就 SIGABRT。 */
function nodeBinaryHasExternalDylibs(listing) {
  return /libnode|\/opt\/|homebrew|\/usr\/local\//i.test(listing);
}

function probeNodeDylibListing(binPath) {
  const tool = process.platform === 'darwin' ? 'otool' : 'ldd';
  const args = process.platform === 'darwin' ? ['-L', binPath] : [binPath];
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 15000 });
  return result.status === 0 ? result.stdout : null;
}

function bundledNodePinnedVersion(projectDir) {
  try {
    const pinned = fs.readFileSync(path.join(projectDir, '.nvmrc'), 'utf8').trim();
    const match = /^v?(\d+\.\d+\.\d+)/.exec(pinned);
    return match ? match[1] : process.versions.node;
  } catch {
    return process.versions.node;
  }
}

function downloadSelfContainedNode(cacheDir, version, probe = probeBundledNode) {
  const tuple = `node-v${version}-${process.platform}-${process.arch}`;
  const bin = path.join(cacheDir, tuple, 'bin', 'node');
  if (fs.existsSync(bin)) {
    return bin;
  }
  const stage = path.join(cacheDir, `.tmp-${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(stage, tuple, 'bin'), { recursive: true });
    const archiveName = `${tuple}.tar.gz`;
    const archive = path.join(stage, archiveName);
    const shasums = path.join(stage, 'SHASUMS256.txt');
    const mirror = nodeDistMirror();
    console.log(`本机 node 非自包含（瘦二进制），下载官方构建 ${mirror}/v${version}/${archiveName}`);
    execFileSync('curl', ['-fsSL', '--retry', '3', `${mirror}/v${version}/SHASUMS256.txt`, '-o', shasums], { stdio: 'inherit' });
    execFileSync('curl', ['-fsSL', '--retry', '3', `${mirror}/v${version}/${archiveName}`, '-o', archive], { stdio: 'inherit' });
    verifyNodeDistArchive(archive, fs.readFileSync(shasums, 'utf8'), archiveName);
    execFileSync('tar', ['-xzf', archive, '-C', stage, `${tuple}/bin/node`], { stdio: 'inherit' });
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.renameSync(path.join(stage, tuple, 'bin', 'node'), bin);
    fs.chmodSync(bin, 0o755);
    probe(bin, version);
    return bin;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function bundledPosixNode(projectDir) {
  const envBinary = process.env.NODE_BINARY;
  if (envBinary) {
    if (!fs.existsSync(envBinary)) {
      throw new Error(`NODE_BINARY 不存在：${envBinary}`);
    }
    return envBinary;
  }
  if (!/electron/i.test(process.execPath)) {
    const listing = probeNodeDylibListing(process.execPath);
    if (listing !== null && !nodeBinaryHasExternalDylibs(listing)) {
      return process.execPath;
    }
  }
  const version = bundledNodePinnedVersion(projectDir);
  return downloadSelfContainedNode(
    path.join(projectDir, 'node_modules', '.cache', 'dshd-node-dist'),
    version,
  );
}

function copyBundledNode(destDir, projectDir = process.cwd()) {
  // Both the Harness host and Office use the locked standalone Windows Node.
  const shared = path.join(destDir, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
  if (process.platform === 'win32' && fs.existsSync(shared)) return shared;
  let src;
  if (process.platform === 'win32') {
    src = [
      process.env.NODE_BINARY,
      process.execPath,
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    ].find((candidate) => candidate && fs.existsSync(candidate) && !/electron/i.test(candidate));
  } else {
    src = bundledPosixNode(projectDir);
  }
  if (!src) {
    throw new Error('打包时未找到 Node.js 可执行文件，安装包将无法启动官方 Web UI');
  }
  const dest = path.join(destDir, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(src, dest);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  return dest;
}

function copyBundledPnpm(projectDir, destDir, target = {}) {
  const src = path.join(projectDir, 'node_modules', 'pnpm');
  if (!fs.existsSync(path.join(src, 'bin', 'pnpm.mjs'))) {
    throw new Error('打包时未找到 pnpm，请先 npm install');
  }
  const platform = target.platform || process.platform;
  const arch = target.arch || process.arch;
  const libc = platform === 'linux' && process.report.getReport().header.glibcVersionRuntime === undefined
    ? '-musl' : '';
  const nativePackage = `@pnpm/exe.${platform}-${arch}${libc}`;
  const nativeDir = path.dirname(require.resolve(`${nativePackage}/package.json`, { paths: [fs.realpathSync(src)] }));
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  const nativeManifest = JSON.parse(fs.readFileSync(path.join(nativeDir, 'package.json'), 'utf8'));
  if (nativeManifest.version !== manifest.version) {
    throw new Error(`pnpm 原生运行时版本不一致：pnpm@${manifest.version} ${nativePackage}@${nativeManifest.version}`);
  }
  const binary = platform === 'win32' ? 'pnpm.exe' : 'pnpm';
  const dest = path.join(destDir, 'pnpm');
  fs.mkdirSync(dest, { recursive: true });
  // pnpm 12's Node entry imports native-binary.mjs and needs an adjacent native
  // executable. Use its official pnpm-native location so packaged use is offline.
  for (const name of ['package.json', 'bin', 'dist', 'native-binary.mjs', 'THIRD-PARTY-NOTICES.md', 'README.md']) {
    fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true, dereference: true });
  }
  const nativeDest = path.join(dest, platform === 'win32' ? 'pnpm-native.exe' : 'pnpm-native');
  fs.copyFileSync(path.join(nativeDir, binary), nativeDest);
  fs.copyFileSync(path.join(nativeDir, 'LICENSE'), path.join(dest, 'LICENSE'));
  if (platform !== 'win32') fs.chmodSync(nativeDest, 0o755);
  pruneRuntimeFiles(dest, target);
  return dest;
}

function resolveDeployDir(deployEnv) {
  if (!deployEnv || deployEnv === 'off') {
    return null;
  }
  return path.resolve(deployEnv);
}


module.exports = { nodeDistSha256, verifyNodeDistArchive, downloadSelfContainedNode, copyBundledNode, copyBundledPnpm, nodeBinaryHasExternalDylibs, resolveDeployDir };
