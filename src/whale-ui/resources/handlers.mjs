const USER_AGENT = 'WhaleIsle/WhaleUI (https://github.com/ChisaAlter/Deepseek-Harness-Desktop)';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function fault(message, status = 502) { return new Response(JSON.stringify({ error: { message } }), { status, headers: JSON_HEADERS }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function imageUrl(value) {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value.startsWith('//') ? `https:${value}` : value); return url.protocol === 'https:' ? url.href : undefined; }
  catch { return undefined; }
}

/** Only fixed public encyclopaedia and routing origins are queried; callers supply search terms or coordinates. */
export function createResourceHandlers(fetchResource) {
  const cache = new Map();
  const read = async (url, missingOkay = false) => {
    const response = await fetchResource(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (response.status === 404 && missingOkay) return {};
    if (!response.ok) throw new Error(`Resource service returned ${response.status}.`);
    const value = await response.json();
    if (!record(value) || value.error) throw new Error('Resource service returned an invalid response.');
    return value;
  };
  const mediaQuery = async (host, params) => {
    const url = new URL('/w/api.php', `https://${host}`);
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params }).toString();
    const data = await read(url.href);
    return (Array.isArray(data.query?.pages) ? data.query.pages : []).filter(record).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  };
  const handlers = {
    async wiki(query) {
      const title = typeof query.title === 'string' ? query.title.trim() : '';
      if (!title || title.length > 200) return fault('title must contain 1 to 200 characters.', 400);
      const article = encodeURIComponent(title.replaceAll(' ', '_'));
      const [summary, media] = await Promise.all([
        read(`https://en.wikipedia.org/api/rest_v1/page/summary/${article}`, true),
        read(`https://en.wikipedia.org/api/rest_v1/page/media-list/${article}`, true),
      ]);
      const photos = [];
      const add = value => { const url = imageUrl(value); if (url && !photos.includes(url) && !/\.(?:svg)(?:\?|$)|(?:flag|logo|coat_of_arms|locator_map)/i.test(url)) photos.push(url); };
      add(summary.thumbnail?.source);
      for (const item of Array.isArray(media.items) ? media.items : []) {
        if (item?.type === 'image') for (const source of (item.srcset ?? []).slice(0, 1)) add(source.src);
        if (photos.length >= 3) break;
      }
      const lat = summary.coordinates?.lat;
      const lng = summary.coordinates?.lon;
      return { ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}), photos: photos.slice(0, 3) };
    },
    async 'image-search'(query) {
      const term = typeof query.q === 'string' ? query.q.trim().replace(/\s+/g, ' ') : '';
      if (term.length < 2 || term.length > 200) return fault('q must contain 2 to 200 characters.', 400);
      const photos = [];
      const add = value => { const url = imageUrl(value); if (url && !photos.includes(url) && !/\.(?:svg)(?:\?|$)|(?:flag|logo|coat_of_arms|locator_map|signature)/i.test(url)) photos.push(url); };
      const pages = await mediaQuery('en.wikipedia.org', { generator: 'search', gsrsearch: term, gsrlimit: '6', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '960' });
      const words = term.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      for (const page of pages) if (words.some(word => String(page.title ?? '').toLocaleLowerCase().includes(word))) add(page.thumbnail?.source);
      if (photos.length < 4) {
        const files = await mediaQuery('commons.wikimedia.org', { generator: 'search', gsrsearch: `${term} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '960' });
        for (const page of files) for (const info of page.imageinfo ?? []) if (String(info.mime).startsWith('image/')) add(info.thumburl ?? info.url);
      }
      return { images: photos.slice(0, 4) };
    },
    async 'street-route'(query) {
      const source = typeof query.coords === 'string' ? query.coords : '';
      const points = source.split(';').map(pair => pair.split(',').map(part => part.trim() === '' ? NaN : Number(part)));
      if (points.length < 2 || points.length > 25 || points.some(pair => pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90)) {
        return fault('coords must contain 2 to 25 finite longitude,latitude pairs.', 400);
      }
      const coordinates = points.map(pair => pair.join(',')).join(';');
      const data = await read(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`);
      const route = data.routes?.[0]?.geometry?.coordinates;
      if (data.code !== 'Ok' || !Array.isArray(route) || route.length < 2 || route.some(pair => !Array.isArray(pair) || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]))) throw new Error('No street route was returned.');
      return { points: route.map(([lng, lat]) => [lat, lng]) };
    },
  };
  return async (operation, query) => {
    if (!Object.hasOwn(handlers, operation)) return fault('Unknown resource operation.', 400);
    const key = JSON.stringify([operation, query]);
    if (cache.has(key)) return Response.json(cache.get(key), { headers: { 'Cache-Control': 'public, max-age=3600' } });
    try {
      const value = await handlers[operation](query);
      if (value instanceof Response) return value;
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, value);
      return Response.json(value, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    } catch (error) { return fault(error instanceof Error ? error.message : 'The resource service is unavailable.'); }
  };
}
