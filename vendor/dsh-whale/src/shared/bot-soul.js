// SOUL.md helpers: starter template, proposal template, and first-paragraph description extractor.

const EN_STARTER_LINE = /^Describe .+ here: what it is for, how it talks, and what it must never do\.$/;
const ZH_STARTER_LINES = Object.freeze([
  /^在这里描述.+：它的职责、沟通方式，以及绝对不能做的事。$/,
  /^你是 WhaleIsle 的大肥鱼队友「.+」：在这里写下你的专长、沟通风格，以及绝对不能越过的边界。$/,
  /^你是鲸屿的大肥鱼队友「.+」：在这里写下你的专长、沟通风格，以及绝对不能越过的边界。$/,
]);

const READ_ONLY_START =
  '- Change anything (comments, labels, pull requests, posts anywhere but here) until my owner says I can. I start by reading and reporting only.';

const PROPER_NAMES = new Set(['GitHub', 'Slack', 'Linear', 'Google', 'Apps', 'WhaleIsle']);

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function midSentence(text) {
  const firstWord = text.split(' ', 1)[0] ?? '';
  if (PROPER_NAMES.has(firstWord)) {
    return text;
  }
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function endSentence(text) {
  return /[.!?。！？]$/.test(text) ? text : `${text}.`;
}

/**
 * Generates the initial starter `SOUL.md` for a blank bot.
 * Supports `'zh-CN'` or default `'en-US'`.
 */
export function starterSoul(name, locale = 'en-US') {
  const isZh = typeof locale === 'string' && locale.toLowerCase().startsWith('zh');
  const cleanName = oneLine(name) || (isZh ? '新大肥鱼队友' : 'New bot');
  if (isZh) {
    return `# ${cleanName}\n\n你是 WhaleIsle 的大肥鱼队友「${cleanName}」：在这里写下你的专长、沟通风格，以及绝对不能越过的边界。\n`;
  }
  return `# ${cleanName}\n\nDescribe ${cleanName} here: what it is for, how it talks, and what it must never do.\n`;
}

/** Formats watches/does/reports into plain identity sentences for New bot UI. */
export function proposalIdentity({ watches, does, reports } = {}) {
  const parts = [
    watches ? `Watches ${midSentence(oneLine(watches))}` : null,
    does ? oneLine(does) : null,
    reports ? `Reports ${midSentence(oneLine(reports))}` : null,
  ].filter(Boolean);
  return parts.map(endSentence).join(' ');
}

/** Builds a proposal object from a built-in template. */
export function templateProposal(template, overrides = {}) {
  return {
    name: template.name,
    mascot: template.mascot,
    purpose: template.line,
    watches: template.watches,
    does: template.does,
    reports: template.reports,
    templateId: template.id,
    ...overrides,
  };
}

/** Extracts the persisted seed portion of a proposal. */
export function proposalSeed({ purpose, watches, does, reports, automations, templateId } = {}) {
  return {
    purpose: oneLine(purpose),
    ...(watches ? { watches: oneLine(watches) } : {}),
    ...(does ? { does: oneLine(does) } : {}),
    ...(reports ? { reports: oneLine(reports) } : {}),
    ...(Array.isArray(automations) && automations.length ? { automations: automations.map(oneLine) } : {}),
    ...(templateId ? { templateId } : {}),
  };
}

/**
 * Generates `SOUL.md` for a bot created from a template or bot proposal:
 * purpose as the first paragraph, how it works, and a read-only default boundary.
 */
export function proposalSoul(name, seed = {}, options = {}) {
  const cleanName = oneLine(name) || 'New bot';
  const templateName = options.templateName ?? options.template?.name ?? seed.templateName ?? null;
  const how = [
    seed.watches ? `- Watches: ${oneLine(seed.watches)}` : null,
    seed.does ? `- Does: ${oneLine(seed.does)}` : null,
    seed.reports ? `- Reports: ${oneLine(seed.reports)}` : null,
    Array.isArray(seed.automations) && seed.automations.length > 0
      ? `- Automations to set up once my owner agrees: ${seed.automations.map(oneLine).join('; ')}`
      : null,
    templateName ? `- Started from the ${oneLine(templateName)} template.` : null,
  ].filter(Boolean);

  const sections = [
    `# ${cleanName}`,
    oneLine(seed.purpose || ''),
    ...(how.length > 0 ? [`## How I work\n\n${how.join('\n')}`] : []),
    `## Never\n\n${READ_ONLY_START}`,
  ].filter(Boolean);
  return `${sections.join('\n\n')}\n`;
}

function paragraphsOf(soul) {
  if (typeof soul !== 'string') {
    return [];
  }
  return soul
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Extracts the first non-heading paragraph of `SOUL.md`, or `null` if missing or still
 * holding the default English/Chinese starter placeholder line.
 */
export function soulDescription(soul) {
  const paragraph = paragraphsOf(soul).find((entry) => !entry.startsWith('#'));
  if (!paragraph) {
    return null;
  }
  if (EN_STARTER_LINE.test(paragraph) || ZH_STARTER_LINES.some((re) => re.test(paragraph))) {
    return null;
  }
  return paragraph;
}
