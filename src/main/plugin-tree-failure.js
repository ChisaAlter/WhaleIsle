'use strict';

const PLUGIN_BOOT_FAILED = 'PLUGIN_BOOT_FAILED';

const PLUGIN_TREE_MARKERS = [
  'plugin tree failed to load',
  'cannot resolve profile bundle',
  'failed to apply loader entry',
  'entries did not activate',
];

/**
 * Classify composition / loader-tree failures from stderr, exit text, or logs.
 * `client-modules:` matches only composition failures, not Cordis bundle-route text.
 * Node ESM resolution failures for a plugin row count too: the Loader imports
 * every mounted plugin with the profile directory as parent, so a broken or
 * missing plugin package dies as `ERR_MODULE_NOT_FOUND` / `Cannot find
 * package 'x' imported from …profiles/web/` before any tree marker prints.
 * @param {unknown} text
 * @returns {boolean}
 */
function isPluginTreeFailure(text) {
  const blob = String(text || '').toLowerCase();
  if (!blob) return false;
  if (PLUGIN_TREE_MARKERS.some((marker) => blob.includes(marker))) return true;
  if (/\bweb boot:\s+[1-9]\d* entr(?:y|ies) did not activate\b/.test(blob)) return true;
  if (blob.includes('err_module_not_found')) return true;
  if ((blob.includes('cannot find package') || blob.includes('cannot find module'))
    && blob.includes('imported from')) return true;
  if (!blob.includes('client-modules:')) return false;
  return blob.includes('clientpackagecompositionerror')
    || blob.includes('composition failed')
    || blob.includes('failed to compose')
    || blob.includes('组合失败');
}

module.exports = {
  PLUGIN_BOOT_FAILED,
  PLUGIN_TREE_MARKERS,
  isPluginTreeFailure,
};
