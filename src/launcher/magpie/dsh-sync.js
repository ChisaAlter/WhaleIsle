'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isMap, isScalar, isSeq, parseDocument } = require('yaml');
const { atomicWriteFileSync, safeRemoveSync } = require('../../shared/fs-safe');
const { toLoopbackHostPort } = require('./detect');

const WHALEBRIDGE_REF = 'WHALEBRIDGE_GATEWAY_KEY';
const MAGPIE_REF = 'MAGPIE_GATEWAY_KEY';
const MAGPIE_LEGACY_REF = 'MAGPIE_API_KEY';
const PROFILE_PATCH = ['profiles', 'web', 'cordis.patch.yml'];
const PROFILE_LOCK_TARGET = ['profiles', 'web', 'package.json'];
const MAGPIE_CHANNEL_NAMES = ['magpie', 'magpie-responses', 'magpie-anthropic'];

const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
const DEFAULT_LOCK_WAIT_MS = 2000;

const sleepSync = (() => {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  return /** @param {number} ms */ (ms) => Atomics.wait(cell, 0, 0, ms);
})();

const sleepAsync = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} file
 * @returns {string}
 */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Check whether an `<target>.lock` holder PID (`<pid>\n`) has exited (`ESRCH`).
 * @param {string} record
 * @returns {boolean}
 */
function holderExited(record) {
  if (!/^\d+\n$/.test(record)) return false;
  const pid = Number(record.trim());
  if (pid === 0 || pid > 0x7fffffff || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'ESRCH';
  }
}

/** @param {string} lockPath */
function readLockRecordSync(lockPath) {
  try {
    return fs.readFileSync(lockPath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} error
 * @param {string} lockPath
 */
function isLockContentionSync(error, lockPath) {
  const code = /** @type {NodeJS.ErrnoException | null} */ (error)?.code;
  if (code === 'EEXIST') return true;
  if (code !== 'EPERM') return false;
  try {
    fs.lstatSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} lockPath */
function takeOverExitedLockSync(lockPath) {
  const record = readLockRecordSync(lockPath);
  if (record === undefined || !holderExited(record)) return false;
  const claim = `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`;
  try {
    fs.writeFileSync(claim, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'EEXIST' || code === 'EPERM') return false;
    throw error;
  }
  try {
    if (readLockRecordSync(lockPath) !== record || !holderExited(record)) return false;
    return safeRemoveSync(lockPath).ok;
  } finally {
    safeRemoveSync(claim);
  }
}

/**
 * Synchronous DSH-compatible `<target>.lock` (`wx` + `${process.pid}\n` + `ESRCH` takeover).
 * @template T
 * @param {string} targetFile
 * @param {() => T} operation
 * @param {{ waitMs?: number }} [options]
 * @returns {T}
 */
function withFileLockSync(targetFile, operation, options = {}) {
  const lockPath = `${targetFile}.lock`;
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_LOCK_WAIT_MS);
  let delayMs = LOCK_RETRY_INITIAL_MS;
  let retriedPerm = false;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      if (!isLockContentionSync(error, lockPath)) {
        const code = /** @type {NodeJS.ErrnoException | null} */ (error)?.code;
        if (process.platform !== 'win32' || code !== 'EPERM' || retriedPerm) throw error;
        retriedPerm = true;
      } else if (takeOverExitedLockSync(lockPath)) {
        continue;
      }
    }
    if (Date.now() >= deadline) {
      const err = new Error(`dsh-sync: timed out waiting for writer lock at ${lockPath}`);
      /** @type {any} */ (err).code = 'FILE_LOCK_TIMEOUT';
      throw err;
    }
    sleepSync(delayMs);
    delayMs = Math.min(delayMs * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return operation();
  } finally {
    safeRemoveSync(lockPath);
  }
}

/**
 * Async DSH-compatible `<target>.lock` (`wx` + `${process.pid}\n` + `ESRCH` takeover).
 * @template T
 * @param {string} targetFile
 * @param {() => Promise<T>} operation
 * @param {{ waitMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function withFileLock(targetFile, operation, options = {}) {
  const lockPath = `${targetFile}.lock`;
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_LOCK_WAIT_MS);
  let delayMs = LOCK_RETRY_INITIAL_MS;
  let retriedPerm = false;
  for (;;) {
    try {
      await fs.promises.writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      if (!isLockContentionSync(error, lockPath)) {
        const code = /** @type {NodeJS.ErrnoException | null} */ (error)?.code;
        if (process.platform !== 'win32' || code !== 'EPERM' || retriedPerm) throw error;
        retriedPerm = true;
      } else if (takeOverExitedLockSync(lockPath)) {
        continue;
      }
    }
    if (Date.now() >= deadline) {
      const err = new Error(`dsh-sync: timed out waiting for writer lock at ${lockPath}`);
      /** @type {any} */ (err).code = 'FILE_LOCK_TIMEOUT';
      throw err;
    }
    await sleepAsync(delayMs);
    delayMs = Math.min(delayMs * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    safeRemoveSync(lockPath);
  }
}

/**
 * Parse YAML document strictly with `uniqueKeys: true`.
 * Redacts value quotes in error messages when `redact` is true (for `.credentials.yaml`).
 * @param {string} text
 * @param {string} label
 * @param {{ redact?: boolean }} [options]
 * @returns {import('yaml').Document<any, true>}
 */
function parseYamlStrict(text, label, options = {}) {
  const doc = /** @type {import('yaml').Document<any, true>} */ (parseDocument(text, { uniqueKeys: true }));
  if (doc.errors.length > 0) {
    const detail = options.redact
      ? doc.errors.map((e) => e.code || 'YAML_PARSE_ERROR').join(', ')
      : doc.errors[0].message;
    throw new Error(`${label} YAML 解析失败：${detail}`);
  }
  return doc;
}

/**
 * Serialize YAML AST and validate the resulting text has no parse errors or duplicate keys.
 * @param {import('yaml').Document} doc
 * @param {string} label
 * @param {{ redact?: boolean, eol?: string }} [options]
 * @returns {string}
 */
function serializeAndVerifyYaml(doc, label, options = {}) {
  const eol = options.eol || '\n';
  let out = doc.toString();
  if (eol === '\r\n') {
    out = out.replace(/\r?\n/g, '\r\n');
  }
  if (out && !out.endsWith(eol)) {
    out += eol;
  }
  parseYamlStrict(out, label, { redact: options.redact });
  return out;
}

/**
 * Remove all owned provider blocks matching `names` & `refs`; returns null when untouched.
 * @param {string} text
 * @param {string[]} names
 * @param {string[]} refs
 * @returns {string | null}
 */
function removeOwnedChannelBlocks(text, names, refs) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const doc = parseYamlStrict(text, 'cordis.patch.yml');
  if (!isSeq(doc.contents)) return null;
  let changed = false;
  for (const item of doc.contents.items) {
    if (!isMap(item) || item.get('id') !== 'llm-pi-ai') continue;
    const config = item.get('config', true);
    if (!isMap(config)) continue;
    const providers = config.get('providers', true);
    if (!isMap(providers)) continue;
    for (const name of names) {
      if (!providers.has(name)) continue;
      const chan = providers.get(name, true);
      const apiKeyEnv = isMap(chan) ? chan.get('apiKeyEnv') : undefined;
      if (typeof apiKeyEnv === 'string' && refs.includes(apiKeyEnv)) {
        providers.delete(name);
        changed = true;
      }
    }
    if (changed && providers.items.length === 0) {
      providers.flow = true;
    }
  }
  if (!changed) return null;
  return serializeAndVerifyYaml(doc, 'cordis.patch.yml', { eol });
}

/**
 * Remove managed gateway credential keys from `.credentials.yaml`.
 * @param {string} text
 * @param {string[]} refs
 * @returns {string | null}
 */
function removeGatewayRefs(text, refs) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const doc = parseYamlStrict(text, '.credentials.yaml', { redact: true });
  if (!isMap(doc.contents)) return null;
  let changed = false;
  const refsNode = doc.contents.get('refs', true);
  if (isMap(refsNode)) {
    for (const key of refs) {
      if (refsNode.has(key)) {
        refsNode.delete(key);
        changed = true;
      }
    }
    if (changed && refsNode.items.length === 0) {
      refsNode.flow = true;
    }
  }
  for (const key of refs) {
    if (doc.contents.has(key)) {
      doc.contents.delete(key);
      changed = true;
    }
  }
  if (!changed) return null;
  return serializeAndVerifyYaml(doc, '.credentials.yaml', { redact: true, eol });
}

/**
 * @param {string} dshHome
 * @param {string[]} names
 * @param {string[]} refs
 * @returns {{ changed: boolean }}
 */
function detachChannels(dshHome, names, refs) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return { changed: false };
  let changed = false;
  const patchTargets = [
    { file: path.join(dshHome, 'cordis.patch.yml'), lockTarget: path.join(dshHome, 'cordis.patch.yml') },
    { file: path.join(dshHome, ...PROFILE_PATCH), lockTarget: path.join(dshHome, ...PROFILE_LOCK_TARGET) },
  ];
  for (const { file, lockTarget } of patchTargets) {
    if (!fs.existsSync(file)) continue;
    withFileLockSync(lockTarget, () => {
      const text = readText(file);
      const next = text ? removeOwnedChannelBlocks(text, names, refs) : null;
      if (next !== null) {
        atomicWriteFileSync(file, next);
        changed = true;
      }
    });
  }
  const credentials = path.join(dshHome, '.credentials.yaml');
  if (fs.existsSync(credentials)) {
    withFileLockSync(credentials, () => {
      const text = readText(credentials);
      const next = text ? removeGatewayRefs(text, refs) : null;
      if (next !== null) {
        atomicWriteFileSync(credentials, next, { mode: 0o600 });
        changed = true;
      }
    });
  }
  return { changed };
}

/** Detach legacy WhaleBridge channel (`providers.whalebridge` + `WHALEBRIDGE_GATEWAY_KEY`). */
/** @param {string} dshHome */
function detachWhaleBridgeDshChannel(dshHome) {
  return detachChannels(dshHome, ['whalebridge'], [WHALEBRIDGE_REF]);
}

/** Detach Magpie channels (`magpie`, `magpie-responses`, `magpie-anthropic`) + `MAGPIE_GATEWAY_KEY`. */
/** @param {string} dshHome */
function detachMagpieDshChannels(dshHome) {
  return detachChannels(dshHome, MAGPIE_CHANNEL_NAMES, [MAGPIE_REF, MAGPIE_LEGACY_REF]);
}

/**
 * Ensure `<dshHome>/profiles/web/cordis.patch.yml` exists before spawning Magpie,
 * so upstream `internal/agent/dsh.go` never falls back to `profiles/desktop/`.
 * @param {string} dshHome
 */
function ensureDshWebProfileExists(dshHome) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return;
  const patchFile = path.join(dshHome, ...PROFILE_PATCH);
  if (fs.existsSync(patchFile)) return;
  withFileLockSync(path.join(dshHome, ...PROFILE_LOCK_TARGET), () => {
    if (fs.existsSync(patchFile)) return;
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
    atomicWriteFileSync(patchFile, '[]\n');
  });
}

/**
 * Read current `agent-default-model` from `profiles/web/cordis.patch.yml` or home `cordis.patch.yml`.
 * @param {string} dshHome
 * @returns {{ provider: string, model: string, reasoningEffort: string } | null}
 */
function readDshDefaultModel(dshHome) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return null;
  for (const file of [path.join(dshHome, ...PROFILE_PATCH), path.join(dshHome, 'cordis.patch.yml')]) {
    const text = readText(file);
    if (!text) continue;
    let doc;
    try {
      doc = parseYamlStrict(text, file);
    } catch {
      continue;
    }
    if (!isSeq(doc.contents)) continue;
    const entry = doc.contents.items.find((item) => isMap(item) && item.get('id') === 'agent-default-model');
    if (!isMap(entry)) continue;
    const config = entry.get('config', true);
    const holder = isMap(config) ? config : entry;
    const provider = String(holder.get('provider') ?? '').trim();
    const model = String(holder.get('model') ?? '').trim();
    const reasoningEffort = String(holder.get('reasoningEffort') ?? '').trim();
    if (provider || model) return { provider, model, reasoningEffort };
  }
  return null;
}

/**
 * Remap `agent-default-model` provider in DSH patch files (e.g. `whalebridge` -> `magpie`).
 * @param {string} dshHome
 * @param {string} fromProvider
 * @param {string} toProvider
 * @returns {boolean}
 */
function remapDshDefaultModel(dshHome, fromProvider, toProvider) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return false;
  let updated = false;
  const targets = [
    { file: path.join(dshHome, ...PROFILE_PATCH), lockTarget: path.join(dshHome, ...PROFILE_LOCK_TARGET) },
    { file: path.join(dshHome, 'cordis.patch.yml'), lockTarget: path.join(dshHome, 'cordis.patch.yml') },
  ];
  for (const { file, lockTarget } of targets) {
    if (!fs.existsSync(file)) continue;
    withFileLockSync(lockTarget, () => {
      const text = readText(file);
      if (!text) return;
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const doc = parseYamlStrict(text, 'cordis.patch.yml');
      if (!isSeq(doc.contents)) return;
      let changed = false;
      for (const item of doc.contents.items) {
        if (!isMap(item) || item.get('id') !== 'agent-default-model') continue;
        const config = item.get('config', true);
        const holder = isMap(config) ? config : item;
        if (holder.get('provider') === fromProvider) {
          holder.set('provider', toProvider);
          changed = true;
        }
      }
      if (changed) {
        atomicWriteFileSync(file, serializeAndVerifyYaml(doc, 'cordis.patch.yml', { eol }));
        updated = true;
      }
    });
  }
  return updated;
}

/** @param {string} raw */
function hasYamlDirectives(raw) {
  return /^(?:(?:---|\.\.\.)(?=\s|$)|%(?:YAML|TAG)\b)/m.test(raw);
}

/** @param {import('yaml').YAMLMap} map */
function isFlatScalarMap(map) {
  return map.items.every((pair) => isScalar(pair.key) && isScalar(pair.value));
}

/**
 * Migrate an unversioned `.credentials.yaml` to the `version: 1` layout
 * required by `@deepseek-ai/dsh-credentials-local` >= 0.2.3 without losing any
 * existing entries, comments, or values.
 * @param {string} raw
 * @returns {{ text: string, migrated: boolean }}
 */
function ensureVersionedCredentialsLayout(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const doc = parseYamlStrict(raw, '.credentials.yaml', { redact: true });
  const root = doc.contents;
  if (root === null || (isMap(root) && root.items.length === 0)) {
    const suffix = raw.endsWith('\n') || raw === '' ? '' : eol;
    const out = `${raw}${suffix}version: 1${eol}refs:${eol}`;
    parseYamlStrict(out, '.credentials.yaml', { redact: true });
    return { text: out, migrated: true };
  }
  if (!isMap(root)) {
    throw new Error('.credentials.yaml 顶层必须是 YAML 映射');
  }
  if (root.has('version')) {
    if (root.get('version') !== 1) {
      throw new Error(`.credentials.yaml version 不受支持：${JSON.stringify(root.get('version'))}`);
    }
    return { text: raw, migrated: false };
  }
  if (root.has('refs') || root.has('records')) {
    if (!hasYamlDirectives(raw)) {
      const candidate = `version: 1${eol}${raw}`;
      parseYamlStrict(candidate, '.credentials.yaml', { redact: true });
      return { text: candidate, migrated: true };
    }
    root.items.unshift(doc.createPair('version', 1));
    return { text: serializeAndVerifyYaml(doc, '.credentials.yaml', { redact: true, eol }), migrated: true };
  }
  if (!hasYamlDirectives(raw) && !root.flow && isFlatScalarMap(root)) {
    const trimmed = raw.replace(/\r?\n$/, '');
    const indented = trimmed.split(/\r?\n/).map((line) => (line.length === 0 ? line : `  ${line}`)).join(eol);
    const candidate = `version: 1${eol}refs:${eol}${indented}${eol}`;
    parseYamlStrict(candidate, '.credentials.yaml', { redact: true });
    return { text: candidate, migrated: true };
  }
  root.flow = false;
  const wrapped = /** @type {import('yaml').Document<any, true>} */ (parseDocument('version: 1\nrefs: {}\n', { uniqueKeys: true }));
  wrapped.set('refs', root);
  return { text: serializeAndVerifyYaml(wrapped, '.credentials.yaml', { redact: true, eol }), migrated: true };
}

/**
 * Ensure `version: 1` and `refs.MAGPIE_GATEWAY_KEY: magpie` are recorded in
 * `<dshHome>/.credentials.yaml` without clobbering any non-Magpie value already
 * set by the user.
 * @param {string} dshHome
 * @returns {boolean}
 */
function ensureMagpieCredentialRef(dshHome) {
  const file = path.join(dshHome, '.credentials.yaml');
  return withFileLockSync(file, () => {
    const raw = readText(file);
    if (!raw.trim()) {
      fs.mkdirSync(dshHome, { recursive: true });
      const fresh = `version: 1\nrefs:\n  ${MAGPIE_REF}: magpie\n`;
      parseYamlStrict(fresh, '.credentials.yaml', { redact: true });
      atomicWriteFileSync(file, fresh, { mode: 0o600 });
      return true;
    }
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const { text: base, migrated } = ensureVersionedCredentialsLayout(raw);
    const doc = parseYamlStrict(base, '.credentials.yaml', { redact: true });
    if (!isMap(doc.contents)) {
      throw new Error('.credentials.yaml 顶层必须是 YAML 映射');
    }
    /** @type {any} */
    let refsNode = doc.contents.get('refs', true);
    if (isMap(refsNode) && refsNode.has(MAGPIE_REF)) {
      const val = String(refsNode.get(MAGPIE_REF) ?? '').trim();
      if (migrated) {
        atomicWriteFileSync(file, base.replace(/\r?\n?$/, '\n'), { mode: 0o600 });
      }
      return val === 'magpie';
    }
    if (isMap(refsNode)) {
      refsNode.flow = false;
      refsNode.items.unshift(doc.createPair(MAGPIE_REF, 'magpie'));
    } else {
      refsNode = doc.createNode({ [MAGPIE_REF]: 'magpie' });
      doc.contents.set('refs', refsNode);
    }
    const nextText = serializeAndVerifyYaml(doc, '.credentials.yaml', { redact: true, eol });
    atomicWriteFileSync(file, nextText, { mode: 0o600 });
    return true;
  });
}

/**
 * Read the effective `MAGPIE_GATEWAY_KEY` from `<dshHome>/.credentials.yaml`, falling back to `'magpie'`.
 * @param {string} dshHome
 * @returns {string}
 */
function readMagpieGatewayKey(dshHome) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return 'magpie';
  const raw = readText(path.join(dshHome, '.credentials.yaml'));
  if (!raw.trim()) return 'magpie';
  try {
    const doc = parseYamlStrict(raw, '.credentials.yaml', { redact: true });
    if (!isMap(doc.contents)) return 'magpie';
    const refVal = doc.getIn(['refs', MAGPIE_REF]) ?? doc.get(MAGPIE_REF);
    if (typeof refVal === 'string' && refVal.trim()) return refVal.trim();
  } catch {
    // Fall back to default key when unreadable.
  }
  return 'magpie';
}

/**
 * Build channel config object for `providers.<channelName>` inside `llm-pi-ai`.
 * @param {string} api
 * @param {string} baseUrl
 * @param {any[]} models
 */
function buildChannelSpec(api, baseUrl, models) {
  /** @type {any[]} */
  const entries = [];
  for (const model of models) {
    const id = typeof model?.id === 'string' ? model.id : '';
    if (!id) continue;
    /** @type {Record<string, any>} */
    const item = { id };
    if (typeof model.name === 'string' && model.name) item.name = model.name;
    if (typeof model.context_window === 'number' && model.context_window > 0) item.contextWindow = model.context_window;
    if (typeof model.max_tokens === 'number' && model.max_tokens > 0) item.maxTokens = model.max_tokens;
    if (typeof model.compaction_threshold === 'number' && model.compaction_threshold > 0) {
      item.compactionThreshold = model.compaction_threshold;
    }
    entries.push(item);
  }
  return {
    baseUrl,
    api,
    apiKeyEnv: MAGPIE_REF,
    models: entries,
  };
}

/**
 * @param {string} addr
 * @param {((url: string, init?: RequestInit) => Promise<any>) | undefined} fetchJson
 * @param {((url: string, init?: RequestInit) => Promise<Response>) | undefined} fetchImpl
 * @param {string} [apiKey]
 * @returns {Promise<any[]>}
 */
async function fetchGatewayModels(addr, fetchJson, fetchImpl, apiKey = 'magpie') {
  const safeAddr = toLoopbackHostPort(addr);
  const headers = { Authorization: `Bearer ${apiKey}` };
  let data;
  if (fetchJson) {
    data = await fetchJson(`http://${safeAddr}/v1/models`, { headers });
  } else {
    const doFetch = fetchImpl || fetch;
    const response = await doFetch(`http://${safeAddr}/v1/models`, { headers, signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      throw new Error(`Magpie /v1/models 返回 HTTP ${response.status}`);
    }
    data = await response.json();
  }
  if (!data || !Array.isArray(data.data)) {
    throw new Error('Magpie /v1/models 返回格式无效');
  }
  return data.data;
}

/**
 * Upsert Magpie channels into `cordis.patch.yml` YAML AST without clobbering foreign providers.
 * @param {string} raw
 * @param {Array<{ name: string, spec: Record<string, any> }>} channels
 * @returns {string}
 */
function upsertMagpieChannelsAst(raw, channels) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const cleaned = raw.trim()
    ? (removeOwnedChannelBlocks(raw, MAGPIE_CHANNEL_NAMES, [MAGPIE_REF, MAGPIE_LEGACY_REF]) ?? raw)
    : '[]\n';
  const doc = parseYamlStrict(cleaned, 'cordis.patch.yml');
  if (doc.contents === null) {
    doc.contents = doc.createNode([]);
  }
  if (!isSeq(doc.contents)) {
    throw new Error('cordis.patch.yml 顶层必须是 YAML 序列');
  }
  doc.contents.flow = false;

  /** @type {any} */
  let llmEntry = doc.contents.items.find(
    (/** @type {any} */ item) => isMap(item) && item.get('id') === 'llm-pi-ai' && !item.has('insert'),
  );
  if (!isMap(llmEntry)) {
    llmEntry = doc.createNode({ id: 'llm-pi-ai', config: { providers: {} } });
    doc.contents.add(llmEntry);
  }
  /** @type {any} */
  let configNode = llmEntry.get('config', true);
  if (!isMap(configNode)) {
    configNode = doc.createNode({ providers: {} });
    llmEntry.set('config', configNode);
  }
  configNode.flow = false;
  /** @type {any} */
  let providersNode = configNode.get('providers', true);
  if (!isMap(providersNode)) {
    providersNode = doc.createNode({});
    configNode.set('providers', providersNode);
  }
  providersNode.flow = false;

  for (const { name, spec } of channels) {
    if (providersNode.has(name)) {
      // Preserve channel with a foreign apiKeyEnv or user custom entry.
      continue;
    }
    providersNode.set(name, doc.createNode(spec));
  }
  return serializeAndVerifyYaml(doc, 'cordis.patch.yml', { eol });
}

/**
 * Upsert Magpie provider channels into `<dshHome>/profiles/web/cordis.patch.yml`
 * when reusing an external Magpie instance that lacks `DSH_HOME` in its env.
 * Preserves any non-Magpie providers and skips channels with foreign `apiKeyEnv`.
 * @param {{ dshHome: string, gatewayAddr: string, fetchJson?: (url: string, init?: RequestInit) => Promise<any>, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} options
 */
async function syncDshToMagpieGateway({ dshHome, gatewayAddr, fetchJson, fetchImpl }) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return { synced: false };
  ensureDshWebProfileExists(dshHome);
  ensureMagpieCredentialRef(dshHome);
  const apiKey = readMagpieGatewayKey(dshHome);
  const addr = toLoopbackHostPort(gatewayAddr);
  // Fetch models BEFORE acquiring the file lock so network I/O never stalls DSH writers.
  const models = await fetchGatewayModels(addr, fetchJson, fetchImpl, apiKey);

  const completions = [];
  const responses = [];
  const anthropic = [];
  for (const m of models) {
    const api = String(m?.api || '').toLowerCase();
    if (api === 'openai-responses') responses.push(m);
    else if (api === 'anthropic-messages') anthropic.push(m);
    else completions.push(m);
  }
  const channels = [
    { name: 'magpie', spec: buildChannelSpec('openai-completions', `http://${addr}/v1`, completions) },
    ...(responses.length ? [{ name: 'magpie-responses', spec: buildChannelSpec('openai-responses', `http://${addr}/v1`, responses) }] : []),
    ...(anthropic.length ? [{ name: 'magpie-anthropic', spec: buildChannelSpec('anthropic-messages', `http://${addr}`, anthropic) }] : []),
  ];

  const patchFile = path.join(dshHome, ...PROFILE_PATCH);
  await withFileLock(path.join(dshHome, ...PROFILE_LOCK_TARGET), async () => {
    const raw = readText(patchFile);
    const next = upsertMagpieChannelsAst(raw, channels);
    atomicWriteFileSync(patchFile, next);
  });

  // Clean managed Magpie blocks in home-level cordis.patch.yml so stale port overrides cannot shadow profile patch.
  const homePatchFile = path.join(dshHome, 'cordis.patch.yml');
  if (fs.existsSync(homePatchFile)) {
    await withFileLock(homePatchFile, async () => {
      const homeRaw = readText(homePatchFile);
      const cleanedHome = homeRaw
        ? removeOwnedChannelBlocks(homeRaw, MAGPIE_CHANNEL_NAMES, [MAGPIE_REF, MAGPIE_LEGACY_REF])
        : null;
      if (cleanedHome !== null) {
        atomicWriteFileSync(homePatchFile, cleanedHome);
      }
    });
  }
  return { synced: true, modelCount: models.length };
}

module.exports = {
  detachWhaleBridgeDshChannel,
  detachMagpieDshChannels,
  ensureDshWebProfileExists,
  ensureMagpieCredentialRef,
  readDshDefaultModel,
  remapDshDefaultModel,
  syncDshToMagpieGateway,
  withFileLockSync,
};
