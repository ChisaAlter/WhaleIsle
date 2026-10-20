'use strict';

const { applyDesktopDshHome } = require('./dsh-home');
const { applyOfficialDeepSeekSpawnEnv } = require('./official-deepseek-env');
const { prependPath } = require('./env-path');

/**
 * Shared base environment for every child process the desktop spawns to run
 * harness code (`dsh web` in dsh.js, plugin installs in
 * marketplace-install.js). One implementation keeps the dsh-home invariants
 * in a single place:
 *
 * - `DSH_HOME` is overwritten with the desktop home (never the official
 *   `~/.dsh`), dropping inherited case variants;
 * - Electron launcher variables are removed so `node`/`npx` children do not
 *   re-enter Electron;
 * - `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` are only written when the shell
 *   gateway is empty or the official https endpoint;
 * - npm update notifications are silenced;
 * - desktop market defaults are supplied beneath the editable profile layer;
 * - callers pass their own PATH `extras` (order defines precedence) and add
 *   caller-specific entries on the returned object.
 *
 * @param {object} config - desktop config (apiKey / baseUrl gating).
 * @param {{ extras?: string[], baseEnv?: NodeJS.ProcessEnv }} [options]
 * @returns {NodeJS.ProcessEnv} a fresh env object; baseEnv is not mutated.
 */
function childSpawnEnv(config, { extras = [], baseEnv = process.env } = {}) {
  const env = applyDesktopDshHome({ ...baseEnv });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  applyOfficialDeepSeekSpawnEnv(env, config);
  env.npm_config_update_notifier = 'false';
  env.DSHD_PLUGIN_MARKET_INDEX = 'https://realguan.github.io/dsh-plugin-market/dsh-index.json';
  prependPath(env, extras);
  return env;
}

module.exports = { childSpawnEnv };
