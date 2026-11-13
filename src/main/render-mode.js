const { webContents } = require('electron');
const { readHarnessThemeSettingsLive } = require('../shared/themes');

// Profile storage remains authoritative. This process-local projection also
// reaches shell pages that exist before the Harness client has started.
let minimal;
let suggestionClaimed = false;

function getMinimalMode() {
  if (minimal === undefined) minimal = readHarnessThemeSettingsLive().minimalMode === true;
  return minimal;
}

function setMinimalMode(value) {
  if (typeof value !== 'boolean') throw new TypeError('Rendering mode must be a boolean');
  if (getMinimalMode() === value) return true;
  minimal = value;
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send('shell:render-mode', value);
  }
  return true;
}

function claimMinimalSuggestion() {
  if (suggestionClaimed || getMinimalMode()) return false;
  suggestionClaimed = true;
  return true;
}

module.exports = { getMinimalMode, setMinimalMode, claimMinimalSuggestion };
