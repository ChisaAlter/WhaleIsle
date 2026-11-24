/**
 * Same-origin HTTP + SSE API under `/projects-api`.
 *
 * Security:
 * - Every request is admitted through `ctx.connection.admit(req)`.
 * - Every write request (`POST`, `PATCH`, `DELETE`) requires both
 *   `content-type: application/json` and `x-projects-api: 1` (CSRF fence).
 * - Request bodies are bounded with `readBodyLimited(req, BODY_LIMIT, { res })`.
 */
import { readBodyLimited } from '../../dsh-shared/lib/secret.mjs';
import {
  MEMORY_INDEX_READ_ONLY,
  isMemoryIndexName,
  memoryNameOrThrow,
  renderMemoryIndexFile,
} from './memory.js';
import { httpError, messageOf, summarizeProject } from './schema.js';

export const ROUTE_PREFIX = '/projects-api';
const BODY_LIMIT = 2 * 1024 * 1024;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const CSRF_HEADER = 'x-projects-api';
const CSRF_VALUE = '1';
const WRITE_FENCE = 'write routes require "content-type: application/json" and "x-projects-api: 1"';
const SSE_HEARTBEAT_MS = 20_000;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJson(req, res) {
  let raw;
  try {
    raw = await readBodyLimited(req, BODY_LIMIT, { res });
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') throw httpError(413, 'body_too_large');
    throw httpError(400, messageOf(error) || 'request_body_error');
  }
  const trimmed = String(raw || '').trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    throw httpError(400, 'invalid_json');
  }
}

function requireWriteHeaders(req, method) {
  if (!WRITE_METHODS.has(method)) return;
  const headers = req.headers || {};
  const contentType = String(headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw httpError(400, `content_type_required: ${WRITE_FENCE}`);
  }
  if (String(headers[CSRF_HEADER] || '').trim() !== CSRF_VALUE) {
    throw httpError(400, `csrf_header_required: ${WRITE_FENCE}`);
  }
}

function sessionActionOf(searchParams) {
  const raw = searchParams && typeof searchParams.get === 'function' ? searchParams.get('session') : null;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function decodeSegment(value, code) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, code);
  }
}

async function routeGlobalEndpoint(service, method, parts, req, res) {
  if (parts[0] === 'sessions') {
    if (parts.length !== 2 || parts[1] !== 'restore') throw httpError(404, 'not_found');
    if (method !== 'POST') throw httpError(405, 'method_not_allowed');
    const body = await readJson(req, res);
    return { status: 200, body: await service.restoreSession(body?.sessionId) };
  }
  if (parts.length === 1 && parts[0] === 'models') {
    if (method !== 'GET') throw httpError(405, 'method_not_allowed');
    return { status: 200, body: await service.listModels() };
  }
  if (parts.length === 1 && parts[0] === 'open-path') {
    if (method !== 'POST') throw httpError(405, 'method_not_allowed');
    const body = await readJson(req, res);
    return { status: 200, body: await service.openPath({ projectId: body?.projectId, path: body?.path }) };
  }
  return null;
}

async function readSingleMemory(service, projectId, name) {
  const project = await service.readProject(projectId);
  if (isMemoryIndexName(name)) {
    let index = await service.memory.readMemoryIndexFile(project.id);
    if (!index) {
      await service.memory.readMemoryFiles(project.id);
      index = await service.memory.readMemoryIndexFile(project.id);
    }
    if (!index) throw httpError(404, 'memory_index_not_found');
    return { status: 200, body: { ...index, archived: false } };
  }
  const found = await service.memory.readMemoryFile(project.id, name);
  if (!found) throw httpError(404, 'memory_file_not_found');
  return {
    status: 200,
    body: {
      name: found.file.name,
      description: found.file.description,
      type: found.file.type,
      modified: found.file.modified,
      size: found.file.chars,
      text: found.file.body,
      archived: found.archived,
    },
  };
}

async function routeMemoryEndpoint(service, method, projectId, parts, req, res) {
  if (parts.length === 3) {
    if (method === 'GET') {
      const project = await service.readProject(projectId);
      const files = await service.memory.readMemoryFiles(project.id);
      return {
        status: 200,
        body: { memory: await service.memory.memoryPayload(project, files), index: renderMemoryIndexFile(files) },
      };
    }
    if (method === 'POST') {
      const body = await readJson(req, res);
      if (typeof body?.text !== 'string') throw httpError(400, 'text_required');
      const name = memoryNameOrThrow(body?.name);
      const project = await service.readProject(projectId);
      const written = await service.memory.writeMemoryFile(project.id, {
        name,
        description: body?.description,
        type: body?.type,
        text: body.text,
      });
      const compaction = await service.memory.afterMemoryWrite(project, written);
      return { status: 200, body: { saved: true, name: written.file.name, size: written.file.chars, compaction } };
    }
    throw httpError(405, 'method_not_allowed');
  }

  if (parts.length === 4) {
    const name = decodeSegment(parts[3], 'bad_memory_name');
    if (method === 'GET') return readSingleMemory(service, projectId, name);
    if (method === 'DELETE') {
      const project = await service.readProject(projectId);
      if (isMemoryIndexName(name)) throw httpError(400, MEMORY_INDEX_READ_ONLY);
      const deleted = await service.memory.deleteMemoryFile(project.id, name);
      return { status: 200, body: { deleted: true, name: deleted.file.name } };
    }
    throw httpError(405, 'method_not_allowed');
  }

  throw httpError(404, 'not_found');
}

async function routeTaskAction(service, method, projectId, taskId, action) {
  const routes = {
    approve: { method: 'POST', run: async () => ({ task: (await service.approveTask(projectId, taskId)).task }) },
    stop: { method: 'POST', run: () => service.stopTask(projectId, taskId) },
    retry: { method: 'POST', run: () => service.retryTask(projectId, taskId) },
    diff: { method: 'GET', run: () => service.getTaskDiff(projectId, taskId) },
    worktree: { method: 'DELETE', run: () => service.cleanupTaskWorktree(projectId, taskId) },
  };
  const entry = routes[action];
  if (!entry) throw httpError(404, 'not_found');
  if (method !== entry.method) throw httpError(405, 'method_not_allowed');
  return { status: 200, body: await entry.run() };
}

async function routeTaskEndpoint(service, method, projectId, parts, req, res, searchParams) {
  if (parts.length === 4) {
    const taskId = parts[3];
    if (method === 'PATCH') {
      const body = await readJson(req, res);
      const { task } = await service.resolveTask(projectId, taskId, body);
      return { status: 200, body: { task } };
    }
    if (method === 'DELETE') {
      const { session, worktree } = await service.removeTask(projectId, taskId, sessionActionOf(searchParams));
      return { status: 200, body: { deleted: true, session, ...(worktree === null ? {} : { worktree }) } };
    }
    throw httpError(405, 'method_not_allowed');
  }
  if (parts.length === 5) {
    return routeTaskAction(service, method, projectId, parts[3], parts[4]);
  }
  if (parts.length === 6 && parts[4] === 'worktree' && parts[5] === 'merge') {
    if (method !== 'POST') throw httpError(405, 'method_not_allowed');
    return { status: 200, body: await service.mergeTaskWorktree(projectId, parts[3]) };
  }
  throw httpError(404, 'not_found');
}

async function routeProjectEndpoint(service, method, parts, req, res, searchParams) {
  if (parts.length === 1) {
    if (method === 'GET') {
      const projects = await service.listProjects();
      return { status: 200, body: { projects: projects.map(summarizeProject) } };
    }
    if (method === 'POST') {
      const body = await readJson(req, res);
      const project = await service.createProject(body);
      return { status: 201, body: { project: summarizeProject(project) } };
    }
    throw httpError(405, 'method_not_allowed');
  }

  const projectId = parts[1];
  if (parts.length === 2) {
    if (method === 'GET') {
      const project = await service.readProject(projectId);
      const files = await service.memory.readMemoryFiles(project.id);
      return { status: 200, body: { project, memory: await service.memory.memoryPayload(project, files) } };
    }
    if (method === 'PATCH') {
      const body = await readJson(req, res);
      const { project, worktrees } = await service.updateProject(projectId, body);
      return { status: 200, body: { project, ...(worktrees === undefined ? {} : { worktrees }) } };
    }
    throw httpError(405, 'method_not_allowed');
  }

  if (parts[2] === 'memory') return routeMemoryEndpoint(service, method, projectId, parts, req, res);
  if (parts[2] === 'tasks') return routeTaskEndpoint(service, method, projectId, parts, req, res, searchParams);
  throw httpError(404, 'not_found');
}

/**
 * @param {any} ctx
 * @param {any} req
 * @param {any} res
 * @param {any} peer
 * @param {boolean} requireConnection
 */
function checkConnection(ctx, req, res, peer, requireConnection) {
  let admittedPeer = peer;
  if (admittedPeer === undefined) {
    const connection = ctx?.get?.('connection') ?? ctx?.connection;
    if (connection && typeof connection.admit === 'function') {
      const admission = connection.admit(req);
      if (admission && typeof admission === 'object' && 'rejection' in admission) {
        sendJson(res, admission.rejection, { error: 'Project connection is not authorized.' });
        return false;
      }
      admittedPeer = admission?.peer;
    } else if (!requireConnection) {
      return true;
    }
  }
  if (!admittedPeer) {
    if (!requireConnection) return true;
    sendJson(res, 401, { error: 'Project connection is not authorized.' });
    return false;
  }
  if (admittedPeer.principal?.kind !== 'owner') {
    sendJson(res, 403, { error: 'Project connection requires owner principal.' });
    return false;
  }
  return true;
}

function formatErrorBody(error) {
  return {
    error: messageOf(error),
    ...(error?.conflict === true ? { conflict: true } : {}),
    ...(error?.dirtyWorkspace === true ? { dirtyWorkspace: true } : {}),
    ...(error?.dirtyWorktree === true ? { dirtyWorktree: true } : {}),
  };
}

export function createProjectsHttpHandler(ctx, service, { requireConnection = true } = {}) {
  const activeStreams = new Set();

  function handleSse(req, res) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;
    const writeChunk = (chunk) => {
      if (closed || res.writableEnded || res.destroyed) return;
      try {
        res.write(chunk);
      } catch {
        cleanup();
      }
    };

    const unsubscribe = service.subscribeEvents((event) => {
      writeChunk(`event: update\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      writeChunk(`: ping ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref?.();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      activeStreams.delete(streamEntry);
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end();
        } catch {
          // Socket already closed.
        }
      }
    };

    const streamEntry = { close: cleanup };
    activeStreams.add(streamEntry);
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    writeChunk(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }

  async function routeRequest(method, path, req, res, searchParams) {
    const parts = path.split('/').filter(Boolean);
    const globalResult = await routeGlobalEndpoint(service, method, parts, req, res);
    if (globalResult) return globalResult;
    if (parts[0] !== 'projects') throw httpError(404, 'not_found');
    return routeProjectEndpoint(service, method, parts, req, res, searchParams);
  }

  /** @param {any} req @param {any} res @param {any} [peer] */
  const handler = async (req, res, peer) => {
    if (!checkConnection(ctx, req, res, peer, requireConnection)) return;

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }

    const path = url.pathname.startsWith(ROUTE_PREFIX)
      ? url.pathname.slice(ROUTE_PREFIX.length) || '/'
      : url.pathname || '/';
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/events') {
      if (method !== 'GET') sendJson(res, 405, { error: 'method_not_allowed' });
      else handleSse(req, res);
      return;
    }

    try {
      requireWriteHeaders(req, method);
      const result = await routeRequest(method, path, req, res, url.searchParams);
      sendJson(res, result.status, result.body);
    } catch (error) {
      sendJson(res, Number(error?.status) || 500, formatErrorBody(error));
    }
  };

  handler.closeAllStreams = () => {
    for (const stream of [...activeStreams]) stream.close();
  };

  return handler;
}

export function registerProjectsHttp(ctx, service) {
  ctx.inject(['connection', 'webServer'], (host) => {
    const handler = createProjectsHttpHandler(host, service, { requireConnection: true });
    let disposeRoute;
    try {
      disposeRoute = host.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
    } catch (error) {
      console.warn(`dsh-project: could not register ${ROUTE_PREFIX}: ${messageOf(error)}`);
      return;
    }
    host.effect(() => () => {
      handler.closeAllStreams();
      disposeRoute?.();
    }, 'dsh-project: /projects-api routes');
  });
}
