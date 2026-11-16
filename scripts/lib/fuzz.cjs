'use strict';

/**
 * Deterministic seeds for the property-based fuzz suite (*.fuzz.test.js).
 *
 * Plain runs — including CI — replay a stable seed derived from each
 * property's name, so a failure repeats on every rerun instead of appearing
 * at random. Two environment overrides:
 *
 *   FUZZ_SEED=<n>  run every property with exactly this seed
 *   FUZZ_RANDOM=1  draw a fresh random seed per property (scheduled hunts)
 *
 * fast-check already prints the seed and counterexample path in its failure
 * message; fuzzAssert appends the matching FUZZ_SEED reproduction hint.
 */

const crypto = require('node:crypto');
const fc = require('fast-check');

const NAME_PREFIX = 'whale-fuzz:';

function nameSeed(name) {
  return crypto.createHash('sha256').update(NAME_PREFIX + name).digest().readInt32LE(0);
}

function randomSeed() {
  return crypto.randomBytes(4).readInt32LE(0);
}

/** The seed one named property runs under the current environment. */
function fuzzSeed(name, env = process.env) {
  if (env.FUZZ_SEED !== undefined) {
    const seed = Number(env.FUZZ_SEED);
    if (!Number.isFinite(seed)) throw new Error(`FUZZ_SEED must be a number, got ${JSON.stringify(env.FUZZ_SEED)}`);
    return seed;
  }
  if (env.FUZZ_RANDOM === '1') return randomSeed();
  return nameSeed(name);
}

/**
 * fc.assert with a deterministic seed. `name` is a stable per-property label
 * (the test title); the default seed hashes it, so the same property always
 * replays the same cases. Works for property and asyncProperty alike.
 */
function fuzzAssert(property, name, params) {
  const seed = fuzzSeed(name);
  const annotate = (error) => {
    if (error instanceof Error) {
      error.message += `\nReproduce this exact run with: FUZZ_SEED=${seed}`;
    }
    throw error;
  };
  try {
    const out = fc.assert(property, { ...params, seed });
    return out && typeof out.then === 'function' ? out.catch(annotate) : out;
  } catch (error) {
    return annotate(error);
  }
}

module.exports = { fuzzAssert, fuzzSeed };
