'use strict';

// Property-based fuzz for the install_dsh_plugin spec allow-lists. Every
// accepted spec must be safe to hand to `pnpm add` as an argv element: no
// shell metacharacters, no leading '-', no '..' path segments.
const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  isValidGithubSpec,
  isValidPackageName,
  isValidAllowBuild,
  normalizeAllowBuilds,
} = require('./install-dsh-plugin-client');

const NUM_RUNS = 400;

const SPEC_CHARS = [
  'a', 'B', '0', '9', '.', '-', '_', '/', ':', '#', '@', ' ', ';', '&', '|',
  '`', '$', '(', ')', '{', '}', '<', '>', "'", '"', '\\', '*', '?', '~', '!',
  '=', '+', '..', '\n', '\t', '中',
];

const specArb = fc.oneof(
  fc.string({ unit: fc.constantFrom(...SPEC_CHARS), maxLength: 80 }),
  fc.tuple(
    fc.string({ unit: fc.constantFrom('a', 'B', '0', '-', '_', '.', '@'), minLength: 0, maxLength: 20 }),
    fc.string({ unit: fc.constantFrom('a', 'b', '0', '-', '_', '.', '/'), minLength: 0, maxLength: 20 }),
    fc.option(fc.string({ unit: fc.constantFrom(...SPEC_CHARS), maxLength: 30 })),
  ).map(([o, r, ref]) => `github:${o}/${r}${ref === null ? '' : `#${ref}`}`),
  fc.constantFrom(
    'github:o/r', 'github:o/r#ref', 'github:a/b#x..y', 'github:a/b#-rf',
    'github:a/b#x@{1}', 'github:o-/r', 'github:o/r.', 'github:./r',
    'github:o/r#f/g', 'pkg', '@scope/pkg', 'github.com/o/r',
    'name@git+https://github.com/o/r.git', 'a; rm -rf /', ' github:o/r ',
    'github:', 'github:/', 'github:o/', 'github:/r', '', '..', 'x',
  ),
);

// Any character outside this set is a shell-quoting hazard for a spec that
// is handed to pnpm as an argv element.
const SAFE_SPEC_RE = /^[A-Za-z0-9@/_.:+#-]+$/;

test('isValidGithubSpec: accepted specs stay inside the github: grammar', () => {
  fc.assert(fc.property(specArb, (spec) => {
    if (!isValidGithubSpec(spec)) return true;
    const value = String(spec).trim();
    assert.match(value, SAFE_SPEC_RE, spec);
    assert.match(value, /^github:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}(#[A-Za-z0-9][A-Za-z0-9._/-]{0,254})?$/, spec);
    const ref = value.includes('#') ? value.slice(value.indexOf('#') + 1) : '';
    if (ref) {
      assert.equal(ref.includes('..'), false, spec);
      assert.equal(ref.includes('@{'), false, spec);
      assert.equal(/^-/.test(ref), false, spec);
      assert.equal(/[./]$/.test(ref), false, spec);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

test('isValidGithubSpec: trimming never changes the verdict', () => {
  fc.assert(fc.property(specArb, (spec) => {
    assert.equal(isValidGithubSpec(spec), isValidGithubSpec(String(spec).trim()));
  }), { numRuns: NUM_RUNS });
});

test('isValidPackageName: accepted names carry no metacharacters or traversal', () => {
  fc.assert(fc.property(specArb, (name) => {
    if (!isValidPackageName(name)) return true;
    const value = String(name).trim();
    assert.match(value, /^(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, name);
    assert.equal(value.includes('..'), false, name);
    assert.equal(value.length <= 214, true, name);
    return true;
  }), { numRuns: NUM_RUNS });
});

const KEY_CHARS = /^[A-Za-z0-9@/_.:+-]+$/;

test('normalizeAllowBuilds: output is unique, trimmed and individually valid', () => {
  const listArb = fc.oneof(
    fc.array(specArb, { maxLength: 40 }),
    fc.array(fc.constantFrom('pkg', '@s/p', 'github.com/o/r', 'a@git+https://github.com/o/r.git'), { maxLength: 35 }),
    fc.constantFrom(null, undefined, {}, 'x', 3, [[]], [['x', 'x']]),
  );
  fc.assert(fc.property(listArb, (value) => {
    const out = normalizeAllowBuilds(value);
    if (out === null) {
      // Rejected: a non-array payload, an oversized list, or a bad member.
      assert.ok(!Array.isArray(value) || value.length > 32 || value.some((v) => !isValidAllowBuild(v)));
      return true;
    }
    assert.deepEqual(out, [...new Set(out)]);
    for (const key of out) {
      assert.equal(key, key.trim(), key);
      assert.equal(isValidAllowBuild(key), true, key);
      assert.match(key, KEY_CHARS, key);
      assert.equal(key.startsWith('-'), false, key);
      assert.equal(key.includes('..'), false, key);
    }
    if (Array.isArray(value) && value.every((v) => isValidAllowBuild(v)) && value.length <= 32) {
      assert.equal(out.length, new Set(value.map((v) => v.trim())).size);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

test('isValidAllowBuild: accepted keys never contain whitespace or control chars', () => {
  fc.assert(fc.property(specArb, (value) => {
    if (!isValidAllowBuild(value)) return true;
    assert.match(value.trim(), KEY_CHARS, value);
    assert.equal(/\s/.test(value.trim()), false, value);
    return true;
  }), { numRuns: NUM_RUNS });
});
