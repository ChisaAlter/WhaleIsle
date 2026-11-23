/**
 * Per-Bot MCP Tool Server Manager & Health Diagnostics.
 *
 * Isolates each bot's `.whale/bot-tools.json` and `_meta/bot-credentials/<botId>.json`,
 * validates server configuration & credential references, runs optional live probes
 * via `syncBotMcps`, and surfaces real diagnostics to `bots.tools.problems`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isSensitiveHeaderName } from '../../src/shared/index.js';
import {
  botMetaDir,
  botsRootDir,
  readBotToolCredentials,
} from './fs-home.js';

const ALLOWED_TRANSPORTS = new Set(['http', 'sse', 'streamable-http', 'stdio']);

/** @param {string} homeDir */
function readRawBotToolsFile(homeDir) {
  const file = path.join(homeDir, '.whale', 'bot-tools.json');
  if (!fs.existsSync(file)) {
    return { exists: false, servers: [], parseError: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || (parsed.servers !== undefined && !Array.isArray(parsed.servers))) {
      return { exists: true, servers: [], parseError: 'bot-tools.json must contain a "servers" array' };
    }
    return { exists: true, servers: Array.isArray(parsed.servers) ? parsed.servers : [], parseError: null };
  } catch (error) {
    return { exists: true, servers: [], parseError: String(/** @type {any} */ (error)?.message ?? error) };
  }
}

/** @param {string} rawUrl */
function isValidHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** @param {any} server */
function detectInlineSensitiveHeaders(server) {
  if (!server?.headers || typeof server.headers !== 'object') return [];
  return Object.keys(server.headers).filter((k) => isSensitiveHeaderName(k) && String(server.headers[k] ?? '').trim() !== '');
}

/** @param {string} botId @param {string | null} server @param {string} code @param {string} severity @param {string} message @param {number} checkedAt */
function makeProblem(botId, server, code, severity, message, checkedAt) {
  return { botId, server, code, severity, message, checkedAt };
}

/** @param {string} botId @param {string} name @param {string} transport @param {any} server @param {number} checkedAt */
function validateServerTransport(botId, name, transport, server, checkedAt) {
  const problems = [];
  if (!ALLOWED_TRANSPORTS.has(transport)) {
    problems.push(makeProblem(botId, name || null, 'invalid_transport', 'error', `Unsupported MCP transport: ${transport}`, checkedAt));
  } else if (transport === 'stdio') {
    if (typeof server.command !== 'string' || !server.command.trim()) {
      problems.push(makeProblem(botId, name || null, 'missing_command', 'error', `Stdio MCP server "${name || 'unnamed'}" is missing command`, checkedAt));
    }
  } else if (!isValidHttpUrl(server.url)) {
    problems.push(makeProblem(botId, name || null, 'invalid_url', 'error', `MCP server "${name || 'unnamed'}" requires a valid http(s) URL`, checkedAt));
  }
  return problems;
}

/** @param {string} botId @param {string} name @param {any} server @param {Record<string, any>} creds @param {number} checkedAt */
function validateServerCredentials(botId, name, server, creds, checkedAt) {
  const problems = [];
  const leakedHeaders = detectInlineSensitiveHeaders(server);
  if (leakedHeaders.length > 0) {
    problems.push(makeProblem(
      botId,
      name || null,
      'inline_credentials_detected',
      'error',
      `Inline sensitive headers (${leakedHeaders.join(', ')}) found in bot-tools.json; store credentials in _meta/bot-credentials`,
      checkedAt,
    ));
  }

  let resolvedCreds = null;
  const credId = typeof server.credential === 'string' ? server.credential.trim() : '';
  if (credId) {
    if (creds && Object.prototype.hasOwnProperty.call(creds, credId) && creds[credId]) {
      resolvedCreds = creds[credId];
    } else {
      problems.push(makeProblem(
        botId,
        name || null,
        'missing_credential',
        'error',
        `Referenced credential "${credId}" is missing from _meta/bot-credentials`,
        checkedAt,
      ));
    }
  }
  return { credId: credId || null, resolvedCreds, problems };
}

/**
 * Validate a single MCP server entry against its bot's credential map.
 * @param {string} botId
 * @param {any} server
 * @param {Record<string, any>} creds
 * @param {Set<string>} seenNames
 * @param {number} checkedAt
 */
function validateServerConfig(botId, server, creds, seenNames, checkedAt) {
  if (!server || typeof server !== 'object') {
    return {
      name: '',
      transport: 'http',
      enabled: false,
      hasCredential: false,
      resolvedCreds: null,
      problems: [makeProblem(botId, null, 'invalid_server_entry', 'error', 'Server entry must be an object', checkedAt)],
    };
  }

  const problems = [];
  const name = typeof server.name === 'string' ? server.name.trim() : '';
  const transport = typeof server.transport === 'string' && server.transport.trim()
    ? server.transport.trim().toLowerCase()
    : (server.command ? 'stdio' : 'http');

  if (!name) {
    problems.push(makeProblem(botId, null, 'missing_server_name', 'error', 'MCP server is missing a non-empty name', checkedAt));
  } else if (seenNames.has(name.toLowerCase())) {
    problems.push(makeProblem(botId, name, 'duplicate_server_name', 'error', `Duplicate MCP server name: ${name}`, checkedAt));
  } else {
    seenNames.add(name.toLowerCase());
  }

  problems.push(...validateServerTransport(botId, name, transport, server, checkedAt));
  const credRes = validateServerCredentials(botId, name, server, creds, checkedAt);
  problems.push(...credRes.problems);

  return {
    name,
    transport,
    enabled: server.enabled !== false,
    url: typeof server.url === 'string' ? server.url : undefined,
    command: typeof server.command === 'string' ? server.command : undefined,
    credential: credRes.credId,
    hasCredential: Boolean(credRes.resolvedCreds),
    resolvedCreds: credRes.resolvedCreds,
    problems,
  };
}

/**
 * Create the Per-Bot MCP Manager.
 * @param {{
 *   dshHome: string,
 *   botsStore: any,
 *   probeServer?: (server: any, creds: any, context: { botId: string }) => Promise<{ ok: boolean, code?: string, severity?: string, message?: string }>,
 *   now?: () => number,
 * }} deps
 */
export function createMcpManager(deps) {
  const { dshHome, botsStore, probeServer = null } = deps;
  const nowFn = deps.now ?? (() => Date.now());
  if (!dshHome || !botsStore) {
    throw new Error('createMcpManager requires dshHome and botsStore');
  }

  const botsRoot = botsRootDir(dshHome);
  const metaRoot = botMetaDir(dshHome);
  /** @type {Map<string, { syncedAt: number, runtimeProblems: Map<string, any[]> }>} */
  const runtimeState = new Map();

  /** @param {string} botId */
  function requireBot(botId) {
    const bot = botsStore.getBot(String(botId));
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  /** @param {any} bot @param {number} checkedAt */
  function inspectBot(bot, checkedAt) {
    const homeDir = path.join(botsRoot, bot.folder);
    const raw = readRawBotToolsFile(homeDir);
    const creds = readBotToolCredentials(metaRoot, bot.id);
    const cached = runtimeState.get(bot.id) ?? null;

    if (raw.parseError) {
      const problem = makeProblem(bot.id, null, 'invalid_config', 'error', raw.parseError, checkedAt);
      return {
        botId: bot.id,
        servers: [],
        problems: [problem],
        healthyCount: 0,
        errorCount: 1,
        checkedAt,
        lastSyncedAt: cached?.syncedAt ?? null,
      };
    }

    const seenNames = new Set();
    const allProblems = [];
    const servers = [];

    for (const entry of raw.servers) {
      const validated = validateServerConfig(bot.id, entry, creds, seenNames, checkedAt);
      const probeProblems = (validated.name ? cached?.runtimeProblems.get(validated.name) : null) ?? [];
      const combinedProblems = [...validated.problems, ...probeProblems];
      allProblems.push(...combinedProblems);

      let status = 'ready';
      if (!validated.enabled) status = 'disabled';
      else if (combinedProblems.some((p) => p.severity === 'error')) status = 'error';

      servers.push({
        name: validated.name,
        transport: validated.transport,
        enabled: validated.enabled,
        ...(validated.url !== undefined ? { url: validated.url } : {}),
        ...(validated.command !== undefined ? { command: validated.command } : {}),
        credential: validated.credential,
        hasCredential: validated.hasCredential,
        status,
        problems: combinedProblems,
        lastSyncedAt: cached?.syncedAt ?? null,
        _raw: entry,
        _resolvedCreds: validated.resolvedCreds,
      });
    }

    const healthyCount = servers.filter((s) => s.status === 'ready').length;
    const errorCount = servers.filter((s) => s.status === 'error').length;
    return {
      botId: bot.id,
      servers,
      problems: allProblems,
      healthyCount,
      errorCount,
      checkedAt,
      lastSyncedAt: cached?.syncedAt ?? null,
    };
  }

  /** @param {any} snapshot */
  function stripInternalFields(snapshot) {
    return {
      ...snapshot,
      servers: snapshot.servers.map((/** @type {any} */ { _raw, _resolvedCreds, ...pub }) => pub),
    };
  }

  /** @param {string} botId */
  function getBotMcpStatus(botId) {
    const bot = requireBot(botId);
    return stripInternalFields(inspectBot(bot, nowFn()));
  }

  /** @param {string | null} [botId] */
  function listBotToolsProblems(botId = null) {
    const checkedAt = nowFn();
    if (botId) {
      const bot = requireBot(botId);
      const snap = inspectBot(bot, checkedAt);
      return { botId: bot.id, problems: snap.problems, checkedAt };
    }
    const problems = [];
    for (const bot of botsStore.listBots()) {
      const snap = inspectBot(bot, checkedAt);
      problems.push(...snap.problems);
    }
    return { botId: null, problems, checkedAt };
  }

  /** @param {string} botId */
  async function syncBotMcps(botId) {
    const bot = requireBot(botId);
    const checkedAt = nowFn();
    const initial = inspectBot(bot, checkedAt);
    /** @type {Map<string, any[]>} */
    const runtimeProblems = new Map();

    if (typeof probeServer === 'function') {
      for (const srv of initial.servers) {
        if (!srv.enabled || !srv.name || srv.problems.some((p) => p.severity === 'error')) continue;
        try {
          const res = await probeServer(srv._raw, srv._resolvedCreds, { botId: bot.id });
          if (res && res.ok === false) {
            runtimeProblems.set(srv.name, [
              makeProblem(
                bot.id,
                srv.name,
                res.code || 'connection_failed',
                res.severity || 'error',
                res.message || `MCP server "${srv.name}" health check failed`,
                checkedAt,
              ),
            ]);
          }
        } catch (error) {
          const err = /** @type {any} */ (error);
          runtimeProblems.set(srv.name, [
            makeProblem(
              bot.id,
              srv.name,
              err?.code || 'connection_failed',
              'error',
              String(err?.message ?? err),
              checkedAt,
            ),
          ]);
        }
      }
    }

    runtimeState.set(bot.id, { syncedAt: checkedAt, runtimeProblems });
    return stripInternalFields(inspectBot(bot, checkedAt));
  }

  function close() {
    runtimeState.clear();
  }

  return {
    listBotToolsProblems,
    getBotMcpStatus,
    syncBotMcps,
    close,
  };
}
