/** Build the source-owned Whale UI viewer, registry-derived guide and fixed rendering assets. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { synchronizeWhaleUiDependencies, whaleUiInstallEnvironment } from './whale-ui-dependencies.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src/whale-ui');
const output = path.join(root, 'src/renderer/whale-ui');
const guideFile = path.join(root, 'vendor/deepseek-harness/packages/client/ui-chat/src/openui-guide.ts');
const require = createRequire(import.meta.url);

function writeChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function inputDigest(directory) {
  const hash = crypto.createHash('sha256');
  const walk = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else { hash.update(path.relative(directory, file)); hash.update(fs.readFileSync(file)); }
    }
  };
  walk(directory);
  hash.update(fs.readFileSync(fileURLToPath(import.meta.url)));
  hash.update(fs.readFileSync(new URL('./whale-ui-dependencies.mjs', import.meta.url)));
  return hash.digest('hex');
}
function ensureDependencies() {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const installed = synchronizeWhaleUiDependencies({
    manifest,
    installedVersion(name) {
      try { return JSON.parse(fs.readFileSync(path.join(source, 'node_modules', name, 'package.json'), 'utf8')).version; }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    install() {
      const harness = path.join(root, 'vendor/deepseek-harness/node_modules/pnpm/bin/pnpm.mjs');
      if (!fs.existsSync(harness)) throw new Error('Whale UI dependencies are missing or stale. Install the Harness dependencies first.');
      const result = spawnSync(process.execPath, [harness, 'install', '--dir', source, '--ignore-workspace', '--frozen-lockfile', '--ignore-scripts'], {
        cwd: root, stdio: 'inherit', env: whaleUiInstallEnvironment(process.env, process.stdin.isTTY === true),
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error('Whale UI dependency installation failed.');
    },
  });
  return { resolve: createRequire(path.join(source, 'package.json')), installed };
}
function licenseText(resolve) {
  const notices = [
    '# Whale UI third-party notices\n',
    fs.readFileSync(path.join(source, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    fs.readFileSync(path.join(source, 'language/LICENSE'), 'utf8'),
    fs.readFileSync(path.join(source, 'react/LICENSE'), 'utf8'),
    fs.readFileSync(path.join(source, 'genui/LICENSE'), 'utf8'),
    fs.readFileSync(path.join(source, 'genui/THIRD_PARTY_NOTICES.md'), 'utf8'),
  ];
  const seen = new Set();
  const collect = directory => {
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest)) return;
    const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const key = `${metadata.name}@${metadata.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    const licenseFiles = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[.\-_].*)?$/i.test(entry.name));
    notices.push(`\n## ${key} (${typeof metadata.license === 'string' ? metadata.license : 'see package notice'})\n`);
    for (const entry of licenseFiles) notices.push(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
    for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) {
      try { const dependencyRequire = createRequire(manifest); collect(packageDirectory(dependencyRequire, dependency)); }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }
    }
  };
  const packageDirectory = (localRequire, name) => {
    try { return path.dirname(localRequire.resolve(`${name}/package.json`)); }
    catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      let directory = path.dirname(localRequire.resolve(name));
      while (!fs.existsSync(path.join(directory, 'package.json'))) {
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error(`No license package root for ${name}`);
        directory = parent;
      }
      return directory;
    }
  };
  const own = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(own.dependencies).sort()) collect(packageDirectory(resolve, dependency));
  return notices.join('\n\n');
}

export async function prepareWhaleUi({ force = false, promptOnly = false } = {}) {
  const { resolve: dependency, installed } = ensureDependencies();
  const esbuild = require(dependency.resolve('esbuild'));
  const aliases = {
    '@whale-ui/language': path.join(source, 'language/index.ts'),
    '@whale-ui/react': path.join(source, 'react/index.ts'),
    '@openuidev/lang-core': path.join(source, 'language/index.ts'),
    '@openuidev/react-lang': path.join(source, 'react/index.ts'),
    react: path.dirname(dependency.resolve('react/package.json')),
    'react-dom': path.dirname(dependency.resolve('react-dom/package.json')),
    zod: path.dirname(dependency.resolve('zod/package.json')),
  };
  const shared = { bundle: true, alias: aliases, logLevel: 'warning', jsx: 'automatic', tsconfig: path.join(source, 'tsconfig.json'), loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' } };
  const digest = inputDigest(source);
  const stamp = path.join(output, 'build.json');
  if (!force && !promptOnly && !installed && fs.existsSync(stamp) && fs.existsSync(guideFile)) {
    const record = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    if (record.digest === digest && record.products?.every(file => fs.existsSync(path.join(output, file)))) return;
  }
  const guideBundle = await esbuild.build({ ...shared, entryPoints: [path.join(source, 'runtime/guide.ts')], outfile: path.join(root, '.tmp/whale-ui-guide.cjs'), format: 'cjs', platform: 'node', write: false, packages: 'external' });
  // The guide only constructs registry schemas; component browser effects do not execute.
  const tempFile = path.join(source, '.guide-build.cjs');
  writeChanged(tempFile, guideBundle.outputFiles[0].text);
  try {
    delete require.cache[tempFile];
    const guide = require(tempFile).generateWhaleGuide();
    writeChanged(guideFile, '// Generated from the owned Whale UI component registry by scripts/prepare-whale-ui.mjs.\nexport const OPENUI_GUIDE = ' + JSON.stringify(guide) + '\n');
  } finally {
    // Exact generated path under the owned package; do not remove any user file.
    fs.unlinkSync(tempFile);
  }
  if (promptOnly) return;
  fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
  await esbuild.build({ ...shared, entryPoints: [path.join(source, 'runtime/host.ts')], outfile: path.join(output, 'host.cjs'), format: 'cjs', platform: 'node', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, loader: { ...shared.loader, '.css': 'empty' } });
  const worker = fs.readFileSync(dependency.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'), 'utf8');
  const viewer = await esbuild.build({ ...shared, entryPoints: [path.join(source, 'viewer/index.tsx')], outfile: path.join(output, 'viewer.js'), write: false, format: 'iife', platform: 'browser', target: 'chrome136', minify: true, define: { 'process.env.NODE_ENV': '"production"', __WHALE_MAP_WORKER_SOURCE__: JSON.stringify(worker), 'import.meta.url': '"about:srcdoc"' } });
  const script = viewer.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  const style = viewer.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('Whale UI viewer build produced no script.');
  const { createWhaleDocument } = require(path.join(source, 'viewer/document.cjs'));
  writeChanged(path.join(output, 'viewer.html'), createWhaleDocument({ script, style }));
  const assets = {
    'mermaid.js': 'genui/client/asset-mermaid.ts',
    'three.js': 'genui/client/asset-three.ts',
    'echarts-core.js': 'genui/client/asset-echarts-core.ts',
    'echarts-full.js': 'genui/client/asset-echarts.ts',
    'icons.js': 'genui/client/icons/asset-icons.ts',
    'standalone-runtime.js': 'genui/client/standalone/runtime.tsx',
  };
  for (const [filename, entry] of Object.entries(assets)) {
    const result = await esbuild.build({ ...shared, entryPoints: [path.join(source, entry)], outfile: path.join(output, 'assets', filename), write: false, format: 'iife', platform: 'browser', target: 'chrome136', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
    const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
    const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text;
    if (!js) throw new Error(`Whale UI engine ${filename} produced no script.`);
    writeChanged(path.join(output, 'assets', filename), css ? `(function(){const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})();\n${js}` : js);
  }
  fs.mkdirSync(path.join(output, 'api'), { recursive: true });
  for (const operation of ['wiki', 'image-search', 'street-route']) {
    await esbuild.build({ ...shared, entryPoints: [path.join(source, 'resources/route.mjs')], outfile: path.join(output, 'api', `${operation}.cjs`), format: 'cjs', platform: 'node', external: ['electron'], define: { __WHALE_RESOURCE_OPERATION__: JSON.stringify(operation) } });
  }
  writeChanged(path.join(output, 'THIRD_PARTY_NOTICES.txt'), licenseText(dependency));
  const products = ['viewer.html', 'host.cjs', ...Object.keys(assets).map(file => `assets/${file}`), ...['wiki', 'image-search', 'street-route'].map(name => `api/${name}.cjs`), 'THIRD_PARTY_NOTICES.txt'];
  writeChanged(stamp, JSON.stringify({ format: 'whale-ui-build', version: 1, digest, products }, null, 2) + '\n');
  console.log('[whale-ui] prepared owned viewer, component guide, rendering engines and resource handlers');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareWhaleUi({ force: process.argv.includes('--force'), promptOnly: process.argv.includes('--prompt-only') });
}
