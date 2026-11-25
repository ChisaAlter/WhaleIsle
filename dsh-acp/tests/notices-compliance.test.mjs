import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noticesPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const lockfilePath = path.join(repoRoot, 'tools', 'runtime-build', 'package-lock.json');
const vendorBundles = [
  path.join(repoRoot, 'lib', 'vendor', 'agent-runtime.cjs'),
  path.join(repoRoot, 'lib', 'vendor', 'mcp-bridge.cjs'),
];

function extractBundledPackages(bundlePath) {
  const source = fs.readFileSync(bundlePath, 'utf8');
  const packages = new Set();
  for (const match of source.matchAll(/^\/\/ (?:\.\.\/)*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm)) {
    packages.add(match[1]);
  }
  return [...packages].sort();
}

test('THIRD_PARTY_NOTICES.md covers every third-party package statically bundled in lib/vendor/*.cjs', () => {
  const notices = fs.readFileSync(noticesPath, 'utf8');
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const allBundled = new Set();
  for (const bundlePath of vendorBundles) {
    assert.ok(fs.existsSync(bundlePath), `Missing vendor bundle: ${bundlePath}`);
    const pkgs = extractBundledPackages(bundlePath);
    assert.ok(pkgs.length > 0, `Expected bundled packages to be detectable in ${path.basename(bundlePath)}`);
    for (const pkg of pkgs) allBundled.add(pkg);
  }

  const missingPackages = [];
  const requiredLicenses = new Set();
  for (const pkg of [...allBundled].sort()) {
    if (!notices.includes(pkg)) missingPackages.push(pkg);
    const meta = lockfile.packages?.[`node_modules/${pkg}`];
    if (meta?.license) requiredLicenses.add(String(meta.license));
  }
  assert.deepEqual(missingPackages, [], `THIRD_PARTY_NOTICES.md is missing bundled packages: ${missingPackages.join(', ')}`);

  for (const license of requiredLicenses) {
    if (license === 'MIT') {
      assert.match(notices, /MIT License/i, 'THIRD_PARTY_NOTICES.md must include MIT license text');
      assert.match(notices, /Permission is hereby granted, free of charge/i);
    } else if (license === 'ISC') {
      assert.match(notices, /ISC License/i, 'THIRD_PARTY_NOTICES.md must include ISC license text');
      assert.match(notices, /Permission to use, copy, modify, and\/or distribute this software/i);
    } else {
      assert.ok(notices.includes(license), `THIRD_PARTY_NOTICES.md must mention ${license}`);
    }
  }
});
