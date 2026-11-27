import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src', 'renderer', 'pet-live2d', 'anime4k.js');
const EXPECTED_NAME = 'anime4k.js';
const EXPECTED_VERSION = '1.1.3';
const UPSTREAM_SHASUM = '9f976d8edd381089e73436116fc191d6fd6edc0e';

/** @param {string[]} argv */
function parseSourceArg(argv) {
  let source = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source' && argv[i + 1]) {
      source = argv[i + 1];
      i += 1;
    }
  }
  if (!source) {
    throw new Error('Usage: node scripts/prepare-anime4k.mjs --source <anime4k.js@1.1.3 dir>');
  }
  return path.resolve(source);
}

/** @param {string} sourceDir */
function validateSourceDir(sourceDir) {
  const pkgFile = path.join(sourceDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    throw new Error(`Missing package.json in Anime4K.js source directory: ${sourceDir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  if (manifest?.name !== EXPECTED_NAME || manifest?.version !== EXPECTED_VERSION) {
    throw new Error(`Expected ${EXPECTED_NAME}@${EXPECTED_VERSION}, got ${manifest?.name}@${manifest?.version}`);
  }
  for (const rel of [
    'src/upscaler/image.ts',
    'src/glsl/Restore/Anime4K_Clamp_Highlights.ts',
    'src/glsl/Restore/Anime4K_Restore_CNN_M.ts',
    'src/glsl/Upscale/Anime4K_Upscale_CNN_x2_M.ts',
  ]) {
    if (!fs.existsSync(path.join(sourceDir, rel))) {
      throw new Error(`Missing required Anime4K.js source module: ${rel}`);
    }
  }
}

/** @param {string[]} argv */
export async function buildAnime4kBundle(argv = process.argv.slice(2)) {
  const sourceDir = parseSourceArg(argv);
  validateSourceDir(sourceDir);

  const entrySource = [
    "import ImageUpscaler from './src/upscaler/image';",
    "import Anime4K_Clamp_Highlights from './src/glsl/Restore/Anime4K_Clamp_Highlights';",
    "import Anime4K_Restore_CNN_M from './src/glsl/Restore/Anime4K_Restore_CNN_M';",
    "import Anime4K_Upscale_CNN_x2_M from './src/glsl/Upscale/Anime4K_Upscale_CNN_x2_M';",
    'const ANIME4KJS_SIMPLE_M_2X = [',
    '  Anime4K_Clamp_Highlights,',
    '  Anime4K_Restore_CNN_M,',
    '  Anime4K_Upscale_CNN_x2_M,',
    '];',
    'export { ImageUpscaler, ANIME4KJS_SIMPLE_M_2X };',
  ].join('\n');

  const banner = [
    '/*!',
    ` * anime4k.js@${EXPECTED_VERSION} minimal preset bundle (ImageUpscaler + ANIME4KJS_SIMPLE_M_2X)`,
    ` * Source: https://github.com/monyone/Anime4K.js (npm tarball shasum ${UPSTREAM_SHASUM})`,
    ' * Licenses: MIT - Copyright (c) 2023 もにょ～ん (Anime4K.js) & Copyright (c) 2019-2021 bloc97 (Anime4K GLSL)',
    ' */',
  ].join('\n');

  await build({
    stdin: {
      contents: entrySource,
      resolveDir: sourceDir,
      loader: 'ts',
    },
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'Anime4KJS',
    target: ['es2022'],
    banner: { js: banner },
    outfile: OUT_FILE,
  });

  const bytes = fs.statSync(OUT_FILE).size;
  console.log(`[anime4k] wrote ${OUT_FILE} (${bytes} B)`);
  return { outFile: OUT_FILE, bytes };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  buildAnime4kBundle().catch((error) => {
    console.error(`[anime4k] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
