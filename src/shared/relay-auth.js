/**
 * Normalize a user-entered relay host token from remote settings.
 * `null` preserves the stored credential; any other value replaces it.
 * @param {*} value - value from the settings patch.
 * @returns {string|null}
 */
function normalizeRelayHostToken(value) {
  if (value == null) {
    return null;
  }
  return String(value || '').trim();
}

module.exports = {
  normalizeRelayHostToken,
};
