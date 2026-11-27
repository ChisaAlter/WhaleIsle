import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'base' | 'asar' | 'asar-unpacked' | 'tar' | 'res'} FootprintLayer */

/**
 * @typedef {object} FileRecord
 * @property {FootprintLayer} layer
 * @property {string} logicalPath
 * @property {number} bytes
 * @property {string} [canonicalMatchPath]
 * @property {string} [fullPath]
 * @property {string} [archivePath]
 * @property {number} [archiveOffset]
 * @property {string | null} [integrityHash]
 */

/**
 * @typedef {object} ComponentRule
 * @property {string} id
 * @property {string} owner
 * @property {string[]} match
 * @property {string[]} [targets]
 * @property {{ targets: string[] }} [forbidden]
 */

/**
 * @typedef {object} CliOptions
 * @property {string} input
 * @property {string} target
 * @property {string} installer
 * @property {string} componentsPath
 * @property {string} baselinePath
 * @property {string} recordBaselinePath
 * @property {string} budgetsPath
 * @property {string} outPath
 * @property {string} markdownPath
 */

/**
 * @typedef {object} TargetBudget
 * @property {number} [totalBytes]
 * @property {number} [installerBytes]
 * @property {number} [maxDuplicateBytes]
 * @property {number} [maxUnclassifiedBytes]
 * @property {string[]} [pendingSlimmingForbidden]
 * @property {Record<string, { maxBytes?: number }>} [components]
 */

const DUPLICATE_MIN_BYTES = 256 * 1024;
const TAR_BLOCK_BYTES = 512;
const DEFAULT_COMPONENTS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'package-footprint-components.json',
);

class InputError extends Error {}

/** @param {string[]} argv */
function parseCliArgs(argv) {
  /** @type {CliOptions} */
  const opts = {
    input: '', target: 'win32-x64', installer: '', componentsPath: DEFAULT_COMPONENTS_PATH,
    baselinePath: '', recordBaselinePath: '', budgetsPath: '', outPath: '', markdownPath: '',
  };
  /** @type {Record<string, keyof CliOptions>} */
  const flagMap = {
    '--input': 'input', '--target': 'target', '--installer': 'installer', '--components': 'componentsPath',
    '--baseline': 'baselinePath', '--record-baseline': 'recordBaselinePath', '--budgets': 'budgetsPath',
    '--out': 'outPath', '--markdown': 'markdownPath',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = flagMap[argv[i]];
    if (!key) throw new InputError(`Unknown CLI option: ${argv[i]}`);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) throw new InputError(`Missing value for ${argv[i]}`);
    opts[key] = val;
  }
  if (!opts.input) throw new InputError('Missing required flag: --input <dir>');
  return opts;
}

/** @param {string} glob */
function compileGlob(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`${re}$`);
}

/** @param {string} root */
function resolveResourcesDir(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new InputError(`Input directory does not exist: ${root}`);
  }
  const direct = path.join(root, 'resources');
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }
  const mac = path.join(root, 'Contents', 'Resources');
  if (fs.existsSync(mac) && fs.statSync(mac).isDirectory()) {
    return mac;
  }
  throw new InputError(`Missing resources/ or Contents/Resources/ inside ${root}`);
}

/**
 * Walk a directory tree without following symbolic links or directory junctions.
 * @param {string} dir
 * @param {string} baseDir
 * @param {(fullPath: string, relPosix: string, size: number) => void} onFile
 * @param {(relPosix: string, isDir: boolean) => boolean} [shouldSkip]
 */
function walkDirectoryReadOnly(dir, baseDir, onFile, shouldSkip) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    const relPosix = path.relative(baseDir, full).replaceAll('\\', '/');
    const isDir = stat.isDirectory();
    if (shouldSkip && shouldSkip(relPosix, isDir)) continue;
    if (isDir) {
      walkDirectoryReadOnly(full, baseDir, onFile, shouldSkip);
    } else if (stat.isFile()) {
      onFile(full, relPosix, stat.size);
    }
  }
}

/** @param {string} asarPath */
function readAsarHeader(asarPath) {
  const stat = fs.lstatSync(asarPath);
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) < 16) {
      throw new InputError(`Corrupt ASAR header (too short): ${asarPath}`);
    }
    const payloadSize = prefix.readUInt32LE(0);
    const headerPickleSize = prefix.readUInt32LE(4);
    const jsonLen = prefix.readUInt32LE(12);
    const dataOffset = 8 + headerPickleSize;
    if (payloadSize !== 4 || jsonLen <= 0 || 16 + jsonLen > dataOffset || dataOffset > stat.size) {
      throw new InputError(`Invalid ASAR Pickle header offsets in ${asarPath}`);
    }
    const jsonBuf = Buffer.alloc(jsonLen);
    if (fs.readSync(fd, jsonBuf, 0, jsonLen, 16) < jsonLen) {
      throw new InputError(`Truncated ASAR JSON header in ${asarPath}`);
    }
    const parsed = JSON.parse(jsonBuf.toString('utf8'));
    if (!parsed || typeof parsed.files !== 'object' || parsed.files === null) {
      throw new InputError(`Missing files root in ASAR header: ${asarPath}`);
    }
    return { rootNode: parsed, dataOffset };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(`Failed to parse ASAR header (${asarPath}): ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Recursively flatten ASAR leaves while excluding `unpacked: true` entries from `asar:` byte totals.
 * @param {Record<string, unknown>} node
 * @param {string} relPrefix
 * @param {string} asarPath
 * @param {number} dataOffset
 * @param {FileRecord[]} out
 * @param {Set<string>} expectedUnpacked
 */
function flattenAsarNode(node, relPrefix, asarPath, dataOffset, out, expectedUnpacked) {
  const children = node.files;
  if (children && typeof children === 'object') {
    for (const [name, child] of Object.entries(/** @type {Record<string, unknown>} */ (children))) {
      if (!child || typeof child !== 'object') continue;
      const nextRel = relPrefix ? `${relPrefix}/${name}` : name;
      flattenAsarNode(/** @type {Record<string, unknown>} */ (child), nextRel, asarPath, dataOffset, out, expectedUnpacked);
    }
    return;
  }
  if (node.unpacked === true) {
    if (relPrefix) expectedUnpacked.add(relPrefix);
    return;
  }
  if (typeof node.size !== 'number' || !relPrefix) return;
  const integrity = /** @type {{ algorithm?: string; hash?: string } | undefined} */ (node.integrity);
  const hash = integrity?.algorithm === 'SHA256' && typeof integrity.hash === 'string'
    ? integrity.hash.toLowerCase()
    : null;
  out.push({
    layer: 'asar',
    logicalPath: `asar/${relPrefix}`,
    bytes: node.size,
    archivePath: asarPath,
    archiveOffset: dataOffset + Number(node.offset || 0),
    integrityHash: hash,
  });
}

/** @param {string} resourcesDir */
function scanAsarLayers(resourcesDir) {
  const asarPath = path.join(resourcesDir, 'app.asar');
  /** @type {FileRecord[]} */
  const records = [];
  /** @type {Set<string>} */
  const expectedUnpacked = new Set();
  if (fs.existsSync(asarPath)) {
    const { rootNode, dataOffset } = readAsarHeader(asarPath);
    flattenAsarNode(rootNode, '', asarPath, dataOffset, records, expectedUnpacked);
  }
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
  /** @type {Set<string>} */
  const actualUnpacked = new Set();
  walkDirectoryReadOnly(unpackedDir, unpackedDir, (fullPath, relPosix, size) => {
    actualUnpacked.add(relPosix);
    records.push({ layer: 'asar-unpacked', logicalPath: `asar-unpacked/${relPosix}`, bytes: size, fullPath });
  });
  for (const rel of expectedUnpacked) {
    if (!actualUnpacked.has(rel)) throw new InputError(`ASAR unpacked leaf missing in app.asar.unpacked/: ${rel}`);
  }
  return records;
}

/** @param {Buffer} buf */
function decodeTarOctal(buf) {
  const text = buf.toString('ascii').replace(/\0.*$/, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new InputError(`Invalid tar octal field: "${text}"`);
  }
  return Number.parseInt(text, 8);
}

/** @param {Buffer} block */
function verifyTarChecksum(block) {
  const stored = decodeTarOctal(block.subarray(148, 156));
  let unsignedSum = 0;
  for (let i = 0; i < TAR_BLOCK_BYTES; i += 1) {
    unsignedSum += i >= 148 && i < 156 ? 32 : block[i];
  }
  if (unsignedSum !== stored) {
    throw new InputError(`Corrupt tar header checksum: expected ${stored}, got ${unsignedSum}`);
  }
}

/**
 * Parse POSIX pax key=value records from an extended header payload.
 * @param {string} text
 */
function parsePaxAttributes(text) {
  /** @type {{ path?: string; size?: number }} */
  const attrs = {};
  let idx = 0;
  while (idx < text.length) {
    const space = text.indexOf(' ', idx);
    if (space <= idx) break;
    const recLen = Number.parseInt(text.slice(idx, space), 10);
    if (!Number.isFinite(recLen) || recLen <= 0) break;
    const record = text.slice(space + 1, idx + recLen).replace(/\n$/, '');
    const eq = record.indexOf('=');
    if (eq > 0) {
      const key = record.slice(0, eq);
      const val = record.slice(eq + 1);
      if (key === 'path') attrs.path = val;
      if (key === 'size') {
        const parsedSize = Number.parseInt(val, 10);
        if (Number.isFinite(parsedSize) && parsedSize >= 0) attrs.size = parsedSize;
      }
    }
    idx += recLen;
  }
  return attrs;
}

/** @param {Buffer} block */
const isZeroBlock = (block) => block.every((b) => b === 0);

/**
 * Read tar entry header path without payload.
 * @param {Buffer} block
 */
function readTarHeaderName(block) {
  const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  return (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, '');
}

/**
 * Record package name if a tar entry is a `.dsh-instances/<hash>/package.json`.
 * @param {number} fd
 * @param {string} entryPath
 * @param {number} entrySize
 * @param {number} pos
 * @param {Map<string, string>} instancePackages
 */
function maybeRecordInstancePackage(fd, entryPath, entrySize, pos, instancePackages) {
  const m = /^node_modules\/\.dsh-instances\/([^/]+)\/package\.json$/.exec(entryPath);
  if (!m || entrySize <= 0 || entrySize >= 256 * 1024) return;
  try {
    const pkg = JSON.parse(readTarPayloadUtf8(fd, entrySize, pos));
    if (pkg && typeof pkg.name === 'string') instancePackages.set(m[1], pkg.name);
  } catch { /* ignore invalid manifest */ }
}

/**
 * Read a fixed UTF-8 string slice from a tar archive payload.
 * @param {number} fd
 * @param {number} size
 * @param {number} pos
 */
function readTarPayloadUtf8(fd, size, pos) {
  const buf = Buffer.alloc(size);
  if (size > 0) fs.readSync(fd, buf, 0, size, pos);
  return buf.toString('utf8');
}

/** @param {string} tarPath */
function scanTarLayer(tarPath) {
  if (!fs.existsSync(tarPath)) return [];
  const totalSize = fs.lstatSync(tarPath).size;
  const fd = fs.openSync(tarPath, 'r');
  /** @type {FileRecord[]} */
  const records = [];
  /** @type {Map<string, string>} */
  const instancePackages = new Map();
  try {
    let pos = 0;
    /** @type {{ path?: string; size?: number }} */
    let paxNext = {};
    let gnuLongName = '';
    const hdr = Buffer.alloc(TAR_BLOCK_BYTES);

    while (pos < totalSize) {
      if (fs.readSync(fd, hdr, 0, TAR_BLOCK_BYTES, pos) < TAR_BLOCK_BYTES) {
        throw new InputError(`Truncated tar header at byte ${pos}: ${tarPath}`);
      }
      pos += TAR_BLOCK_BYTES;
      if (isZeroBlock(hdr)) break;
      verifyTarChecksum(hdr);

      const typeflag = String.fromCharCode(hdr[156] === 0 ? 48 : hdr[156]);
      const entrySize = paxNext.size !== undefined ? paxNext.size : decodeTarOctal(hdr.subarray(124, 136));
      const padded = Math.ceil(entrySize / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
      if (pos + padded > totalSize) {
        throw new InputError(`Truncated tar payload at byte ${pos}: ${tarPath}`);
      }

      if (typeflag === 'x') {
        paxNext = { ...paxNext, ...parsePaxAttributes(readTarPayloadUtf8(fd, entrySize, pos)) };
      } else if (typeflag === 'L') {
        gnuLongName = readTarPayloadUtf8(fd, entrySize, pos).replace(/\0+$/, '').replace(/^\.\//, '');
      } else if (typeflag === '0') {
        const entryPath = (paxNext.path || gnuLongName || readTarHeaderName(hdr)).replace(/^\.\//, '');
        maybeRecordInstancePackage(fd, entryPath, entrySize, pos, instancePackages);
        records.push({
          layer: 'tar',
          logicalPath: `tar/${entryPath}`,
          bytes: entrySize,
          archivePath: tarPath,
          archiveOffset: pos,
        });
        paxNext = {};
        gnuLongName = '';
      } else if (typeflag !== 'g' && typeflag !== 'K') {
        paxNext = {};
        gnuLongName = '';
      }
      pos += padded;
    }
    for (const rec of records) {
      const m = /^tar\/node_modules\/\.dsh-instances\/([^/]+)\/(.+)$/.exec(rec.logicalPath);
      if (m && instancePackages.has(m[1])) {
        rec.canonicalMatchPath = `tar/node_modules/${instancePackages.get(m[1])}/${m[2]}`;
      }
    }
    return records;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Scan all 4 logical layers inside a packaged desktop directory or staging root.
 * @param {string} inputDir
 */
function collectAllRecords(inputDir) {
  const resourcesDir = resolveResourcesDir(inputDir);
  const resolvedResources = path.resolve(resourcesDir);
  /** @type {FileRecord[]} */
  const records = [];

  walkDirectoryReadOnly(inputDir, inputDir, (fullPath, relPosix, size) => {
    records.push({ layer: 'base', logicalPath: `base/${relPosix}`, bytes: size, fullPath });
  }, (relPosix, isDir) => {
    if (!isDir) return false;
    return path.resolve(inputDir, relPosix) === resolvedResources;
  });

  records.push(...scanAsarLayers(resourcesDir));
  records.push(...scanTarLayer(path.join(resourcesDir, 'vendor', 'deepseek-harness.tar')));

  walkDirectoryReadOnly(resourcesDir, resourcesDir, (fullPath, relPosix, size) => {
    records.push({ layer: 'res', logicalPath: `res/${relPosix}`, bytes: size, fullPath });
  }, (relPosix) => (
    relPosix === 'app.asar'
    || relPosix === 'app.asar.unpacked'
    || relPosix.startsWith('app.asar.unpacked/')
    || relPosix === 'vendor/deepseek-harness.tar'
  ));

  return records;
}

/**
 * @param {string} filePath
 * @param {number} offset
 * @param {number} length
 */
function sha256Slice(filePath, offset, length) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunkSize = Math.min(length, 256 * 1024);
    const buf = Buffer.alloc(chunkSize);
    let remaining = length;
    let pos = offset;
    while (remaining > 0) {
      const toRead = Math.min(remaining, buf.length);
      const n = fs.readSync(fd, buf, 0, toRead, pos);
      if (n <= 0) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
      pos += n;
      remaining -= n;
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

/** @param {FileRecord} record */
function recordSha256(record) {
  if (record.integrityHash && /^[0-9a-f]{64}$/.test(record.integrityHash)) {
    return record.integrityHash;
  }
  if (record.archivePath !== undefined && record.archiveOffset !== undefined) {
    return sha256Slice(record.archivePath, record.archiveOffset, record.bytes);
  }
  if (record.fullPath) {
    return sha256Slice(record.fullPath, 0, record.bytes);
  }
  return null;
}

/** @param {FileRecord[]} records */
function findDuplicates(records) {
  /** @type {Map<number, FileRecord[]>} */
  const bySize = new Map();
  for (const record of records) {
    if (record.bytes < DUPLICATE_MIN_BYTES) continue;
    const list = bySize.get(record.bytes) || [];
    list.push(record);
    bySize.set(record.bytes, list);
  }
  /** @type {{ sha256: string; bytesEach: number; count: number; wastedBytes: number; paths: string[] }[]} */
  const duplicates = [];
  for (const [size, candidates] of bySize.entries()) {
    if (candidates.length < 2) continue;
    /** @type {Map<string, FileRecord[]>} */
    const byHash = new Map();
    for (const item of candidates) {
      const digest = recordSha256(item);
      if (!digest) continue;
      const list = byHash.get(digest) || [];
      list.push(item);
      byHash.set(digest, list);
    }
    for (const [sha256, group] of byHash.entries()) {
      if (group.length < 2) continue;
      duplicates.push({
        sha256,
        bytesEach: size,
        count: group.length,
        wastedBytes: (group.length - 1) * size,
        paths: group.map((g) => g.logicalPath).sort(),
      });
    }
  }
  duplicates.sort((a, b) => b.wastedBytes - a.wastedBytes);
  return duplicates;
}

/**
 * @param {string[] | undefined} targets
 * @param {string} target
 */
function isTargetForbidden(targets, target) {
  if (!Array.isArray(targets)) return false;
  if (targets.includes('all')) return true;
  if (targets.includes('launcher') && target.startsWith('launcher')) return true;
  return targets.includes(target);
}

/** @param {string} installerArg */
function resolveInstallerBytes(installerArg) {
  if (!installerArg) return null;
  const dir = path.dirname(installerArg);
  const pattern = path.basename(installerArg);
  if (!fs.existsSync(dir)) return null;
  const regex = compileGlob(pattern);
  const matches = fs.readdirSync(dir)
    .filter((name) => regex.test(name))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());
  if (matches.length === 0) return null;
  matches.sort();
  const chosen = matches[0];
  return { file: path.basename(chosen), bytes: fs.statSync(chosen).size };
}

function readGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * @param {string} filePath
 * @param {string} missingMessage
 */
function readJsonFile(filePath, missingMessage) {
  if (!fs.existsSync(filePath)) throw new InputError(`${missingMessage}: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new InputError(`Invalid JSON (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @param {FileRecord[]} records
 * @param {ComponentRule[]} rules
 * @param {string} target
 */
function classifyRecords(records, rules, target) {
  const compiled = rules
    .filter((rule) => !Array.isArray(rule.targets) || isTargetForbidden(rule.targets, target))
    .map((rule) => ({
      ...rule,
      forbiddenHere: isTargetForbidden(rule.forbidden?.targets, target),
      matchers: rule.match.map(compileGlob),
    }));

  /** @type {Record<string, { id: string; owner: string; bytes: number; files: number }>} */
  const bucket = {};
  for (const rule of compiled) {
    bucket[rule.id] = { id: rule.id, owner: rule.owner, bytes: 0, files: 0 };
  }

  /** @type {Record<FootprintLayer, { bytes: number; files: number }>} */
  const byLayer = {
    base: { bytes: 0, files: 0 },
    asar: { bytes: 0, files: 0 },
    'asar-unpacked': { bytes: 0, files: 0 },
    tar: { bytes: 0, files: 0 },
    res: { bytes: 0, files: 0 },
  };
  /** @type {{ component: string; owner: string; path: string; bytes: number }[]} */
  const forbidden = [];
  /** @type {{ path: string; bytes: number }[]} */
  const unclassifiedList = [];
  let totalBytes = 0;

  for (const rec of records) {
    totalBytes += rec.bytes;
    byLayer[rec.layer].bytes += rec.bytes;
    byLayer[rec.layer].files += 1;

    const hit = compiled.find((rule) => rule.matchers.some(
      (rx) => rx.test(rec.logicalPath) || (rec.canonicalMatchPath ? rx.test(rec.canonicalMatchPath) : false),
    ));
    if (!hit) {
      unclassifiedList.push({ path: rec.logicalPath, bytes: rec.bytes });
      continue;
    }
    bucket[hit.id].bytes += rec.bytes;
    bucket[hit.id].files += 1;
    if (hit.forbiddenHere) {
      forbidden.push({ component: hit.id, owner: hit.owner, path: rec.logicalPath, bytes: rec.bytes });
    }
  }

  unclassifiedList.sort((a, b) => b.bytes - a.bytes);
  const unclassifiedBytes = unclassifiedList.reduce((acc, item) => acc + item.bytes, 0);
  return {
    totalBytes,
    totalFiles: records.length,
    byLayer,
    bucket,
    forbidden,
    unclassified: { bytes: unclassifiedBytes, files: unclassifiedList.length, top: unclassifiedList.slice(0, 20) },
  };
}

/**
 * @param {{ target: string; totals: { bytes: number; files: number }; unclassified: { bytes: number }; duplicates: { wastedBytes: number }[]; forbidden: unknown[]; components: Array<{ id: string; owner: string; bytes: number; files: number; deltaBytes: number | null; maxBytes: number | null; status: string }> }} report
 * @returns {string}
 */
function renderMarkdown(report) {
  const lines = [
    `### Package Footprint Ledger (${report.target})`,
    '',
    `- Total: **${(report.totals.bytes / 1048576).toFixed(2)} MiB** (${report.totals.bytes} B, ${report.totals.files} files)`,
    `- Unclassified: **${(report.unclassified.bytes / 1048576).toFixed(2)} MiB** (${report.unclassified.bytes} B)`,
    `- Duplicate waste (>=256 KiB): **${report.duplicates.reduce((s, d) => s + d.wastedBytes, 0)} B**`,
    `- Forbidden hits: **${report.forbidden.length}**`,
    '',
    '| Component | Owner | Bytes | MiB | Files | Delta (B) | Budget (B) | Status |',
    '|---|---|---:|---:|---:|---:|---:|---|',
  ];
  for (const comp of report.components) {
    const mib = (comp.bytes / 1048576).toFixed(2);
    const delta = comp.deltaBytes === null ? '-' : String(comp.deltaBytes);
    const max = comp.maxBytes === null ? '-' : String(comp.maxBytes);
    lines.push(`| ${comp.id} | ${comp.owner} | ${comp.bytes} | ${mib} | ${comp.files} | ${delta} | ${max} | ${comp.status} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {TargetBudget | null} targetBudget
 * @param {ReturnType<typeof classifyRecords>} classified
 * @param {{ bytes: number } | null} installer
 * @param {{ wastedBytes: number }[]} duplicates
 * @param {Set<string>} pendingForbidden
 */
function exceedsAggregateBudgets(targetBudget, classified, installer, duplicates, pendingForbidden) {
  if (!targetBudget) {
    return classified.forbidden.some((hit) => !pendingForbidden.has(hit.component));
  }
  const checks = [
    typeof targetBudget.totalBytes === 'number' && classified.totalBytes > targetBudget.totalBytes,
    installer !== null && typeof targetBudget.installerBytes === 'number' && installer.bytes > targetBudget.installerBytes,
    typeof targetBudget.maxUnclassifiedBytes === 'number' && classified.unclassified.bytes > targetBudget.maxUnclassifiedBytes,
    typeof targetBudget.maxDuplicateBytes === 'number'
      && duplicates.reduce((s, d) => s + d.wastedBytes, 0) > targetBudget.maxDuplicateBytes,
  ];
  return checks.some(Boolean);
}

/**
 * Evaluate budget thresholds and forbidden entries.
 * @param {ReturnType<typeof classifyRecords>} classified
 * @param {TargetBudget | null} targetBudget
 * @param {{ bytes: number } | null} installer
 * @param {{ wastedBytes: number }[]} duplicates
 * @param {Record<string, { bytes: number }> | null} baselineComps
 * @param {boolean} recordingOnly
 */
function buildComponentReportAndCheck(classified, targetBudget, installer, duplicates, baselineComps, recordingOnly) {
  let failed = false;
  const pendingForbidden = new Set(targetBudget?.pendingSlimmingForbidden || []);
  const compBudgets = targetBudget?.components || {};

  const components = Object.values(classified.bucket).map((entry) => {
    const baselineBytes = baselineComps?.[entry.id]?.bytes ?? null;
    const deltaBytes = baselineBytes === null ? null : entry.bytes - baselineBytes;
    const budgetMax = compBudgets[entry.id]?.maxBytes;
    const maxBytes = typeof budgetMax === 'number' ? budgetMax : null;
    const hasActiveForbidden = classified.forbidden.some(
      (hit) => hit.component === entry.id && !pendingForbidden.has(entry.id),
    );
    let status = 'ok';
    if (hasActiveForbidden) {
      status = 'forbidden';
      if (!recordingOnly) failed = true;
    } else if (maxBytes !== null && entry.bytes > maxBytes) {
      status = 'over_budget';
      if (!recordingOnly) failed = true;
    }
    return { ...entry, baselineBytes, deltaBytes, maxBytes, status };
  });

  if (!recordingOnly && exceedsAggregateBudgets(targetBudget, classified, installer, duplicates, pendingForbidden)) {
    failed = true;
  }
  return { components, failed };
}

/** @param {string} inputPath */
function portableInputSource(inputPath) {
  const resolved = path.resolve(inputPath);
  const rel = path.relative(process.cwd(), resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return path.basename(resolved);
  }
  return rel.replaceAll('\\', '/');
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writeOutputFile(filePath, content) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

/** @param {string[]} argv */
export function runFootprintCli(argv) {
  const opts = parseCliArgs(argv);
  const rules = /** @type {ComponentRule[]} */ (readJsonFile(opts.componentsPath, 'Components config missing'));
  const records = collectAllRecords(opts.input);
  const classified = classifyRecords(records, rules, opts.target);
  const duplicates = findDuplicates(records);
  const installer = resolveInstallerBytes(opts.installer);
  const baseline = opts.baselinePath ? readJsonFile(opts.baselinePath, 'Baseline JSON missing') : null;
  const budgets = opts.budgetsPath ? readJsonFile(opts.budgetsPath, 'Budgets JSON missing') : null;
  const targetBudget = budgets?.[opts.target] || null;
  const baselineComps = baseline?.components
    ? Object.fromEntries(baseline.components.map((/** @type {{ id: string; bytes: number }} */ c) => [c.id, c]))
    : null;
  const { components, failed } = buildComponentReportAndCheck(
    classified, targetBudget, installer, duplicates, baselineComps, Boolean(opts.recordBaselinePath) && !opts.budgetsPath,
  );
  const report = {
    schemaVersion: 1,
    target: opts.target,
    source: { input: portableInputSource(opts.input), commit: readGitCommit() },
    totals: { bytes: classified.totalBytes, files: classified.totalFiles, byLayer: classified.byLayer },
    components,
    forbidden: classified.forbidden,
    duplicates,
    unclassified: classified.unclassified,
    installer: installer
      ? { ...installer, deltaBytes: baseline?.installer?.bytes != null ? installer.bytes - baseline.installer.bytes : null }
      : null,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeOutputFile(opts.recordBaselinePath, serialized);
  writeOutputFile(opts.outPath, serialized);
  writeOutputFile(opts.markdownPath, opts.markdownPath ? renderMarkdown(report) : '');
  return { report, failed };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    const { report, failed } = runFootprintCli(process.argv.slice(2));
    console.log(`[footprint] target=${report.target} total=${report.totals.bytes}B files=${report.totals.files} unclassified=${report.unclassified.bytes}B forbidden=${report.forbidden.length}`);
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`[footprint] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
