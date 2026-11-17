const path = require('path');
const { app } = require('electron');

function projectRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '..', '..');
}

function harnessRoot() {
  if (app.isPackaged) {
    const { packagedHarnessRoot } = require('./harness-extract');
    return packagedHarnessRoot();
  }
  return path.join(projectRoot(), 'vendor', 'deepseek-harness');
}

/**
 * @param {string} name
 * @returns {string}
 */
function rendererFile(name) {
  return path.join(__dirname, '..', 'renderer', name);
}

/**
 * @param {string} name
 * @returns {string}
 */
function assetFile(name) {
  return path.join(__dirname, '..', '..', 'assets', name);
}

function preloadFile() {
  return path.join(__dirname, '..', 'preload', 'index.js');
}

module.exports = {
  projectRoot,
  harnessRoot,
  rendererFile,
  assetFile,
  preloadFile,
};
