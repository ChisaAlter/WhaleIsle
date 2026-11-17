const fs = require('fs');
const path = require('path');
const { tryGetDesktopDshHome } = require('./dsh-home');

const DEFAULT_FAMILY_ID = 'deepseek';

/**
 * @typedef {Object} ThemeSeeds
 * @property {string} accent
 * @property {string} background
 * @property {string} foreground
 */

/**
 * @typedef {Object} ThemeFamily
 * @property {string} name
 * @property {string} [skin]
 * @property {ThemeSeeds} light
 * @property {ThemeSeeds} dark
 */

/**
 * @typedef {Object} ThemeTokens
 * @property {string} id
 * @property {string} name
 * @property {string} scheme
 * @property {string} bg
 * @property {string} fg
 * @property {string} muted
 * @property {string} accent
 * @property {string} field
 * @property {string} line
 * @property {string} buttonFg
 */

/** @type {Record<string, ThemeFamily>} */
const FAMILY_SEEDS = {
  deepseek: {
    name: 'DeepSeek',
    light: { accent: '#4176e6', background: '#ffffff', foreground: '#0f1115' },
    dark: { accent: '#679efe', background: '#151517', foreground: '#f5f5f5' },
  },
  midnight: {
    name: '午夜',
    light: { accent: '#3b6fd4', background: '#f3f6fb', foreground: '#1a1f2b' },
    dark: { accent: '#6ea8ff', background: '#0b0d12', foreground: '#e8eef9' },
  },
  celadon: {
    name: '青瓷',
    light: { accent: '#0f766e', background: '#f3faf7', foreground: '#10211c' },
    dark: { accent: '#3dd6b5', background: '#071411', foreground: '#e7f6f1' },
  },
  violet: {
    name: '暮紫',
    light: { accent: '#7c3aed', background: '#f7f3fc', foreground: '#1c1524' },
    dark: { accent: '#c4a1ff', background: '#120e18', foreground: '#f3eefc' },
  },
  amber: {
    name: '琥珀',
    light: { accent: '#b45309', background: '#fbf6ee', foreground: '#1c1915' },
    dark: { accent: '#e2b15c', background: '#14100b', foreground: '#f6efe4' },
  },
  paper: {
    name: '宣纸',
    light: { accent: '#0f766e', background: '#f3efe6', foreground: '#1c1915' },
    dark: { accent: '#5eead4', background: '#1a1712', foreground: '#f6efe4' },
  },
  codex: {
    name: 'Codex',
    skin: 'codex',
    light: { accent: '#2563eb', background: '#ffffff', foreground: '#0d0d0d' },
    dark: { accent: '#338cff', background: '#181818', foreground: '#f5f5f5' },
  },
  claude: {
    name: 'Claude',
    skin: 'claude',
    light: { accent: '#c96442', background: '#faf9f5', foreground: '#262624' },
    dark: { accent: '#d97757', background: '#262624', foreground: '#f5f4ef' },
  },
  contrast: {
    name: '对比',
    light: { accent: '#111111', background: '#ffffff', foreground: '#050505' },
    dark: { accent: '#ffffff', background: '#050505', foreground: '#f5f5f5' },
  },
};

const THEMES = Object.entries(FAMILY_SEEDS).flatMap(([id, family]) => ([
  tokensFromSeeds(id, family.name, 'dark', family.dark),
  tokensFromSeeds(id, family.name, 'light', family.light),
]));

function dshHome() {
  return tryGetDesktopDshHome();
}

/**
 * @param {unknown} raw
 * @returns {string | number | boolean | null}
 */
function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * @param {unknown} text
 * @returns {Record<string, unknown>}
 */
function parseSimpleYaml(text) {
  const lines = String(text || '').replace(/\t/g, '  ').split(/\r?\n/);
  /** @type {Record<string, unknown>} */
  const root = {};
  /** @type {Array<{ indent: number, container: Record<string, unknown> | unknown[], key: string | null }>} */
  const stack = [{ indent: -1, container: root, key: null }];

  const frame = () => stack[stack.length - 1];

  const replaceWithArray = () => {
    const current = frame();
    if (Array.isArray(current.container)) return current.container;
    const parent = stack[stack.length - 2];
    /** @type {unknown[]} */
    const next = [];
    if (parent && current.key != null && !Array.isArray(parent.container)) {
      parent.container[current.key] = next;
    }
    current.container = next;
    return next;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const trimmed = raw.trim();
    while (stack.length > 1 && indent <= frame().indent) stack.pop();

    if (trimmed.startsWith('- ')) {
      const list = replaceWithArray();
      const rest = trimmed.slice(2);
      const colon = rest.indexOf(':');
      if (colon === -1) {
        list.push(parseScalar(rest));
        continue;
      }
      const item = /** @type {Record<string, unknown>} */ ({});
      list.push(item);
      const key = rest.slice(0, colon).trim();
      const value = rest.slice(colon + 1).trim();
      if (value === '') {
        const nested = /** @type {Record<string, unknown>} */ ({});
        item[key] = nested;
        stack.push({ indent, container: nested, key });
      } else {
        item[key] = parseScalar(value);
        stack.push({ indent, container: item, key: null });
      }
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    const current = /** @type {Record<string, unknown>} */ (frame().container);
    if (value === '' || value === '|' || value === '>') {
      const nested = /** @type {Record<string, unknown>} */ ({});
      current[key] = nested;
      stack.push({ indent, container: nested, key });
    } else {
      current[key] = parseScalar(value);
    }
  }
  return root;
}

/**
 * @returns {Record<string, unknown>}
 */
function readHarnessThemeSettings() {
  const home = dshHome();
  if (!home) return {};
  const file = path.join(home, 'settings.yaml');
  try {
    const doc = parseSimpleYaml(fs.readFileSync(file, 'utf8'));
    const section = doc['ui-theme'];
    return section && typeof section === 'object' ? /** @type {Record<string, unknown>} */ (section) : {};
  } catch {
    return {};
  }
}

/**
 * The active profile's `ui-theme` config row lives in the user patch layer
 * (`profiles/<name>/cordis.patch.yml`) — the legacy `settings.yaml` document
 * was renamed `.imported` on first launch and the section moved into the
 * patch. Each patch file is a top-level YAML array of `{id, config}` rows;
 * the settings service replaces the whole `config` blob on every write, so
 * the row carrying the id `ui-theme` is the live source.
 *
 * Reads only the user's own patch — bundle/base defaults are irrelevant for
 * the boot/launcher chrome palette because every write goes through the
 * settings service into this file. Missing file/missing row → {}.
 */
/**
 * @param {unknown} text
 * @returns {Array<Record<string, unknown>>}
 */
function parseCordisPatchSections(text) {
  /** @type {string[][]} */
  const entries = [];
  /** @type {string[] | null} */
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    // A top-level `- ` row starts a new patch entry; deeper-indented `- `
    // rows stay inside the current entry's nested lists.
    if (/^- /.test(raw)) {
      current = [];
      entries.push(current);
      current.push(raw.slice(2));
      continue;
    }
    if (current === null) continue;
    // Strip the two-space block indent that sits under `- ` so the entry
    // reparses as a small object.
    current.push(raw.startsWith('  ') ? raw.slice(2) : raw);
  }
  return entries.map((chunk) => parseSimpleYaml(chunk.join('\n')));
}

/**
 * @param {string} profileDir
 * @returns {Record<string, unknown> | null}
 */
function readCordisPatchThemeSettings(profileDir) {
  const file = path.join(profileDir, 'cordis.patch.yml');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    for (const entry of parseCordisPatchSections(text)) {
      if (entry && entry.id === 'ui-theme' && entry.config && typeof entry.config === 'object') {
        return /** @type {Record<string, unknown>} */ (entry.config);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Live `ui-theme` fields the shell chrome can read without booting the
 * harness: preference, active light/dark family ids, custom families. Falls
 * back to the removed `settings.yaml` for pre-migration homes.
 */
/**
 * @returns {Record<string, unknown>}
 */
function readHarnessThemeSettingsLive() {
  const home = dshHome();
  if (!home) return {};
  // The web profile is the only profile the desktop boots today
  // (`dsh web`); if that ever widens, this lookup has to follow the launched
  // profile instead of hardcoding `web`.
  const patched = readCordisPatchThemeSettings(path.join(home, 'profiles', 'web'));
  if (patched) return patched;
  return readHarnessThemeSettings();
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @param {number} amount
 * @returns {string}
 */
function mixHex(left, right, amount) {
  const parse = (/** @type {unknown} */ hex) => {
    const value = String(hex || '').replace('#', '').slice(0, 6);
    return [
      Number.parseInt(value.slice(0, 2), 16) || 0,
      Number.parseInt(value.slice(2, 4), 16) || 0,
      Number.parseInt(value.slice(4, 6), 16) || 0,
    ];
  };
  const [lr, lg, lb] = parse(left);
  const [rr, rg, rb] = parse(right);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (/** @type {number} */ a, /** @type {number} */ b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
  return `#${channel(lr, rr)}${channel(lg, rg)}${channel(lb, rb)}`;
}

/**
 * @param {string} id
 * @param {string} name
 * @param {string} scheme
 * @param {ThemeSeeds} seeds
 * @returns {ThemeTokens}
 */
function tokensFromSeeds(id, name, scheme, seeds) {
  const bg = seeds.background;
  const fg = seeds.foreground;
  const accent = seeds.accent;
  return {
    id,
    name,
    scheme,
    bg,
    fg,
    muted: mixHex(fg, bg, 0.42),
    accent,
    field: mixHex(bg, fg, 0.06),
    line: scheme === 'light' ? 'rgba(15, 17, 21, 0.12)' : 'rgba(245, 245, 245, 0.10)',
    buttonFg: mixHex(bg, '#000000', scheme === 'light' ? 0.08 : 0),
  };
}

/**
 * @param {unknown} preference
 * @param {boolean} systemDark
 * @returns {'dark' | 'light'}
 */
function resolveMode(preference, systemDark) {
  if (preference === 'dark' || preference === 'light') return preference;
  return systemDark ? 'dark' : 'light';
}

/**
 * @param {unknown} id
 * @param {unknown} customThemes
 * @returns {ThemeFamily & { id?: unknown }}
 */
function findFamily(id, customThemes) {
  if (typeof id === 'string' && Object.hasOwn(FAMILY_SEEDS, id)) return { id, ...FAMILY_SEEDS[id] };
  const custom = Array.isArray(customThemes) ? customThemes.find((item) => item && item.id === id) : null;
  if (custom && custom.light && custom.dark) return /** @type {ThemeFamily & { id?: unknown }} */ (custom);
  return { id: DEFAULT_FAMILY_ID, ...FAMILY_SEEDS[DEFAULT_FAMILY_ID] };
}

function listThemes() {
  return Object.entries(FAMILY_SEEDS).map(([id, family]) => ({
    id,
    name: family.name,
    bg: family.dark.background,
    accent: family.dark.accent,
    scheme: id === 'paper' ? 'light' : 'dark',
  }));
}

/**
 * @param {object} [config]
 * @param {unknown} [config.theme]
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.harness]
 * @param {unknown} [options.systemDark]
 * @returns {ThemeTokens & { skin: string }}
 */
function resolveTheme(config = {}, options = {}) {
  const harness = options.harness || readHarnessThemeSettingsLive();
  const systemDark = Boolean(options.systemDark);
  const preference = harness.preference || 'system';
  const mode = resolveMode(preference, systemDark);
  const fallbackId = typeof config.theme === 'string' && FAMILY_SEEDS[config.theme]
    ? config.theme : DEFAULT_FAMILY_ID;
  const familyId = /** @type {string} */ (mode === 'dark'
    ? (harness.activeDarkThemeId || fallbackId)
    : (harness.activeLightThemeId || fallbackId));
  const family = findFamily(familyId, harness.customThemes);
  const seeds = family[mode] || FAMILY_SEEDS[DEFAULT_FAMILY_ID][mode];
  return {
    ...tokensFromSeeds(/** @type {string} */ (family.id || familyId), family.name || familyId, mode, seeds),
    skin: family.skin || 'default',
  };
}

/**
 * @param {{ scheme?: unknown }} [theme]
 * @returns {string}
 */
function officialShellBackground(theme = {}) {
  return theme.scheme === 'dark' ? '#151517' : '#FFFFFF';
}

/**
 * @param {unknown} role
 * @param {unknown} url
 * @returns {boolean}
 */
function usesOfficialShellChrome(role, url) {
  return role === 'launcher' || /(?:launcher|file-preview)\.html(?:[?#]|$)/i.test(String(url || ''));
}

/**
 * @param {{ bg?: string, scheme?: unknown }} [theme]
 * @param {object} [options]
 * @param {unknown} [options.role]
 * @param {unknown} [options.url]
 * @returns {string | undefined}
 */
function windowBackgroundForShell(theme = {}, { role, url } = {}) {
  return usesOfficialShellChrome(role, url) ? officialShellBackground(theme) : theme.bg;
}

/**
 * @param {Partial<ThemeTokens>} theme
 * @returns {Record<string, string | undefined>}
 */
function themeCssVars(theme) {
  return {
    '--bg': theme.bg,
    '--fg': theme.fg,
    '--muted': theme.muted,
    '--accent': theme.accent,
    '--field': theme.field,
    '--line': theme.line,
    '--button-fg': theme.buttonFg,
  };
}

/**
 * @param {{ accent?: string, buttonFg?: string }} theme
 * @returns {string}
 */
function harnessThemeCss(theme) {
  return `::selection { background: ${theme.accent}; color: ${theme.buttonFg}; }`;
}

module.exports = {
  THEMES,
  FAMILY_SEEDS,
  listThemes,
  resolveTheme,
  officialShellBackground,
  usesOfficialShellChrome,
  windowBackgroundForShell,
  themeCssVars,
  harnessThemeCss,
  readHarnessThemeSettings,
  readHarnessThemeSettingsLive,
  parseCordisPatchSections,
  parseSimpleYaml,
};
