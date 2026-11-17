'use strict';

// Property-based fuzz for the marketplace catalog spec allow-list
// (marketplace-spec.js): `#path:` monorepo specs, `github:` specs, registry
// names and their GitHub identity normalization.
const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  parseGithubSpec,
  githubIdentity,
  ownerRepoMatches,
  isValidMarketplacePathSpec,
  isAllowedMarketplaceSpec,
} = require('./marketplace-spec');
const { isValidGithubSpec, isValidPackageName } = require('../host/install-dsh-plugin-client');
const { fuzzAssert } = require('../../scripts/lib/fuzz.cjs');

const NUM_RUNS = 400;

const SPEC_CHARS = [
  'a', 'B', '0', '9', '.', '-', '_', '/', ':', '#', '@', ' ', ';', '&', '|',
  '`', '$', '(', ')', '{', '}', '<', '>', "'", '"', '\\', '*', '?', '~', '!',
  '=', '+', '..', '\n', '\x00', '中',
];

const specArb = fc.oneof(
  fc.string({ unit: fc.constantFrom(...SPEC_CHARS), maxLength: 100 }),
  fc.tuple(
    fc.string({ unit: fc.constantFrom('a', 'b', '0', '-', '_'), minLength: 1, maxLength: 12 }),
    fc.string({ unit: fc.constantFrom('a', 'b', '0', '-', '_', '.'), minLength: 1, maxLength: 12 }),
    fc.option(fc.string({ unit: fc.constantFrom(...SPEC_CHARS), maxLength: 40 })),
  ).map(([o, r, tail]) => `github:${o}/${r}${tail === null ? '' : `#${tail}`}`),
  fc.tuple(
    fc.string({ unit: fc.constantFrom('a', 'b', '0', '-'), minLength: 1, maxLength: 8 }),
    fc.string({ unit: fc.constantFrom('a', 'b', '0', '-', '_'), minLength: 1, maxLength: 8 }),
    fc.string({ unit: fc.constantFrom(...SPEC_CHARS), maxLength: 40 }),
  ).map(([o, r, p]) => `github:${o}/${r}#path:/${p}`),
  fc.constantFrom(
    'github:o/r', 'pkg', '@s/pkg', 'file:x', 'link:../x', 'https://x', 'git+https://x',
    'git://x', 'github:o/r#path:/p', 'github:o/r#path:/../x', 'github:o/r#path://x',
    'github:o/r#path:/a:b', 'github:o/r#path:/a\\b', '', 'x', 'npm:x',
  ),
);

const pluginArb = fc.record({
  homepage: fc.option(fc.string({ unit: fc.constantFrom(...SPEC_CHARS), maxLength: 60 })),
  npm: fc.option(fc.string({ unit: fc.constantFrom('a', 'b', '0', '-', '_', '.', '@', '/'), maxLength: 30 })),
}).map((p) => ({ homepage: p.homepage === null ? undefined : p.homepage, npm: p.npm === null ? undefined : p.npm }));

test('parseGithubSpec agrees with isValidGithubSpec on every input', () => {
  fuzzAssert(fc.property(specArb, (spec) => {
    assert.equal(parseGithubSpec(spec) !== null, isValidGithubSpec(spec), spec);
    const parsed = parseGithubSpec(spec);
    if (parsed) {
      assert.match(parsed.owner, /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/);
      assert.match(parsed.repo, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
      assert.equal(parsed.ref.includes('..'), false, spec);
    }
  }), 'parseGithubSpec agrees with isValidGithubSpec on every input', { numRuns: NUM_RUNS });
});

test('isValidMarketplacePathSpec: accepted paths have no traversal and match homepage', () => {
  fuzzAssert(fc.property(specArb, pluginArb, (spec, plugin) => {
    if (!isValidMarketplacePathSpec(spec, plugin)) return true;
    assert.match(spec, /^github:[^/#]+\/[^/#]+#path:\/.+$/, spec);
    const posix = spec.slice(spec.indexOf('#path:/') + '#path:/'.length);
    assert.equal(posix.includes('..'), false, spec);
    assert.equal(posix.includes(':'), false, spec);
    assert.equal(posix.includes('\\'), false, spec);
    const match = /^github:([^/#]+)\/([^/#]+)/.exec(spec);
    assert.equal(ownerRepoMatches(match[1], match[2], plugin.homepage), true, spec);
    return true;
  }), 'isValidMarketplacePathSpec: accepted paths have no traversal and match homepage', { numRuns: NUM_RUNS });
});

test('isAllowedMarketplaceSpec: accepted specs fall into the three sanctioned forms', () => {
  fuzzAssert(fc.property(specArb, pluginArb, (spec, plugin) => {
    if (!isAllowedMarketplaceSpec(spec, plugin)) return true;
    assert.equal(/[\0-\x1f]/.test(spec), false, spec);
    assert.equal(/^(?:file:|link:|https?:|git\+|git:)/i.test(spec), false, spec);
    const viaPath = spec.includes('#path:');
    const viaGithub = spec.startsWith('github:');
    if (viaPath) {
      assert.equal(isValidMarketplacePathSpec(spec, plugin), true, spec);
    } else if (viaGithub) {
      const parsed = parseGithubSpec(spec);
      assert.equal(Boolean(parsed && ownerRepoMatches(parsed.owner, parsed.repo, plugin.homepage)), true, spec);
    } else {
      assert.equal(isValidPackageName(spec), true, spec);
      assert.equal(Boolean(plugin.npm) && spec === plugin.npm, true, spec);
    }
    return true;
  }), 'isAllowedMarketplaceSpec: accepted specs fall into the three sanctioned forms', { numRuns: NUM_RUNS });
});

test('githubIdentity: output is empty or a canonical owner/repo[#path] identity', () => {
  fuzzAssert(fc.property(specArb, (spec) => {
    const id = githubIdentity(spec);
    assert.equal(id, id.toLowerCase(), `${spec} -> ${id}`);
    if (id !== '') {
      assert.match(id, /^[^/#\s]+\/[^/#\s]+(#path:\/.+)?$/, `${spec} -> ${id}`);
    }
    return true;
  }), 'githubIdentity: output is empty or a canonical owner/repo[#path] identity', { numRuns: NUM_RUNS });
});
