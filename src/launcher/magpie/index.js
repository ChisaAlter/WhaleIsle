'use strict';

const platform = require('./platform');
const release = require('./release');
const detect = require('./detect');
const dshSync = require('./dsh-sync');
const migrate = require('./migrate');
const { magpieService, ensureMagpieRuntime } = require('./service');

module.exports = {
  ...platform,
  ...release,
  ...detect,
  ...dshSync,
  ...migrate,
  magpieService,
  ensureMagpieRuntime,
};
