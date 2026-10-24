const crypto = require('crypto');

const COOKIE_NAME = 'dsh_remote';
const TOKEN_BYTES = 16;
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function tokensEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    // A malformed escape is an invalid credential, not a server error.
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return out;
}

function tokenFromHeaders(headers, _url) {
  const authorization = String(headers.authorization || headers.Authorization || '');
  const bearer = authorization.match(/^Bearer\s+(\S+)/i);
  if (bearer) {
    return bearer[1];
  }
  const cookies = parseCookies(headers.cookie || headers.Cookie);
  if (cookies[COOKIE_NAME]) {
    return cookies[COOKIE_NAME];
  }
  return '';
}

function tokenList(tokens) {
  if (Array.isArray(tokens)) {
    return tokens.filter(Boolean);
  }
  return tokens ? [tokens] : [];
}

function matchingToken(headers, url, tokens) {
  const presented = tokenFromHeaders(headers, url);
  for (const token of tokenList(tokens)) {
    if (tokensEqual(presented, token)) {
      return token;
    }
  }
  return '';
}

function isAuthorized(headers, url, tokens) {
  return Boolean(matchingToken(headers, url, tokens));
}

function cookieHeader(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_COOKIE_MAX_AGE}`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  DEVICE_COOKIE_MAX_AGE,
  generateToken,
  tokensEqual,
  parseCookies,
  tokenFromHeaders,
  matchingToken,
  isAuthorized,
  cookieHeader,
  clearCookieHeader,
};
