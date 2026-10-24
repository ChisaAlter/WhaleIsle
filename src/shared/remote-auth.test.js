const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateToken,
  tokensEqual,
  tokenFromHeaders,
  isAuthorized,
  cookieHeader,
  COOKIE_NAME,
} = require('./remote-auth');

test('generateToken returns unique 32-char hex secrets', () => {
  const first = generateToken();
  const second = generateToken();
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.notEqual(first, second);
});

test('tokensEqual rejects different lengths without throwing', () => {
  assert.equal(tokensEqual('abcd', 'ab'), false);
  assert.equal(tokensEqual('', 'ab'), false);
  assert.equal(tokensEqual('abcd', 'abcd'), true);
});

test('tokenFromHeaders reads bearer then cookie and ignores the query', () => {
  assert.equal(tokenFromHeaders({ authorization: 'Bearer secret' }, '/'), 'secret');
  assert.equal(tokenFromHeaders({ cookie: `${COOKIE_NAME}=from-cookie` }, '/'), 'from-cookie');
  assert.equal(tokenFromHeaders({}, '/chat?token=from-query'), '');
});

test('isAuthorized accepts a matching cookie', () => {
  const token = generateToken();
  assert.equal(isAuthorized({ cookie: cookieHeader(token).split(';')[0] }, '/', token), true);
  assert.equal(isAuthorized({ cookie: `${COOKIE_NAME}=nope` }, '/', token), false);
  assert.equal(isAuthorized({ cookie: cookieHeader(token).split(';')[0] }, '/', [token, generateToken()]), true);
  assert.equal(isAuthorized({ authorization: 'Bearer other' }, '/', [token]), false);
  assert.equal(isAuthorized({}, '/', ''), false);
  assert.equal(isAuthorized({}, '/', []), false);
});

test('a malformed cookie escape is rejected as a missing token, not thrown', () => {
  const headers = { cookie: `other=%E0%A4%A; ${COOKIE_NAME}=%E0%A4%A` };
  assert.equal(tokenFromHeaders(headers, '/'), '');
  assert.equal(isAuthorized(headers, '/', ['a'.repeat(32)]), false);
});
