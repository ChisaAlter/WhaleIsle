// Build a delta update artifact between two runtime trees.
//   node scripts/build-delta.mjs --from <dir|version> --to <dir|version> --out <file>
//        [--from-version x.y.z] [--to-version x.y.z] [--product Whale-Isle]
// A spec that is an existing directory is used directly (pair it with the
// matching --*-version flag). A non-directory spec is treated as a version:
// the repo's own version resolves to dist/win-unpacked, anything else probes
// the standard per-machine install dirs for the product.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { buildDelta } = require('../src/launcher/delta/build.js');
const { deltaAssetName } = require('../src/launcher/delta/manifest.js');
const { PRODUCT_NAME, LEGACY_PRODUCT_NAMES } = require('../src/shared/product-identity.js');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoVersion = require('../package.json').version;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      throw new Error(`unexpected argument: ${key}`);
    }
    const name = key.slice(2);
    const eq = name.indexOf('=');
    if (eq >= 0) {
      args[name.slice(0, eq)] = name.slice(eq + 1);
    } else {
      args[name] = argv[++i];
    }
  }
  return args;
}

function isVersionLike(spec) {
  return /^v?\d+(\.\d+)*([.-][0-9A-Za-z.]+)?$/.test(spec);
}

function installedDirCandidates() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const names = [PRODUCT_NAME, ...LEGACY_PRODUCT_NAMES];
  const out = [];
  for (const root of roots) {
    for (const name of names) {
      out.push(path.join(root, name));
    }
  }
  return out;
}

function resolveTree(spec, flagVersion) {
  if (!spec) {
    throw new Error('missing --from/--to');
  }
  if (fs.existsSync(spec) && fs.statSync(spec).isDirectory()) {
    return { dir: path.resolve(spec), version: flagVersion || 'unknown' };
  }
  if (!isVersionLike(spec)) {
    throw new Error(`--spec "${spec}" is neither an existing directory nor a version`);
  }
  const version = spec.replace(/^v/, '');
  const candidates = version === repoVersion
    ? [path.join(REPO_ROOT, 'dist', 'win-unpacked'), ...installedDirCandidates()]
    : installedDirCandidates();
  const dir = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (!dir) {
    throw new Error(`no installed tree found for version ${spec} (searched: ${candidates.join(', ')})`);
  }
  return { dir, version: flagVersion || version };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = resolveTree(args.from, args['from-version']);
  const to = resolveTree(args.to, args['to-version']);
  const product = args.product || 'Whale-Isle';
  const out = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, 'dist', deltaAssetName(product, from.version, to.version));
  const result = await buildDelta({
    fromDir: from.dir,
    toDir: to.dir,
    outFile: out,
    product,
    fromVersion: from.version,
    toVersion: to.version,
  });
  console.log(`delta: ${result.outFile}`);
  console.log(`  ${from.version} (${from.dir}) -> ${to.version} (${to.dir})`);
  console.log(`  ops: +${result.stats.added} ~${result.stats.patched} -${result.stats.deleted} =${result.stats.unchanged} unchanged`);
  console.log(`  size: ${result.size} bytes`);
  console.log(`  sha512sums: ${result.sha512}  ${path.basename(result.outFile)}`);
}

main().catch((error) => {
  console.error(`build-delta failed: ${error.message || error}`);
  process.exit(1);
});
