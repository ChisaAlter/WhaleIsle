'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteFileSync } = require('../../shared/fs-safe');

const WHALEBRIDGE_REF = 'WHALEBRIDGE_GATEWAY_KEY';
const MAGPIE_REF = 'MAGPIE_GATEWAY_KEY';
const MAGPIE_LEGACY_REF = 'MAGPIE_API_KEY';
const PROFILE_PATCH = ['profiles', 'web', 'cordis.patch.yml'];
const MAGPIE_CHANNEL_NAMES = ['magpie', 'magpie-responses', 'magpie-anthropic'];

/**
 * @param {string} file
 * @returns {string}
 */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return '';
    throw error;
  }
}

/** @param {string} line */
function lineIndent(line) {
  return /^[ \t]*/.exec(line)?.[0].length || 0;
}

/**
 * Whether the YAML mapping opened at `lines[index]` has no child keys left.
 * @param {string[]} lines
 * @param {number} index
 */
function mappingEmpty(lines, index) {
  const indent = lineIndent(lines[index]);
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return lineIndent(line) <= indent;
  }
  return true;
}

/**
 * Locate a provider block under `- id: llm-pi-ai` -> `providers:` whose name is in
 * `names` and which carries one of the owned `apiKeyEnv` markers.
 * @param {string[]} lines
 * @param {string[]} names
 * @param {string[]} refs
 */
function findOwnedChannelBlock(lines, names, refs) {
  const namePattern = new RegExp(`^[ \\t]*"?(?:${names.join('|')})"?\\s*:\\s*$`);
  const refPattern = new RegExp(`apiKeyEnv:\\s*"?(?:${refs.join('|')})"?\\s*$`);
  for (let start = 0; start < lines.length; start += 1) {
    if (!namePattern.test(lines[start])) continue;
    const indent = lineIndent(lines[start]);
    let parent = -1;
    for (let i = start - 1; i >= 0; i -= 1) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (lineIndent(lines[i]) < indent) { parent = i; break; }
    }
    if (parent === -1 || !/^[ \t]*providers\s*:\s*$/.test(lines[parent])) continue;
    let entry = -1;
    for (let i = parent - 1; i >= 0; i -= 1) {
      if (/^[ \t]*- id\s*:/.test(lines[i])) { entry = i; break; }
    }
    if (entry === -1 || !/^[ \t]*- id\s*:\s*"?llm-pi-ai"?\s*$/.test(lines[entry])) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim() && lineIndent(lines[i]) <= indent) { end = i; break; }
    }
    if (!lines.slice(start, end).some((line) => refPattern.test(line))) continue;
    return { start, end, parent };
  }
  return null;
}

/**
 * Remove all owned provider blocks matching `names` & `refs`; null when untouched.
 * @param {string} text
 * @param {string[]} names
 * @param {string[]} refs
 * @returns {string | null}
 */
function removeOwnedChannelBlocks(text, names, refs) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);
  let changed = false;
  for (;;) {
    const block = findOwnedChannelBlock(lines, names, refs);
    if (!block) break;
    changed = true;
    lines = [...lines.slice(0, block.start), ...lines.slice(block.end)];
    if (mappingEmpty(lines, block.parent)) {
      lines[block.parent] = lines[block.parent].replace(/:\s*$/, ': {}');
    }
  }
  if (!changed) return null;
  const joined = lines.join(eol);
  return /\r?\n$/.test(text) && joined !== '' && !joined.endsWith(eol) ? joined + eol : joined;
}

/**
 * Remove managed gateway credential keys from `.credentials.yaml`.
 * @param {string} text
 * @param {string[]} refs
 * @returns {string | null}
 */
function removeGatewayRefs(text, refs) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const pattern = new RegExp(`^[ \\t]*(?:${refs.join('|')})\\s*:`);
  const next = lines.filter((line) => !pattern.test(line));
  if (next.length === lines.length) return null;
  const refsIdx = next.findIndex((line) => /^[ \t]*refs\s*:\s*$/.test(line));
  if (refsIdx !== -1 && mappingEmpty(next, refsIdx)) {
    next[refsIdx] = next[refsIdx].replace(/:\s*$/, ': {}');
  }
  return next.join(eol);
}

/**
 * @param {string} dshHome
 * @param {string[]} names
 * @param {string[]} refs
 * @returns {{ changed: boolean }}
 */
function detachChannels(dshHome, names, refs) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return { changed: false };
  let changed = false;
  for (const file of [path.join(dshHome, 'cordis.patch.yml'), path.join(dshHome, ...PROFILE_PATCH)]) {
    const text = readText(file);
    const next = text ? removeOwnedChannelBlocks(text, names, refs) : null;
    if (next === null) continue;
    atomicWriteFileSync(file, next);
    changed = true;
  }
  if (!changed) return { changed: false };
  const credentials = path.join(dshHome, '.credentials.yaml');
  const text = readText(credentials);
  const next = text ? removeGatewayRefs(text, refs) : null;
  if (next !== null) atomicWriteFileSync(credentials, next, { mode: 0o600 });
  return { changed: true };
}

/** Detach legacy WhaleBridge channel (`providers.whalebridge` + `WHALEBRIDGE_GATEWAY_KEY`). */
/** @param {string} dshHome */
function detachWhaleBridgeDshChannel(dshHome) {
  return detachChannels(dshHome, ['whalebridge'], [WHALEBRIDGE_REF]);
}

/** Detach Magpie channels (`magpie`, `magpie-responses`, `magpie-anthropic`) + `MAGPIE_GATEWAY_KEY`. */
/** @param {string} dshHome */
function detachMagpieDshChannels(dshHome) {
  return detachChannels(dshHome, MAGPIE_CHANNEL_NAMES, [MAGPIE_REF, MAGPIE_LEGACY_REF]);
}

/**
 * Ensure `<dshHome>/profiles/web/cordis.patch.yml` exists before spawning Magpie,
 * so upstream `internal/agent/dsh.go` never falls back to `profiles/desktop/`.
 * @param {string} dshHome
 */
function ensureDshWebProfileExists(dshHome) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return;
  const patchFile = path.join(dshHome, ...PROFILE_PATCH);
  if (fs.existsSync(patchFile)) return;
  fs.mkdirSync(path.dirname(patchFile), { recursive: true });
  atomicWriteFileSync(patchFile, '[]\n');
}

/**
 * Read current `agent-default-model` from `profiles/web/cordis.patch.yml` or home `cordis.patch.yml`.
 * @param {string} dshHome
 * @returns {{ provider: string, model: string, reasoningEffort: string } | null}
 */
function readDshDefaultModel(dshHome) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return null;
  for (const file of [path.join(dshHome, ...PROFILE_PATCH), path.join(dshHome, 'cordis.patch.yml')]) {
    const text = readText(file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex((line) => /^[ \t]*- id\s*:\s*"?agent-default-model"?\s*$/.test(line));
    if (idx === -1) continue;
    let end = lines.length;
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (/^[ \t]*- id\s*:/.test(lines[i])) { end = i; break; }
    }
    const slice = lines.slice(idx, end).join('\n');
    const provider = /^\s*provider\s*:\s*"?([^"\r\n#]+)"?/m.exec(slice)?.[1]?.trim() || '';
    const model = /^\s*model\s*:\s*"?([^"\r\n#]+)"?/m.exec(slice)?.[1]?.trim() || '';
    const reasoningEffort = /^\s*reasoningEffort\s*:\s*"?([^"\r\n#]+)"?/m.exec(slice)?.[1]?.trim() || '';
    if (provider || model) return { provider, model, reasoningEffort };
  }
  return null;
}

/**
 * Remap `agent-default-model` provider in DSH patch files (e.g. `whalebridge` -> `magpie`).
 * @param {string} dshHome
 * @param {string} fromProvider
 * @param {string} toProvider
 * @returns {boolean}
 */
function remapDshDefaultModel(dshHome, fromProvider, toProvider) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return false;
  let updated = false;
  for (const file of [path.join(dshHome, ...PROFILE_PATCH), path.join(dshHome, 'cordis.patch.yml')]) {
    const text = readText(file);
    if (!text) continue;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex((line) => /^[ \t]*- id\s*:\s*"?agent-default-model"?\s*$/.test(line));
    if (idx === -1) continue;
    let changed = false;
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (/^[ \t]*- id\s*:/.test(lines[i])) break;
      const match = /^([ \t]*provider\s*:\s*)"?([^"\r\n#]+)"?(.*)$/.exec(lines[i]);
      if (match && match[2].trim() === fromProvider) {
        lines[i] = `${match[1]}${toProvider}${match[3]}`;
        changed = true;
      }
    }
    if (changed) {
      atomicWriteFileSync(file, lines.join(eol));
      updated = true;
    }
  }
  return updated;
}

/**
 * Ensure `refs.MAGPIE_GATEWAY_KEY: magpie` is recorded in `<dshHome>/.credentials.yaml`
 * without clobbering any non-Magpie value already set by the user.
 * @param {string} dshHome
 */
function ensureMagpieCredentialRef(dshHome) {
  const file = path.join(dshHome, '.credentials.yaml');
  const raw = readText(file);
  if (!raw.trim()) {
    fs.mkdirSync(dshHome, { recursive: true });
    atomicWriteFileSync(file, `refs:\n  ${MAGPIE_REF}: magpie\n`, { mode: 0o600 });
    return true;
  }
  const existing = new RegExp(`^[ \\t]*${MAGPIE_REF}\\s*:\\s*(.+)$`, 'm').exec(raw);
  if (existing) {
    return existing[1].trim().replace(/^["']|["']$/g, '') === 'magpie';
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const refsIdx = lines.findIndex((line) => /^[ \t]*refs\s*:\s*(?:\{\})?\s*$/.test(line));
  if (refsIdx !== -1) {
    lines[refsIdx] = 'refs:';
    lines.splice(refsIdx + 1, 0, `  ${MAGPIE_REF}: magpie`);
  } else {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    lines.push('refs:', `  ${MAGPIE_REF}: magpie`);
  }
  atomicWriteFileSync(file, lines.join(eol).replace(/\n?$/, '\n'), { mode: 0o600 });
  return true;
}

/**
 * Build YAML block for `providers.<channelName>` inside `llm-pi-ai`.
 * @param {string} indent
 * @param {string} channelName
 * @param {string} api
 * @param {string} baseUrl
 * @param {any[]} models
 */
function formatChannelLines(indent, channelName, api, baseUrl, models) {
  const inner = `${indent}  `;
  const item = `${inner}  `;
  const lines = [
    `${indent}${channelName}:`,
    `${inner}baseUrl: ${JSON.stringify(baseUrl)}`,
    `${inner}api: ${api}`,
    `${inner}apiKeyEnv: ${MAGPIE_REF}`,
    `${inner}models:`,
  ];
  for (const model of models) {
    const id = typeof model?.id === 'string' ? model.id : '';
    if (!id) continue;
    lines.push(`${item}- id: ${JSON.stringify(id)}`);
    if (typeof model.name === 'string' && model.name) {
      lines.push(`${item}  name: ${JSON.stringify(model.name)}`);
    }
    if (typeof model.context_window === 'number' && model.context_window > 0) {
      lines.push(`${item}  contextWindow: ${model.context_window}`);
    }
    if (typeof model.max_tokens === 'number' && model.max_tokens > 0) {
      lines.push(`${item}  maxTokens: ${model.max_tokens}`);
    }
    if (typeof model.compaction_threshold === 'number' && model.compaction_threshold > 0) {
      lines.push(`${item}  compactionThreshold: ${model.compaction_threshold}`);
    }
  }
  if (lines.at(-1) === `${inner}models:`) {
    lines[lines.length - 1] = `${inner}models: []`;
  }
  return lines;
}

/**
 * @param {string} addr
 * @param {((url: string, init?: RequestInit) => Promise<any>) | undefined} fetchJson
 * @returns {Promise<any[]>}
 */
async function fetchGatewayModels(addr, fetchJson) {
  try {
    const headers = { Authorization: 'Bearer magpie' };
    const data = fetchJson
      ? await fetchJson(`http://${addr}/v1/models`, { headers })
      : await (await fetch(`http://${addr}/v1/models`, { headers, signal: AbortSignal.timeout(4000) })).json();
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    // Gateway may still be warming up or empty; keep empty model list safely.
    return [];
  }
}

/**
 * Insert Magpie channel blocks into the `llm-pi-ai` provider map in `cordis.patch.yml` lines.
 * @param {string[]} lines
 * @param {string[]} blocks
 */
function insertProviderBlocks(lines, blocks) {
  const llmIdx = lines.findIndex((line) => /^[ \t]*- id\s*:\s*"?llm-pi-ai"?\s*$/.test(line));
  if (llmIdx === -1) {
    lines.push('- id: llm-pi-ai', '  config:', '    providers:', ...blocks);
    return;
  }
  let provIdx = -1;
  let end = lines.length;
  for (let i = llmIdx + 1; i < lines.length; i += 1) {
    if (/^[ \t]*- id\s*:/.test(lines[i])) { end = i; break; }
    if (/^[ \t]*providers\s*:/.test(lines[i])) { provIdx = i; break; }
  }
  if (provIdx !== -1) {
    lines[provIdx] = lines[provIdx].replace(/:\s*\{\}\s*$/, ':');
    lines.splice(provIdx + 1, 0, ...blocks);
    return;
  }
  const cfgIdx = lines.slice(llmIdx + 1, end).findIndex((l) => /^[ \t]*config\s*:/.test(l));
  if (cfgIdx === -1) {
    lines.splice(llmIdx + 1, 0, '  config:', '    providers:', ...blocks);
  } else {
    lines.splice(llmIdx + 2 + cfgIdx, 0, '    providers:', ...blocks);
  }
}

/**
 * Upsert Magpie provider channels into `<dshHome>/profiles/web/cordis.patch.yml`
 * when reusing an external Magpie instance that lacks `DSH_HOME` in its env.
 * Preserves any non-Magpie providers and skips channels with foreign `apiKeyEnv`.
 * @param {{ dshHome: string, gatewayAddr: string, fetchJson?: (url: string, init?: RequestInit) => Promise<any> }} options
 */
async function syncDshToMagpieGateway({ dshHome, gatewayAddr, fetchJson }) {
  if (typeof dshHome !== 'string' || !dshHome.trim()) return { synced: false };
  ensureDshWebProfileExists(dshHome);
  if (!ensureMagpieCredentialRef(dshHome)) {
    return { synced: false, reason: 'foreign-gateway-ref' };
  }
  const addr = String(gatewayAddr || '').replace(/^https?:\/\//, '');
  const models = await fetchGatewayModels(addr, fetchJson);
  const completions = [];
  const responses = [];
  const anthropic = [];
  for (const m of models) {
    const api = String(m?.api || '').toLowerCase();
    if (api === 'openai-responses') responses.push(m);
    else if (api === 'anthropic-messages') anthropic.push(m);
    else completions.push(m);
  }
  const patchFile = path.join(dshHome, ...PROFILE_PATCH);
  const raw = readText(patchFile);
  const cleaned = removeOwnedChannelBlocks(raw, MAGPIE_CHANNEL_NAMES, [MAGPIE_REF, MAGPIE_LEGACY_REF]) ?? raw;
  const eol = cleaned.includes('\r\n') ? '\r\n' : '\n';
  const lines = cleaned.trim() === '[]' || !cleaned.trim() ? [] : cleaned.split(/\r?\n/);
  const blocks = [
    ...formatChannelLines('        ', 'magpie', 'openai-completions', `http://${addr}/v1`, completions),
    ...(responses.length ? formatChannelLines('        ', 'magpie-responses', 'openai-responses', `http://${addr}/v1`, responses) : []),
    ...(anthropic.length ? formatChannelLines('        ', 'magpie-anthropic', 'anthropic-messages', `http://${addr}`, anthropic) : []),
  ];
  insertProviderBlocks(lines, blocks);
  atomicWriteFileSync(patchFile, `${lines.join(eol).replace(/\n?$/, '')}\n`);
  return { synced: true, modelCount: models.length };
}

module.exports = {
  detachWhaleBridgeDshChannel,
  detachMagpieDshChannels,
  ensureDshWebProfileExists,
  readDshDefaultModel,
  remapDshDefaultModel,
  syncDshToMagpieGateway,
};
