const path = require('node:path');
const { app } = require('electron');
const { rendererFile } = require('./paths');

/** The Node Harness loads the standalone validator outside Electron's asar filesystem. */
function whaleUiHostFile() {
  return app?.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'renderer', 'whale-ui', 'host.cjs')
    : rendererFile('whale-ui/host.cjs');
}
module.exports = { whaleUiHostFile };
