/**
 * Per-bot MCP tools configuration (`<homeDir>/.whale/bot-tools.json`) and
 * isolated credential storage (`<metaRoot>/bot-credentials/<botId>.json`).
 *
 * Extracted from `fs-home.js` to keep filesystem modules modular and under the
 * file-length budget. Public APIs are re-exported by `fs-home.js`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** @param {string | Buffer} content */
function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** @param {string} botId @param {new (code: string, message: string, data?: Record<string, any>) => Error} ErrorCtor */
function safeIdSegment(botId, ErrorCtor) {
  const clean = encodeURIComponent(String(botId ?? '').trim());
  if (!clean || clean === '.' || clean === '..') {
    throw new ErrorCtor('invalid_argument', 'Invalid botId for filesystem path');
  }
  return clean;
}

/** @param {string} homeDir */
function botToolsConfigPath(homeDir) {
  return path.join(homeDir, '.whale', 'bot-tools.json');
}

/** @param {string} metaRoot @param {string} botId @param {new (code: string, message: string, data?: Record<string, any>) => Error} ErrorCtor */
function botCredentialsPath(metaRoot, botId, ErrorCtor) {
  return path.join(metaRoot, 'bot-credentials', `${safeIdSegment(botId, ErrorCtor)}.json`);
}

const KNOWN_TOOL_SERVER_KEYS = new Set([
  'id', 'name', 'url', 'transport', 'headers', 'credential',
  'command', 'args', 'env', 'disabled', 'enabled',
]);

/**
 * Deterministically stringify credential map for version hashing (sorted keys).
 * @param {Record<string, any> | null} creds
 */
function canonicalCredentialsFingerprint(creds) {
  if (!creds || typeof creds !== 'object') return 'none';
  /** @type {Record<string, any>} */
  const sorted = {};
  for (const key of Object.keys(creds).sort()) {
    const val = creds[key];
    if (val && typeof val === 'object' && val.headers && typeof val.headers === 'object') {
      /** @type {Record<string, any>} */
      const sortedHeaders = {};
      for (const hk of Object.keys(val.headers).sort()) {
        sortedHeaders[hk] = val.headers[hk];
      }
      sorted[key] = { ...val, headers: sortedHeaders };
    } else {
      sorted[key] = val;
    }
  }
  return sha256Hex(JSON.stringify(sorted));
}

/**
 * Compute optimistic version token hashing `bot-tools.json` + credential fingerprint.
 * @param {string} configRaw
 * @param {Record<string, any> | null} [creds]
 */
export function computeBotToolsVersion(configRaw, creds = null) {
  const cfgHash = sha256Hex(String(configRaw ?? ''));
  const credHash = canonicalCredentialsFingerprint(creds);
  return sha256Hex(`${cfgHash}:${credHash}`);
}

/** @param {string} homeDir */
function readBotToolsRaw(homeDir) {
  const file = botToolsConfigPath(homeDir);
  if (!fs.existsSync(file)) {
    return { exists: false, raw: '', parsed: /** @type {Record<string, any>} */ ({}) };
  }
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  return { exists: true, raw, parsed: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} };
}

/** @param {any[]} existingServers */
function indexExistingToolUnknownFields(existingServers) {
  /** @type {Map<string, Record<string, any>>} */
  const byName = new Map();
  for (const prev of existingServers) {
    if (!prev || typeof prev !== 'object' || typeof prev.name !== 'string') continue;
    /** @type {Record<string, any>} */
    const unknown = {};
    for (const [k, v] of Object.entries(prev)) {
      if (!KNOWN_TOOL_SERVER_KEYS.has(k)) unknown[k] = v;
    }
    if (Object.keys(unknown).length > 0) byName.set(prev.name, unknown);
  }
  return byName;
}

/**
 * @param {any[]} inputServers
 * @param {string} botId
 * @param {Map<string, Record<string, any>>} existingUnknownByName
 * @param {Record<string, any>} existingCreds
 */
function sanitizeToolServers(inputServers, botId, existingUnknownByName, existingCreds) {
  /** @type {Record<string, any>} */
  const nextCreds = {};
  const sanitizedServers = [];
  for (const server of inputServers) {
    if (!server || typeof server !== 'object') continue;
    const preservedUnknown = typeof server.name === 'string'
      ? (existingUnknownByName.get(server.name) ?? {})
      : {};
    const copy = { ...preservedUnknown, ...server };
    const hasHeaders = copy.headers && typeof copy.headers === 'object' && Object.keys(copy.headers).length > 0;
    if (hasHeaders) {
      const credId = typeof copy.credential === 'string' && copy.credential.trim()
        ? copy.credential.trim()
        : `cred_${sha256Hex(`${botId}:${copy.name ?? copy.url ?? crypto.randomUUID()}`).slice(0, 16)}`;
      nextCreds[credId] = { headers: { ...copy.headers } };
      delete copy.headers;
      copy.credential = credId;
    } else if (typeof copy.credential === 'string' && existingCreds[copy.credential]) {
      nextCreds[copy.credential] = existingCreds[copy.credential];
      delete copy.headers;
    }
    sanitizedServers.push(copy);
  }
  return { sanitizedServers, nextCreds };
}

/**
 * @param {Record<string, any>} beforeParsed
 * @param {Record<string, any> | null | undefined} config
 * @param {any[]} sanitizedServers
 */
function buildToolsConfigRaw(beforeParsed, config, sanitizedServers) {
  /** @type {Record<string, any>} */
  const payload = {};
  for (const [k, v] of Object.entries(beforeParsed)) {
    if (k !== 'servers') payload[k] = v;
  }
  if (config && typeof config === 'object') {
    for (const [k, v] of Object.entries(config)) {
      if (k !== 'servers' && k !== 'version') payload[k] = v;
    }
  }
  payload.servers = sanitizedServers;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * @param {{
 *   configFile: string,
 *   credsFile: string,
 *   beforeRaw: string,
 *   hadPrevCreds: boolean,
 *   prevCredsRaw: string | null,
 *   nextCreds: Record<string, any>,
 *   nextConfigRaw: string,
 *   options: { expectedVersion?: string, _writeConfigFile?: (filePath: string, content: string) => void },
 *   writeAtomicFile: (filePath: string, content: string | Buffer) => void,
 *   ErrorCtor: new (code: string, message: string, data?: Record<string, any>) => Error,
 * }} ctx
 */
function commitBotToolsWithRollback(ctx) {
  const {
    configFile, credsFile, beforeRaw, hadPrevCreds, prevCredsRaw,
    nextCreds, nextConfigRaw, options, writeAtomicFile, ErrorCtor,
  } = ctx;
  const rollbackCreds = () => {
    try {
      if (hadPrevCreds && prevCredsRaw !== null) writeAtomicFile(credsFile, prevCredsRaw);
      else if (fs.existsSync(credsFile)) fs.unlinkSync(credsFile);
    } catch {
      // Best-effort rollback
    }
  };

  try {
    if (Object.keys(nextCreds).length > 0) {
      writeAtomicFile(credsFile, `${JSON.stringify(nextCreds, null, 2)}\n`);
    } else if (fs.existsSync(credsFile)) {
      fs.unlinkSync(credsFile);
    }
    if (options.expectedVersion !== undefined && options.expectedVersion !== null) {
      const latestRaw = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
      if (latestRaw !== beforeRaw) {
        throw new ErrorCtor('changed-on-disk', 'bot-tools.json changed concurrently before commit', {
          expectedVersion: options.expectedVersion,
        });
      }
    }
    const writeConfig = typeof options._writeConfigFile === 'function' ? options._writeConfigFile : writeAtomicFile;
    writeConfig(configFile, nextConfigRaw);
  } catch (error) {
    rollbackCreds();
    throw error;
  }
}

/**
 * Create bound bot-tools config readers/writers using `fs-home.js` primitives.
 * @param {{
 *   BotFsError: new (code: string, message: string, data?: Record<string, any>) => Error,
 *   writeAtomicFile: (filePath: string, content: string | Buffer) => void,
 *   assertFolderOwnedByBot: (homeDir: string, botId: string) => any,
 * }} deps
 */
export function createBotToolsConfigOps(deps) {
  const { BotFsError, writeAtomicFile, assertFolderOwnedByBot } = deps;

  /** @param {string} metaRoot @param {string} botId */
  function readBotToolCredentials(metaRoot, botId) {
    const file = botCredentialsPath(metaRoot, botId, BotFsError);
    if (!fs.existsSync(file)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Read `<homeDir>/.whale/bot-tools.json` (credentials stay isolated in `_meta/bot-credentials`).
   * @param {string} homeDir
   * @param {string | null} [metaRoot]
   * @param {string | null} [botId]
   */
  function readBotToolsConfig(homeDir, metaRoot = null, botId = null) {
    const { raw, parsed } = readBotToolsRaw(homeDir);
    const servers = Array.isArray(parsed?.servers) ? parsed.servers : [];
    const creds = metaRoot && botId ? readBotToolCredentials(metaRoot, botId) : null;
    const version = computeBotToolsVersion(raw, creds);
    /** @type {Record<string, any>} */
    const extra = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k !== 'servers') extra[k] = v;
    }
    return { ...extra, servers, version };
  }

  /**
   * Write `<homeDir>/.whale/bot-tools.json`, stripping sensitive HTTP headers into
   * `<metaRoot>/bot-credentials/<botId>.json`.
   * @param {string} homeDir
   * @param {string} metaRoot
   * @param {string} botId
   * @param {{ servers: Array<Record<string, any>>, [key: string]: any }} config
   * @param {{ expectedVersion?: string, _writeConfigFile?: (filePath: string, content: string) => void }} [options]
   */
  function writeBotToolsConfig(homeDir, metaRoot, botId, config, options = {}) {
    assertFolderOwnedByBot(homeDir, botId);

    const configFile = botToolsConfigPath(homeDir);
    const credsFile = botCredentialsPath(metaRoot, botId, BotFsError);
    const before = readBotToolsRaw(homeDir);
    const hadPrevCreds = fs.existsSync(credsFile);
    const prevCredsRaw = hadPrevCreds ? fs.readFileSync(credsFile, 'utf8') : null;
    const existingCreds = readBotToolCredentials(metaRoot, botId);
    const currentVersion = computeBotToolsVersion(before.raw, existingCreds);

    if (options.expectedVersion !== undefined && options.expectedVersion !== null && currentVersion !== options.expectedVersion) {
      throw new BotFsError('changed-on-disk', 'bot-tools.json or credentials changed since last read', {
        expectedVersion: options.expectedVersion,
        actualVersion: currentVersion,
      });
    }

    const existingServers = Array.isArray(before.parsed?.servers) ? before.parsed.servers : [];
    const existingUnknownByName = indexExistingToolUnknownFields(existingServers);
    const inputServers = Array.isArray(config?.servers) ? config.servers : [];
    const { sanitizedServers, nextCreds } = sanitizeToolServers(inputServers, botId, existingUnknownByName, existingCreds);
    const nextConfigRaw = buildToolsConfigRaw(before.parsed, config, sanitizedServers);

    commitBotToolsWithRollback({
      configFile,
      credsFile,
      beforeRaw: before.raw,
      hadPrevCreds,
      prevCredsRaw,
      nextCreds,
      nextConfigRaw,
      options,
      writeAtomicFile,
      ErrorCtor: BotFsError,
    });

    const nextVersion = computeBotToolsVersion(nextConfigRaw, nextCreds);
    return {
      servers: sanitizedServers,
      credentialIds: Object.keys(nextCreds),
      version: nextVersion,
    };
  }

  return { readBotToolCredentials, readBotToolsConfig, writeBotToolsConfig };
}
