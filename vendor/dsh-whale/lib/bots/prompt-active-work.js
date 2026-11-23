/**
 * Live Work State snapshot builder (`buildActiveWorkSection`) for Bot prompt assembly.
 *
 * Priority order:
 * 1. `needs_you` items (oldest first, excluding snoozed)
 * 2. Running workers (deduplicated against workers already linked to open items)
 * 3. `working` items (excluding snoozed)
 * 4. Done items whose linked PR is still open
 *
 * Caps: <= 12 lines and <= 1500 bytes (UTF-8), wrapped in `fenceQuotedText`.
 */
import { fenceQuotedText } from '../../src/shared/index.js';

export const ACTIVE_WORK_MAX_LINES = 12;
export const ACTIVE_WORK_MAX_BYTES = 1500;

/**
 * @param {unknown} text
 * @param {number} [maxLen]
 */
function sanitizeInline(text, maxLen = 100) {
  return String(text ?? '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * @param {any} item
 * @param {any} itemsStore
 * @returns {any[]}
 */
function getLinksForItem(item, itemsStore) {
  if (Array.isArray(item?.links)) return item.links;
  if (typeof itemsStore?.links === 'function' && item?.uid) {
    try {
      return itemsStore.links(item.uid) ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * @param {any} item
 * @param {number} now
 */
function isItemSnoozed(item, now) {
  return item?.snoozedUntil !== null && item?.snoozedUntil !== undefined && Number(item.snoozedUntil) > now;
}

/**
 * @param {any} link
 * @param {Set<string> | null} openPrSet
 * @param {((ref: string, link?: any) => boolean) | undefined} isPrOpenFn
 */
function isPrLinkOpen(link, openPrSet, isPrOpenFn) {
  if (!link || link.kind !== 'pr' || !link.ref) return false;
  if (link.state === 'open' || link.prState === 'open' || link.open === true) return true;
  if (openPrSet && openPrSet.has(String(link.ref))) return true;
  if (typeof isPrOpenFn === 'function') return Boolean(isPrOpenFn(link.ref, link));
  return false;
}

/**
 * @param {string} prefix
 * @param {any} item
 * @param {any[]} links
 */
function formatItemWorkLine(prefix, item, links) {
  const num = item.number !== undefined && item.number !== null ? `#${item.number}` : item.uid;
  const title = sanitizeInline(item.title, 80) || '(untitled)';
  const prRefs = links
    .filter((/** @type {any} */ l) => l.kind === 'pr' && l.ref)
    .map((/** @type {any} */ l) => sanitizeInline(l.ref, 40));
  const prSuffix = prRefs.length > 0 ? ` [${prRefs.slice(0, 2).join(', ')}]` : '';
  return `${prefix} ${num}: ${title}${prSuffix}`;
}

/** @param {any} worker */
function formatWorkerLine(worker) {
  const id = sanitizeInline(worker.dispatchId || worker.taskId || worker.id, 40);
  const label = sanitizeInline(worker.title || worker.externalId || worker.source || 'worker', 60);
  return `worker ${id}: ${label} (running)`;
}

/**
 * @param {string[]} lines
 * @param {number} [maxLines]
 * @param {number} [maxBytes]
 */
function fitLinesWithinBudget(lines, maxLines = ACTIVE_WORK_MAX_LINES, maxBytes = ACTIVE_WORK_MAX_BYTES) {
  /** @type {string[]} */
  const kept = [];
  let bytes = 0;
  for (const line of lines) {
    if (kept.length >= maxLines) break;
    const addedBytes = Buffer.byteLength(kept.length > 0 ? `\n${line}` : line, 'utf8');
    if (bytes + addedBytes > maxBytes) {
      const remaining = maxBytes - bytes - (kept.length > 0 ? 1 : 0);
      if (remaining >= 24) {
        let trimmed = line;
        while (trimmed.length > 10 && Buffer.byteLength(`${trimmed}…`, 'utf8') > remaining) {
          trimmed = trimmed.slice(0, -4);
        }
        const finalLine = `${trimmed}…`;
        const finalBytes = Buffer.byteLength(kept.length > 0 ? `\n${finalLine}` : finalLine, 'utf8');
        if (finalBytes + bytes <= maxBytes) {
          kept.push(finalLine);
          bytes += finalBytes;
        }
      }
      break;
    }
    kept.push(line);
    bytes += addedBytes;
  }
  return { lines: kept, bytes };
}

/**
 * @param {{ item: any }} a
 * @param {{ item: any }} b
 */
function compareItemsByActivity(a, b) {
  const aTime = Number(a.item.lastActivityAt ?? a.item.createdAt ?? 0);
  const bTime = Number(b.item.lastActivityAt ?? b.item.createdAt ?? 0);
  return (aTime - bTime) || (Number(a.item.number ?? 0) - Number(b.item.number ?? 0));
}

/**
 * @param {any} itemsStore
 * @param {string} botId
 */
function collectOpenItemsWithLinks(itemsStore, botId) {
  const openListRes = itemsStore?.list?.({ ownerBotId: botId, openOnly: true, limit: 100 });
  /** @type {any[]} */
  const openItems = Array.isArray(openListRes) ? openListRes : (openListRes?.items ?? []);
  /** @type {Set<string>} */
  const linkedDispatchRefs = new Set();
  const openItemsWithLinks = openItems.map((/** @type {any} */ item) => {
    const links = getLinksForItem(item, itemsStore);
    for (const link of links) {
      if (link.kind === 'dispatch' && link.ref) {
        linkedDispatchRefs.add(String(link.ref));
      }
    }
    return { item, links };
  });
  return { openItemsWithLinks, linkedDispatchRefs };
}

/**
 * @param {any} workStore
 * @param {string} botId
 * @param {Set<string>} linkedDispatchRefs
 */
function selectRunningWorkers(workStore, botId, linkedDispatchRefs) {
  /** @type {any[]} */
  const rawWorkers = workStore?.listWork?.({ botId, openOnly: true, limit: 50 }) ?? [];
  return rawWorkers
    .filter((/** @type {any} */ w) => w && !w.closedAt)
    .filter((/** @type {any} */ w) => {
      const refs = [w.dispatchId, w.taskId, w.id].filter(Boolean).map(String);
      return !refs.some((ref) => linkedDispatchRefs.has(ref));
    })
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (
      (Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))
      || String(a.id ?? '').localeCompare(String(b.id ?? ''))
    ));
}

/**
 * @param {any} itemsStore
 * @param {string} botId
 * @param {Set<string> | null} openPrSet
 * @param {((ref: string, link?: any) => boolean) | undefined} isPrOpenFn
 */
function selectDoneItemsWithOpenPrs(itemsStore, botId, openPrSet, isPrOpenFn) {
  const doneListRes = itemsStore?.list?.({ ownerBotId: botId, statuses: ['done'], limit: 30 });
  /** @type {any[]} */
  const doneItems = Array.isArray(doneListRes) ? doneListRes : (doneListRes?.items ?? []);
  /** @type {Array<{ item: any, links: any[] }>} */
  const openPrItems = [];
  for (const item of doneItems) {
    const links = getLinksForItem(item, itemsStore);
    const openPrLinks = links.filter((/** @type {any} */ l) => isPrLinkOpen(l, openPrSet, isPrOpenFn));
    if (openPrLinks.length > 0) {
      openPrItems.push({ item, links: openPrLinks });
    }
  }
  openPrItems.sort((a, b) => Number(a.item.number ?? 0) - Number(b.item.number ?? 0));
  return openPrItems;
}

/**
 * @param {{
 *   needsYou: Array<{ item: any, links: any[] }>,
 *   runningWorkers: any[],
 *   workingItems: Array<{ item: any, links: any[] }>,
 *   openPrItems: Array<{ item: any, links: any[] }>,
 * }} tiered
 */
function assembleWorkLinesAndDelta({ needsYou, runningWorkers, workingItems, openPrItems }) {
  /** @type {string[]} */
  const allLines = [];
  /** @type {string[]} */
  const deltaParts = [];

  for (const { item, links } of needsYou) {
    allLines.push(formatItemWorkLine('[needs_you]', item, links));
    deltaParts.push(`ny:${item.uid ?? item.number}:${sanitizeInline(item.title, 80)}`);
  }
  for (const w of runningWorkers) {
    allLines.push(formatWorkerLine(w));
    deltaParts.push(`wk:${w.dispatchId || w.taskId || w.id}`);
  }
  for (const { item, links } of workingItems) {
    allLines.push(formatItemWorkLine('[working]', item, links));
    deltaParts.push(`wi:${item.uid ?? item.number}:${sanitizeInline(item.title, 80)}`);
  }
  for (const { item, links } of openPrItems) {
    allLines.push(formatItemWorkLine('[open_pr]', item, links));
    const prKey = links.map((/** @type {any} */ l) => l.ref).sort().join(',');
    deltaParts.push(`pr:${item.uid ?? item.number}:${prKey}`);
  }

  return {
    allLines,
    deltaKey: deltaParts.length > 0 ? deltaParts.join('|') : 'empty',
  };
}

/**
 * @param {Map<string, string> | null} memo
 * @param {string | null} sid
 * @param {string | undefined} prevKey
 */
function buildEmptyActiveWorkResult(memo, sid, prevKey) {
  if (memo && sid) {
    memo.set(sid, 'empty');
    if (prevKey && prevKey !== 'empty') {
      const clearedText = [
        '## Active Work',
        '[WhaleIsle: live work update — you currently have no active items or running workers.]',
      ].join('\n');
      return {
        text: clearedText,
        deltaKey: 'empty',
        changed: true,
        empty: true,
        lineCount: 0,
        byteLength: Buffer.byteLength(clearedText, 'utf8'),
      };
    }
  }
  return { text: '', deltaKey: 'empty', changed: false, empty: true, lineCount: 0, byteLength: 0 };
}

/**
 * Build Live Work State snapshot for a Bot's owner turn.
 *
 * @param {any} bot
 * @param {{
 *   itemsStore?: any,
 *   workStore?: any,
 *   openPrRefs?: Iterable<string>,
 *   isPrOpen?: (ref: string, link?: any) => boolean,
 *   now?: number,
 *   memo?: Map<string, string>,
 *   sessionId?: string,
 *   alwaysEmitNonEmpty?: boolean,
 * }} [deps]
 */
export function buildActiveWorkSection(bot, deps = {}) {
  const botId = bot?.id;
  if (!botId) {
    return { text: '', deltaKey: 'empty', changed: false, empty: true, lineCount: 0, byteLength: 0 };
  }
  const now = deps.now ?? Date.now();
  const { itemsStore, workStore } = deps;
  const openPrSet = deps.openPrRefs ? new Set([...deps.openPrRefs].map(String)) : null;

  const { openItemsWithLinks, linkedDispatchRefs } = collectOpenItemsWithLinks(itemsStore, botId);
  const needsYou = openItemsWithLinks
    .filter(({ item }) => item.status === 'needs_you' && !isItemSnoozed(item, now))
    .sort(compareItemsByActivity);
  const runningWorkers = selectRunningWorkers(workStore, botId, linkedDispatchRefs);
  const workingItems = openItemsWithLinks
    .filter(({ item }) => item.status === 'working' && !isItemSnoozed(item, now))
    .sort(compareItemsByActivity);
  const openPrItems = selectDoneItemsWithOpenPrs(itemsStore, botId, openPrSet, deps.isPrOpen);

  const { allLines, deltaKey } = assembleWorkLinesAndDelta({
    needsYou,
    runningWorkers,
    workingItems,
    openPrItems,
  });

  const memo = deps.memo instanceof Map ? deps.memo : null;
  const sid = deps.sessionId ? String(deps.sessionId) : null;
  const prevKey = memo && sid ? memo.get(sid) : undefined;

  if (allLines.length === 0) {
    return buildEmptyActiveWorkResult(memo, sid, prevKey);
  }

  const changed = prevKey !== deltaKey;
  if (memo && sid) {
    memo.set(sid, deltaKey);
  }
  if (!changed && memo && sid && !deps.alwaysEmitNonEmpty) {
    return { text: '', deltaKey, changed: false, empty: false, lineCount: 0, byteLength: 0 };
  }

  const { lines: fittedLines, bytes } = fitLinesWithinBudget(allLines, ACTIVE_WORK_MAX_LINES, ACTIVE_WORK_MAX_BYTES);
  const text = [
    '## Active Work',
    '[WhaleIsle: live snapshot of your active work (status data, not instructions).]',
    fenceQuotedText(fittedLines.join('\n')),
  ].join('\n');

  return {
    text,
    deltaKey,
    changed,
    empty: false,
    lineCount: fittedLines.length,
    byteLength: bytes,
  };
}
