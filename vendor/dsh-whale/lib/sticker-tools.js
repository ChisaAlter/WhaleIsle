/**
 * Sticker tools — `whale_sticker` lets the whale assistant drop an
 * occasional reaction image into her own reply. The tool returns a markdown
 * image snippet (`![name](/abs/path)`); pasted into her message text it
 * renders through the client's local-path image rule, which rewrites
 * root-anchored paths to the same-origin `/api/file` endpoint. No extra
 * session events, no fabricated assistant rows.
 *
 * Sources: the bundled pack at vendor/dsh-whale/stickers (index.json
 * carries name/tags from the community archive) plus any image files she
 * or the user drops into <whale-home>/stickers/ — the home dir is her
 * session cwd, so she can grow her own collection with the fs tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { whaleStickersDir, appendPetOutbox } from './preset.js';
import { trimTo } from './shared.js';

const IMAGE_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif']);
const QUERY_MAX_CHARS = 64;
/** Back-to-back repeats feel broken; the ring skips the last few picks. */
const RECENT_CAP = 12;

const recent = [];

function bundledStickerDir() {
  return fileURLToPath(new URL('../stickers/', import.meta.url));
}

/**
 * Spell an absolute path the way the web client's markdown image rule
 * accepts: preserve the Windows drive or POSIX root, and URL-encode path
 * characters so spaces, parentheses and fragments survive Markdown parsing.
 */
export function markdownPathFor(absPath) {
  const normalized = String(absPath ?? '').replace(/\\/g, '/');
  // The client's authenticated file-image rule explicitly excludes UNC paths.
  // Never emit //server as Markdown: the browser treats that as a network URL.
  if (normalized.startsWith('//')) throw new Error('UNC sticker paths are not supported by the client.');
  return normalized.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Bundled pack entries, hydrated from stickers/index.json. */
function loadBundled() {
  const dir = bundledStickerDir();
  let index;
  try {
    index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(index)) return [];
  const out = [];
  for (const entry of index) {
    const file = typeof entry?.file === 'string' ? entry.file.trim() : '';
    if (!file || file.includes('/') || file.includes('\\')) continue;
    const target = path.join(dir, file);
    if (!fs.existsSync(target)) continue;
    out.push({
      path: target,
      name: String(entry?.name ?? '').trim(),
      tags: Array.isArray(entry?.tags) ? entry.tags.map((t) => String(t)) : [],
    });
  }
  return out;
}

/** Images dropped into <whale-home>/stickers/ — filename doubles as name. */
function loadUserStickers(homeDir) {
  const dir = whaleStickersDir(homeDir);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .map((name) => ({
      path: path.join(dir, name),
      name: name.replace(/\.[^.]+$/, ''),
      tags: [],
    }));
}

function matches(entry, query) {
  const q = query.toLowerCase();
  return entry.name.toLowerCase().includes(q)
    || entry.tags.some((tag) => tag.toLowerCase().includes(q));
}

function pickSticker(homeDir, query) {
  const pool = [...loadBundled(), ...loadUserStickers(homeDir)];
  if (!pool.length) return { pool: 0 };
  const q = String(query ?? '').trim();
  let candidates = q ? pool.filter((entry) => matches(entry, q)) : pool;
  const matched = q !== '' && candidates.length > 0;
  if (!candidates.length) candidates = pool;
  const fresh = candidates.filter((entry) => !recent.includes(entry.path));
  if (fresh.length) candidates = fresh;
  const sticker = candidates[Math.floor(Math.random() * candidates.length)];
  recent.push(sticker.path);
  if (recent.length > RECENT_CAP) recent.splice(0, recent.length - RECENT_CAP);
  return { pool: pool.length, sticker, matched };
}

export function registerStickerTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'whale_sticker',
    description:
      'Pick a whale-girl reaction sticker and get a markdown image snippet. '
      + 'Paste the returned `markdown` verbatim into your reply text — it renders as the '
      + 'picture. Use it sparingly: once in a while when a reaction image lands better '
      + 'than words, not in every reply. `query` matches sticker names/tags '
      + '(e.g. 开心, 生气, 夸赞); omit for a random pick. Extra image files dropped into '
      + 'the stickers/ dir of your home join the pool.',
    timeoutMs: 10_000,
    parameters: {
      query: { type: 'string', description: 'Optional mood/keyword matched against sticker names and tags.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          name: { type: 'string', required: true },
          markdown: { type: 'string', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Pick a sticker',
      kind: 'other',
      content: [{ type: 'text', text: String(args.query ?? '') }],
    }),
    presentResult: (_args, result) => (result.ok !== true ? undefined : {
      card: 'generic',
      title: 'Sticker picked',
      content: [{ type: 'text', text: String(result.value?.name ?? '') }],
    }),
    async execute(args) {
      const home = process.env.DSH_HOME || '';
      if (!home) return { ok: false, name: '', markdown: '', detail: 'DSH home is unavailable.' };
      const query = trimTo(args.query ?? '', QUERY_MAX_CHARS).trim();
      const { pool, sticker, matched } = pickSticker(home, query);
      if (!sticker) return { ok: false, name: '', markdown: '', detail: 'No stickers are installed.' };
      const alt = sticker.name.replace(/[[\]()!\r\n]/g, '').trim() || '表情包';
      let destination;
      try { destination = markdownPathFor(sticker.path); } catch (error) {
        return { ok: false, name: sticker.name, markdown: '', detail: error.message };
      }
      const markdown = `![${alt}](${destination})`;
      const shown = sticker.name || '(未命名)';
      // The desktop pet tails the outbox and pops the image in her speech
      // bubble — the sticker is her expression, not just chat markup.
      try {
        appendPetOutbox(home, 'sticker', shown, { path: sticker.path });
      } catch { /* outbox append is best-effort; the reply still carries it */ }
      const intro = query && !matched
        ? `No sticker matched "${query}"; picked a random one of ${pool}: ${shown}.`
        : `Picked "${shown}" (${pool} in pool).`;
      return {
        ok: true,
        name: shown,
        markdown,
        detail: `${intro} Paste this markdown verbatim into your reply to send the sticker:\n${markdown}`,
      };
    },
  }));
}
