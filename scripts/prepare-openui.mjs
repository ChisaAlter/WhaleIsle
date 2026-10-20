/** Historical build command retained for existing callers; Whale UI owns the runtime. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWhaleUi } from './prepare-whale-ui.mjs';
export const prepareOpenUi = prepareWhaleUi;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareWhaleUi({ force: process.argv.includes('--force'), promptOnly: process.argv.includes('--prompt-only') });
}
