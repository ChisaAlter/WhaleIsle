'use strict';

const { buildSettingsSectionScript } = require('./settings-jump');

/** Open the desktop marketplace section in the existing Settings dialog. */
function buildMarketplaceScript() {
  return buildSettingsSectionScript('market');
}

module.exports = { buildMarketplaceScript };
