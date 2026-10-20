const fs = require('node:fs');
const { rendererFile } = require('./paths');

const API_ROUTES = new Map([
  ['/api/wiki', 'wiki.cjs'],
  ['/api/image-search', 'image-search.cjs'],
  ['/api/street-route', 'street-route.cjs'],
]);

function openuiViewer() {
  return fs.promises.readFile(rendererFile('whale-ui/viewer.html'), 'utf8');
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

  // Fixed routes own validation and caching; the renderer supplies query values.
  const url = new URL(input.path, 'https://openui.local');
  url.search = new URLSearchParams(input.query).toString();
  const { GET } = require(rendererFile(`whale-ui/api/${API_ROUTES.get(input.path)}`));
  const response = await GET(new Request(url, { method: 'GET' }));
  return { status: response.status, body: await response.json() };
}

const WHALE_BUNDLES = new Set(['mermaid.js', 'three.js', 'echarts-core.js', 'echarts-full.js', 'icons.js', 'standalone-runtime.js']);

/** The trusted parent can request only packaged rendering engines, never a filesystem path. */
async function openuiBundle(input) {
  if (!input || typeof input !== 'object' || !WHALE_BUNDLES.has(input.name)) {
    throw new Error('Invalid Whale UI bundle request');
  }
  const bytes = await fs.promises.readFile(rendererFile(`whale-ui/assets/${input.name}`));
  return bytes.toString('base64');
}

module.exports = { openuiViewer, openuiApi, openuiBundle };
