const fs = require('node:fs');
const { rendererFile } = require('./paths');

const API_ROUTES = new Map([
  ['/api/wiki', 'wiki.cjs'],
  ['/api/image-search', 'image-search.cjs'],
  ['/api/street-route', 'street-route.cjs'],
]);

function openuiViewer() {
  return fs.promises.readFile(rendererFile('openui/viewer.html'), 'utf8');
}

function isStringQuery(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value).every((entry) => typeof entry === 'string');
}

async function openuiApi(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !API_ROUTES.has(input.path)
    || !isStringQuery(input.query)) {
    throw new Error('Invalid OpenUI API request');
  }

  // Route selection and origin are shell-owned. The renderer supplies only
  // query values; each upstream handler keeps its own validation and cache.
  const url = new URL(input.path, 'https://openui.local');
  url.search = new URLSearchParams(input.query).toString();
  const { GET } = require(rendererFile(`openui/api/${API_ROUTES.get(input.path)}`));
  const response = await GET(new Request(url, { method: 'GET' }));
  return { status: response.status, body: await response.json() };
}

module.exports = { openuiViewer, openuiApi };
