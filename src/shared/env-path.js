const path = require('path');

function pathKeys(env) {
  return Object.keys(env).filter((key) => key.toUpperCase() === 'PATH');
}

function windowsFallbackPath(options = {}) {
  const root = options.systemRoot || process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return [
    path.win32.join(root, 'System32'),
    root,
    path.win32.join(root, 'System32', 'Wbem'),
    path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
  ].join(';');
}

/**
 * Prepend directories onto the existing PATH key (Path vs PATH) so a Windows
 * spawn env never carries both a full Path and an extras-only PATH.
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} extras
 * @param {{ platform?: NodeJS.Platform, systemRoot?: string }} [options]
 * @returns {NodeJS.ProcessEnv}
 */
function prependPath(env, extras, options = {}) {
  const keys = pathKeys(env);
  const key = keys[0] || 'PATH';
  let current = typeof env[key] === 'string' ? env[key] : '';
  for (const extraKey of keys.slice(1)) {
    delete env[extraKey];
  }
  const prefix = (extras || []).filter(Boolean).join(path.delimiter);
  if (!prefix) {
    return env;
  }
  const platform = options.platform ?? process.platform;
  if (!current && platform === 'win32') {
    current = windowsFallbackPath(options);
  }
  env[key] = current ? `${prefix}${path.delimiter}${current}` : prefix;
  return env;
}

module.exports = {
  pathKeys,
  prependPath,
};
