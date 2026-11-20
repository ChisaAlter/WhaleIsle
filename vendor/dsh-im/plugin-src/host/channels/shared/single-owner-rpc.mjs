import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import {
  isSingleOwnerChannel,
  SINGLE_OWNER_CHANNELS,
} from '../../../../src/channels/shared/single-owner-gate.mjs';

// Must be a single path segment matching Harness `CHANNEL_PATTERN` (`/^\/[A-Za-z0-9._~-]+$/`).
// Combined with `access/*` endpoints this serves `/dsh-im/access/{status,approve,reject,revoke}`.
export const SINGLE_OWNER_RPC_CHANNEL = '/dsh-im';
export const SINGLE_OWNER_ENDPOINTS = Object.freeze({
  status: 'access/status',
  approve: 'access/approve',
  reject: 'access/reject',
  revoke: 'access/revoke',
});

const LEGACY_ENDPOINT_ALIASES = Object.freeze({
  'access.status': SINGLE_OWNER_ENDPOINTS.status,
  'access.approve': SINGLE_OWNER_ENDPOINTS.approve,
  'access.reject': SINGLE_OWNER_ENDPOINTS.reject,
  'access.revoke': SINGLE_OWNER_ENDPOINTS.revoke,
});

const ENDPOINTS = Object.freeze(Object.values(SINGLE_OWNER_ENDPOINTS));

// Privacy red line: raw platform user IDs must never reach the browser.
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'platformUserId',
  'senderId',
  'staffId',
  'senderStaffId',
  'openId',
  'open_id',
  'ownerOpenId',
  'ownerOpenIds',
  'ownerUserId',
  'ownerUserOpenid',
  'accountJid',
  'phoneNumber',
  'allowedUsers',
  'allowedNumbers',
  'userId',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9]{4,12}$/.test(value.trim());
}

function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (!isRecord(value)) return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (!FORBIDDEN_PUBLIC_KEYS.has(key)) safe[key] = sanitizePublic(child);
  }
  return safe;
}

function payloadFailure(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  if (endpoint === SINGLE_OWNER_ENDPOINTS.status) {
    if (!exactKeys(payload, ['channel', 'botId'])) return 'access.status received unsupported fields.';
    if (payload.channel !== undefined && !isSingleOwnerChannel(payload.channel)) {
      return `Unsupported channel: ${String(payload.channel)}`;
    }
    if (payload.botId !== undefined && !validId(payload.botId)) return 'Invalid botId.';
    if (payload.botId !== undefined && payload.channel === undefined) {
      return 'channel is required when botId is specified.';
    }
    return null;
  }
  if (endpoint === SINGLE_OWNER_ENDPOINTS.approve) {
    if (!exactKeys(payload, ['channel', 'botId', 'requestId', 'code', 'confirm'])) {
      return 'access.approve received unsupported fields.';
    }
    if (!isSingleOwnerChannel(payload.channel) || !validId(payload.botId) || payload.confirm !== true) {
      return 'access.approve requires channel, botId, and confirm=true.';
    }
    const hasReq = payload.requestId !== undefined && validId(payload.requestId);
    const hasCode = payload.code !== undefined && validCode(payload.code);
    if (!hasReq && !hasCode) return 'access.approve requires requestId or code.';
    return null;
  }
  if (endpoint === SINGLE_OWNER_ENDPOINTS.reject) {
    if (!exactKeys(payload, ['channel', 'botId', 'requestId', 'confirm'])) {
      return 'access.reject received unsupported fields.';
    }
    if (!isSingleOwnerChannel(payload.channel) || !validId(payload.botId)
      || !validId(payload.requestId) || payload.confirm !== true) {
      return 'access.reject requires channel, botId, requestId, and confirm=true.';
    }
    return null;
  }
  if (endpoint === SINGLE_OWNER_ENDPOINTS.revoke) {
    if (!exactKeys(payload, ['channel', 'botId', 'senderKey', 'confirm'])) {
      return 'access.revoke received unsupported fields.';
    }
    if (!isSingleOwnerChannel(payload.channel) || !validId(payload.botId) || payload.confirm !== true) {
      return 'access.revoke requires channel, botId, and confirm=true.';
    }
    if (payload.senderKey !== undefined && !validId(payload.senderKey)) return 'Invalid senderKey.';
    return null;
  }
  return 'Unknown single-owner access endpoint.';
}

function rpcError(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

export function createSingleOwnerRpcHandler(gate) {
  if (!gate || typeof gate.publicStatus !== 'function') {
    throw new TypeError('A SingleOwnerAccessGate instance is required');
  }
  return async (rawEndpoint, payload = {}, signal) => {
    if (signal?.aborted) {
      return rpcError('cancelled', 'The request was cancelled.');
    }
    const endpoint = LEGACY_ENDPOINT_ALIASES[rawEndpoint] ?? rawEndpoint;
    if (!ENDPOINTS.includes(endpoint)) {
      return rpcError('bad-request', 'Unknown access endpoint.');
    }
    const invalid = payloadFailure(endpoint, payload);
    if (invalid) return rpcError('bad-request', invalid);
    try {
      let value;
      if (endpoint === SINGLE_OWNER_ENDPOINTS.status) {
        if (payload.channel && payload.botId) {
          value = gate.publicStatus({ channel: payload.channel, botId: payload.botId });
        } else {
          const bots = gate.listPublicStatuses();
          value = {
            channels: SINGLE_OWNER_CHANNELS,
            bots: payload.channel ? bots.filter((row) => row.channel === payload.channel) : bots,
          };
        }
      } else if (endpoint === SINGLE_OWNER_ENDPOINTS.approve) {
        value = await gate.approvePairing({
          channel: payload.channel,
          botId: payload.botId,
          requestId: payload.requestId,
          code: payload.code,
        });
      } else if (endpoint === SINGLE_OWNER_ENDPOINTS.reject) {
        value = await gate.rejectPairing({
          channel: payload.channel,
          botId: payload.botId,
          requestId: payload.requestId,
        });
      } else {
        value = await gate.revokeOwner({
          channel: payload.channel,
          botId: payload.botId,
          senderKey: payload.senderKey,
        });
      }
      return signal?.aborted
        ? rpcError('cancelled', 'The request was cancelled.')
        : { ok: true, value: sanitizePublic(value) };
    } catch (error) {
      return signal?.aborted
        ? rpcError('cancelled', 'The request was cancelled.')
        : rpcError(
            typeof error?.code === 'string' ? error.code : 'access-operation-failed',
            error?.message ?? '单人助理配对操作失败，请稍后重试。',
          );
    }
  };
}

export function installSingleOwnerRpc(ctx, gate, authority) {
  if (!ctx?.connection?.rpc || typeof ctx.connection.rpc.handle !== 'function') {
    return () => {};
  }
  return ctx.connection.rpc.handle(
    SINGLE_OWNER_RPC_CHANNEL,
    createSingleOwnerRpcHandler(gate),
    { authority: resolveRpcAuthority(authority) },
  );
}
