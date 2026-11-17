import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import { noEmptyPromiseCatch } from './empty-catch.mjs';
RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester();
tester.run('no-empty-promise-catch', noEmptyPromiseCatch, {
  valid: [
    'work.catch(error => log(error));',
    'work.catch(() => { /* The original promise is returned to its caller; this only releases its tracking entry. */ });',
    'work.catch(onFailure);',
    'work.finally(() => {});',
  ],
  invalid: [
    { code: 'work.catch(() => {});', errors: [{ messageId: 'unexplained' }] },
    { code: 'work?.catch?.(function(error) {});', errors: [{ messageId: 'unexplained' }] },
    { code: "work['catch'](() => { /* ignore */ });", errors: [{ messageId: 'unexplained' }] },
  ],
});
