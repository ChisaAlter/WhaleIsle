import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { maxLines, complexity } from './structure.mjs';
import baseline from '../structure-baseline.json' with { type: 'json' };

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' } });
const lines = count => 'void 0;\n'.repeat(count);
const file = Object.keys(baseline.maxLines)[0];
const limit = baseline.maxLines[file];
tester.run('bounded max-lines', maxLines, {
  valid: [
    { filename: resolve('src/shared/new-module.js'), code: lines(800) },
    { filename: resolve(file), code: lines(limit) },
    { filename: resolve(file), code: lines(10) },
  ],
  invalid: [
    { filename: resolve('src/shared/new-module.js'), code: lines(801), errors: [{ messageId: 'budget' }] },
    { filename: resolve(file), code: lines(limit + 1), errors: [{ messageId: 'budget' }] },
  ],
});
const [functionFile, entries] = Object.entries(baseline.complexity).find(([, functions]) => Object.keys(functions).some(name => /^\w+$/.test(name)));
const [name, budget] = Object.entries(entries).find(([key]) => /^\w+$/.test(key));
const fn = (name, size) => `function ${name}(x) { ${'if (x) x++;'.repeat(size - 1)} }`;
const [anonymousFile] = Object.entries(baseline.complexity).find(([, functions]) => Object.keys(functions).some(name => /[a-f0-9]{16}/.test(name)));
const anonymousSource = readFileSync(anonymousFile, 'utf8').replaceAll('\r\n', '\n');
tester.run('bounded complexity', complexity, {
  valid: [
    { filename: resolve(anonymousFile), languageOptions: { sourceType: 'module' }, code: anonymousSource },
    { filename: resolve(anonymousFile), languageOptions: { sourceType: 'module' }, code: anonymousSource.replaceAll('\n', '\r\n') },
    { filename: resolve('src/shared/new-module.js'), code: fn('fresh', 20) },
    { filename: resolve(functionFile), code: fn(name, budget) },
  ],
  invalid: [
    { filename: resolve(functionFile), code: fn('fresh', 21), errors: [{ messageId: 'budget' }] },
    { filename: resolve(functionFile), code: fn(name, budget + 1), errors: [{ messageId: 'budget' }] },
  ],
});
