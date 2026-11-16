const { isValidAllowBuild, normalizeAllowBuilds } = require('../host/install-dsh-plugin-client');

/**
 * Parse package names pnpm asked the user to allow-build.
 * @param {string} log
 * @returns {string[]}
 */
function parseAllowBuilds(log) {
  const text = String(log || '').replace(/\\"/g, '"');
  const names = new Set();
  const ignored = text.match(/ignored build scripts:\s*([^\n]+)/i);
  if (ignored) {
    for (const part of ignored[1].split(/[,\s]+/)) {
      const name = part.replace(/@\d[\w.-]*$/, '').trim();
      if (name && /[@a-z0-9._/-]/i.test(name) && !/^https?:/i.test(name)) {
        names.add(name);
      }
    }
  }
  const prepare = /git-hosted package "([^"]+)" needs to execute build scripts/.exec(text);
  if (prepare) {
    const raw = prepare[1].trim();
    const at = raw.lastIndexOf('@');
    const name = at > 0 ? raw.slice(0, at) : raw;
    if (name) {
      names.add(name);
    }
  }
  for (const match of text.matchAll(/^\s{2,}([@a-z0-9._/-]+(?:\/[a-z0-9._-]+)?)\s*$/gim)) {
    const name = match[1];
    if (name && !/^(run|add|the|following|dependencies|ignored)$/i.test(name)) {
      names.add(name);
    }
  }
  for (const match of text.matchAll(/["'](@?[\w.-]+(?:[/.][\w.-]+)*)["']\s*:\s*(?:true|false)/g)) {
    names.add(match[1]);
  }
  return [...names].filter(isValidAllowBuild);
}

module.exports = { parseAllowBuilds };
