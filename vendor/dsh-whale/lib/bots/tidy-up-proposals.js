/**
 * Reflection proposal parser and `needs_you` item builder for Memory Tidy-Up.
 */

const MIN_PROPOSAL_OCCURRENCES = 2;

/**
 * Parse raw `BEGIN PROPOSAL ... END PROPOSAL` blocks into structured reflection proposals.
 * @param {string[]} rawBlocks
 */
export function parseReflectionProposals(rawBlocks = []) {
  const results = [];
  for (const raw of Array.isArray(rawBlocks) ? rawBlocks : []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const lines = text.split(/\r?\n/u);
    let title = '';
    let occurrences = 0;
    let suggestedRule = '';
    const evidence = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const titleMatch = /^(?:title|标题)\s*[:：]\s*(.+)$/iu.exec(trimmed);
      if (titleMatch) { title = titleMatch[1].trim(); continue; }
      const occMatch = /^(?:occurrences|count|重复次数|次数)\s*[:：]\s*(\d+)/iu.exec(trimmed);
      if (occMatch) { occurrences = Number(occMatch[1]); continue; }
      const ruleMatch = /^(?:rule|suggested[_ ]?rule|proposal|建议规则|建议)\s*[:：]\s*(.+)$/iu.exec(trimmed);
      if (ruleMatch) { suggestedRule = ruleMatch[1].trim(); continue; }
      const evMatch = /^(?:evidence|证据|[-*])\s*[:：]?\s*(.+)$/iu.exec(trimmed);
      if (evMatch && evMatch[1].trim()) evidence.push(evMatch[1].trim());
    }

    if (occurrences === 0 && evidence.length >= MIN_PROPOSAL_OCCURRENCES) {
      occurrences = evidence.length;
    }
    if (!title) {
      title = (lines.find((l) => l.trim().length > 0) || 'SOUL.md 规则优化提案').replace(/^[-*#\s]+/u, '').slice(0, 120);
    }
    results.push({
      title,
      occurrences,
      suggestedRule: suggestedRule || text,
      evidence,
      raw: text,
    });
  }
  return results;
}

/** @param {any} itemsStore @param {any} bot @param {any[]} proposals @param {number} now */
export function createProposalItems(itemsStore, bot, proposals, now) {
  if (!itemsStore || typeof itemsStore.add !== 'function') return [];
  const qualifying = proposals.filter((p) => p.occurrences >= MIN_PROPOSAL_OCCURRENCES);
  if (qualifying.length === 0) return [];
  const openNeeds = itemsStore.needsYou?.({ ownerBotId: bot.id, now, includeSnoozed: true }) ?? [];
  const created = [];
  for (const prop of qualifying) {
    const title = `反思提案：${prop.title}`.slice(0, 140);
    if (openNeeds.some((/** @type {any} */ item) => item.title === title)) continue;
    const evidenceText = prop.evidence.length > 0
      ? `\n\n重复纠错证据（${prop.occurrences} 次）：\n${prop.evidence.map((/** @type {any} */ e) => `- ${e}`).join('\n')}`
      : '';
    const res = itemsStore.add({
      ownerBotId: bot.id,
      chatId: bot.chatSessionId || `bot-tidy:${bot.id}`,
      source: { kind: 'automation', title: 'memory-tidy-up' },
      title,
      description: `建议写入 SOUL.md 的规则（绝不自动改写，需你拍板）：\n${prop.suggestedRule}${evidenceText}`,
      status: 'needs_you',
      ask: {
        context: `记忆整理检测到 ${prop.occurrences} 次重复纠错，建议将其沉淀为 SOUL.md 长期规则。`,
        questions: [{
          prompt: `是否采纳提案「${prop.title}」并更新 SOUL.md？`,
          options: [
            { label: '采纳并更新 SOUL.md' },
            { label: '暂不修改 SOUL.md' },
            { label: '忽略此类建议' },
          ],
          recommended: 0,
          multi: false,
        }],
      },
    }, { kind: 'orca', why: 'tidy_up_reflection' }, now);
    if (res?.item) created.push(res.item);
  }
  return created;
}
