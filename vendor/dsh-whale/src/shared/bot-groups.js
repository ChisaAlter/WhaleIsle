// Multi-bot group chat domain: mention parsing (ignoring code/quotes/blockquotes/@filepaths),
// replyMode target resolution, <=24KB <quoted_room_history> builder, and group naming.

export const BOT_GROUP_LIMITS = Object.freeze({
  minCreateMembers: 2,
  minEditMembers: 1,
  maxMembers: 32,
  nameMaxLength: 64,
  textMaxLength: 100_000,
  maxImages: 20,
  maxContextBytes: 24_000,
  maxReplyChars: 16_000,
  maxLatestText: 500,
  maxThreadTitle: 80,
});

export const BOT_GROUP_REPLY_MODES = Object.freeze(['bot', 'all', 'mentions']);
export const BOT_GROUP_MEMBER_SESSION_PREFIX = 'bot-group-member-';

const EVERYONE = '@everyone';
const MENTION_START = /(^|[^\p{L}\p{N}_.@])@/gu;
const MENTION_END = /^(?:$|[\s,:;!?)]|\.(?:\s|$))/u;
const LEADING_GAP = /^[\s,:!?]*$/u;

// Fenced code blocks, inline code, blockquotes, and curly/straight double-quoted prose.
const UNADDRESSED_PROSE = /```[\s\S]*?(?:```|(?![\s\S]))|`[^`\n]*`|^[ \t]*>.*$|\u201c[^\u201d]*\u201d|"[^"\n]*"/gmu;
// Quoted `@"path/with spaces"` or rooted `@/path`, `@~/path`, `@\path`, `@C:\path` file references.
const FILE_REFERENCE = /@"(?:[^"\\]|\\.)*"|@(?:[\\/~]|[a-z]:[\\/])\S*/giu;
const IMAGE_REFERENCE = /\[image:\s*[^\]]+\]/gi;

export function isBotGroupMemberSession(sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(BOT_GROUP_MEMBER_SESSION_PREFIX);
}

export function findBotGroupRoom(groups, roomId) {
  for (const group of groups ?? []) {
    if (group.id === roomId) {
      return { group, threadId: undefined };
    }
    if (group.threads?.some((thread) => thread.id === roomId)) {
      return { group, threadId: roomId };
    }
  }
  return null;
}

export function botGroupRoom(group, threadId) {
  if (!threadId) {
    return group;
  }
  const thread = group.threads?.find((entry) => entry.id === threadId);
  if (!thread) {
    throw new Error('This thread is no longer in the group.');
  }
  return { ...group, members: thread.members };
}

export function findBotGroupRoomOfSession(groups, sessionId) {
  const holds = (room) => (
    (room.members ?? []).some((member) => member.sessionId === sessionId)
    || room.formerSessionIds?.includes(sessionId) === true
  );
  for (const group of groups ?? []) {
    if (holds(group)) {
      return { group, threadId: undefined };
    }
    const thread = group.threads?.find(holds);
    if (thread) {
      return { group, threadId: thread.id };
    }
  }
  return null;
}

export function botGroupSessionIds(rooms) {
  return (rooms ?? []).flatMap((room) => [
    ...(room.members ?? []).map((member) => member.sessionId),
    ...(room.formerSessionIds ?? []),
  ]);
}

export function botGroupRoomMembers(group) {
  return [group.members ?? [], ...(group.threads ?? []).map((thread) => thread.members ?? [])];
}

export function botGroupOwnerMessageBlocks(message) {
  return [
    ...(message.text ? [{ type: 'text', text: message.text }] : []),
    ...(message.images?.map(({ path, name }) => ({ type: 'image-ref', path, alt: name })) ?? []),
  ];
}

/** Masks file references, fenced/inline code, blockquotes, and quoted prose preserving offsets. */
export function maskUnaddressedGroupProse(text) {
  return String(text ?? '')
    .replace(FILE_REFERENCE, (file) => ' '.repeat(file.length))
    .replace(UNADDRESSED_PROSE, (prose) => ' '.repeat(prose.length));
}

function scanMentionsRaw(text, members, everyone) {
  const mentions = [];
  let leadingEnd = 0;
  for (const found of text.matchAll(MENTION_START)) {
    const start = found.index + found[1].length;
    if (start < (mentions.at(-1)?.end ?? 0)) {
      continue;
    }
    const rest = text.slice(start);
    const leading = leadingEnd !== null && LEADING_GAP.test(text.slice(leadingEnd, start));
    const named = members.filter((bot) => (
      bot.name.length > 0
      && rest.slice(1, 1 + bot.name.length).toLocaleLowerCase() === bot.name.toLocaleLowerCase()
      && MENTION_END.test(rest.slice(1 + bot.name.length))
    ));
    const longest = Math.max(0, ...named.map((bot) => bot.name.length));
    const best = named.filter((bot) => bot.name.length === longest);
    const broadcast = /^@everyone/iu.test(rest) && MENTION_END.test(rest.slice(EVERYONE.length));
    const clash = broadcast && longest === EVERYONE.length - 1;

    const mention = buildMentionToken({ start, rest, leading, best, longest, broadcast, clash, everyone });
    mentions.push(mention);
    leadingEnd = leading ? mention.end : null;
  }
  return mentions;
}

function buildMentionToken({ start, rest, leading, best, longest, broadcast, clash, everyone }) {
  if (broadcast && best.length === 0) {
    return { start, end: start + EVERYONE.length, leading, match: 'everyone', ids: [...everyone] };
  }
  if (best.length > 0) {
    return {
      start,
      end: start + 1 + longest,
      leading,
      match: best.length > 1 || clash ? 'ambiguous' : 'member',
      ids: best.map((bot) => bot.id),
    };
  }
  return {
    start,
    end: start + (/^@\S*/u.exec(rest)?.[0].length ?? 1),
    leading,
    match: 'none',
    ids: [],
  };
}

/**
 * Parses `@BotName` and `@everyone` mentions from room prose, strictly ignoring
 * fenced code blocks, inline code, blockquotes, quoted strings, and `@filepath` references.
 */
export function parseGroupMentions(text, members, everyone = members.map((bot) => bot.id)) {
  const masked = maskUnaddressedGroupProse(text);
  return scanMentionsRaw(masked, members, everyone);
}

function roomMembersList(group, bots) {
  const memberIds = new Set((group.members ?? []).map((member) => member.botId));
  return (bots ?? []).filter((bot) => memberIds.has(bot.id));
}

function replyModeAudience(group) {
  const { replyMode } = group;
  const memberIds = (group.members ?? []).map((member) => member.botId);
  if (replyMode?.kind === 'all') {
    return memberIds;
  }
  if (replyMode?.kind === 'bot' && memberIds.includes(replyMode.botId)) {
    return [replyMode.botId];
  }
  return [];
}

const uniqueMentionIds = (mentions) => [...new Set(mentions.flatMap((mention) => mention.ids))];

/**
 * Resolves which member bots should reply to a group message.
 * Explicit `@mention` / `@everyone` overrides `group.replyMode`.
 * Throws on ambiguous mentions, unknown leading mentions, or a missing default reply bot.
 */
export function resolveGroupTargets(text, group, bots) {
  const memberBots = roomMembersList(group, bots);
  const memberIds = (group.members ?? []).map((member) => member.botId);
  const mentions = parseGroupMentions(text, memberBots, memberIds);
  if (mentions.some((mention) => mention.match === 'ambiguous')) {
    throw new Error('Correct the ambiguous bot mention before sending.');
  }
  if (mentions.some((mention) => mention.leading && mention.match === 'none')) {
    throw new Error('Correct the unavailable or ambiguous bot mention before sending.');
  }
  const targets = uniqueMentionIds(mentions);
  if (targets.length > 0) {
    return targets;
  }
  const fallback = replyModeAudience(group);
  if (group.replyMode?.kind === 'bot' && fallback.length === 0) {
    throw new Error('Choose a current room member in Room replies.');
  }
  return fallback;
}

export const botGroupAudience = resolveGroupTargets;

export function botGroupDraftAudience(draft, group, bots) {
  const prose = String(draft ?? '').replace(IMAGE_REFERENCE, '');
  const memberBots = roomMembersList(group, bots);
  const memberIds = (group.members ?? []).map((member) => member.botId);
  const mentions = parseGroupMentions(prose, memberBots, memberIds).filter(
    (mention) => !(mention.match === 'none' && mention.end === prose.length),
  );
  if (mentions.some((mention) => mention.match === 'ambiguous' || (mention.leading && mention.match === 'none'))) {
    return 'invalid';
  }
  const ids = uniqueMentionIds(mentions);
  return ids.length > 0 ? { ids, addressed: true } : { ids: replyModeAudience(group), addressed: false };
}

export function formatBotGroupAudience(audience, group, bots, t) {
  if (audience === 'invalid') {
    return t('bots.groups.correctMention', 'Correct mention');
  }
  const { ids } = audience;
  if (!audience.addressed && group.replyMode?.kind === 'all') {
    return t('bots.groups.allBots', 'All bots');
  }
  if (ids.length === 0) {
    return t('bots.groups.onlyWhenMentioned', 'Only when mentioned');
  }
  if (ids.length === 1) {
    return bots.find((bot) => bot.id === ids[0])?.name
      ?? t('bots.groups.unavailableBot', 'Unavailable bot');
  }
  return ids.length === (group.members?.length ?? 0)
    ? t('bots.groups.allBotsCount', 'All bots · {{count}}', { count: ids.length })
    : t('bots.groups.mentionedCount', '{{count}} mentioned', { count: ids.length });
}

export function botGroupSingleRecipient(draft, group, bots) {
  const audience = botGroupDraftAudience(draft, group, bots);
  return audience !== 'invalid' && audience.ids.length === 1 ? audience.ids[0] : null;
}

export function botGroupReplyDraft(botId, draft, group, bots) {
  const bot = (group.members ?? []).some((member) => member.botId === botId)
    ? bots.find((candidate) => candidate.id === botId)
    : undefined;
  return bot ? `@${bot.name} ${draft}` : draft;
}

export function botGroupMentionSegments(text, names, everyone = true) {
  const named = names.filter((name) => typeof name === 'string' && name.length > 0).map((name) => ({ id: name, name }));
  const segments = [];
  let cursor = 0;
  for (const { start, end, match } of scanMentionsRaw(String(text ?? ''), named, [])) {
    if (match === 'none' || (match === 'everyone' && !everyone)) {
      continue;
    }
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), mention: false });
    }
    segments.push({ text: text.slice(start, end), mention: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), mention: false });
  }
  return segments;
}

/**
 * Builds the incremental room history JSON (capped at 24 KB) since `member`'s last delivered turn
 * and wraps it in `<quoted_room_history>` fences when `options.fenced !== false`.
 */
export function buildQuotedRoomHistory(messages, completed, member, options = {}) {
  const maxBytes = options.maxBytes ?? BOT_GROUP_LIMITS.maxContextBytes;
  const list = Array.isArray(messages) ? messages : [];
  let seen = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const turns = list[i]?.turns ?? [];
    if (turns.some((turn) => turn.sessionId === member.sessionId && !turn.mailbox && !turn.error)) {
      seen = i;
      break;
    }
  }
  const completedMap = completed instanceof Map ? completed : new Map(Object.entries(completed ?? {}));
  const lines = list.slice(Math.max(seen, 0)).flatMap((message, index) => {
    const postEntry = seen !== -1 && index === 0
      ? []
      : [{
        author: message.author,
        text: message.text,
        ...(message.images?.length
          ? { images: message.images.map(({ name, path }) => ({ name, path })) }
          : {}),
      }];
    const replyEntries = (message.turns ?? []).flatMap((turn) => {
      const replyText = completedMap.get(turn.operationId) ?? (typeof turn.reply === 'string' ? turn.reply : null);
      if (!replyText || turn.botId === member.botId) {
        return [];
      }
      return [{ author: { kind: 'bot', id: turn.botId, name: turn.botName }, text: replyText }];
    });
    return [...postEntry, ...replyEntries];
  });

  while (lines.length > 0 && JSON.stringify(lines).length > maxBytes) {
    lines.shift();
  }
  const json = JSON.stringify(lines);
  if (options.rawJson === true) {
    return json;
  }
  return `<quoted_room_history>\n${json}\n</quoted_room_history>`;
}

export function botGroupPickOrder(saved, picked) {
  return [
    ...saved.filter((id) => picked.includes(id)),
    ...picked.filter((id) => !saved.includes(id)),
  ];
}

export function botGroupMissing(count, name, editing = false) {
  if (count < (editing ? BOT_GROUP_LIMITS.minEditMembers : BOT_GROUP_LIMITS.minCreateMembers)) {
    return editing ? 'pickOne' : 'pickTwo';
  }
  return String(name ?? '').trim() ? null : 'nameIt';
}

export function botGroupUnchanged(saved, name, botIds) {
  return (
    String(name ?? '').trim() === saved.name
    && botIds.length === saved.botIds.length
    && botIds.every((id, index) => saved.botIds[index] === id)
  );
}

/** Suggests a human-readable group name ("A & B", "A, B & C", "A, B & N more"), capped at 64 chars. */
export function suggestGroupName(names, t = null) {
  const clean = (Array.isArray(names) ? names : []).map((n) => String(n ?? '').trim()).filter(Boolean);
  const [a, b, c] = clean;
  if (!a || !b) {
    return null;
  }
  let text;
  if (!c) {
    text = t ? t('bots.groups.suggestTwo', '{{a}} & {{b}}', { a, b }) : `${a} & ${b}`;
  } else if (clean.length === 3) {
    text = t ? t('bots.groups.suggestThree', '{{a}}, {{b}} & {{c}}', { a, b, c }) : `${a}, ${b} & ${c}`;
  } else {
    const count = clean.length - 2;
    text = t
      ? t('bots.groups.suggestMore', '{{a}}, {{b}} & {{count}} more', { a, b, count })
      : `${a}, ${b} & ${count} more`;
  }
  return text.slice(0, BOT_GROUP_LIMITS.nameMaxLength);
}
