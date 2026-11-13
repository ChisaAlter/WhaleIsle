import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.resolve(dir, "../../lib/vendor");
const sourceRoot = path.join(dir, "upstream");

// npm prunes unknown node_modules entries on every install; recreate the
// vendored package junctions before bundling.
for (const pkg of [
  "@t3tools/contracts",
  "@t3tools/shared",
  "@t3tools/provider-core",
  "@t3tools/provider-acp",
  "@t3tools/provider-acp-registry",
  "effect-acp",
]) {
  const link = path.join(dir, "node_modules", pkg);
  const target = path.join(sourceRoot, "packages", pkg.replace(/^@t3tools\//, ""));
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (!fs.existsSync(link)) fs.symlinkSync(target, link, "junction");
}

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info",
  // Vendored packages keep .ts extension imports; esbuild resolves them natively.
  // Node/Electron builtins stay external by platform=node.
  // Route the snapshot's bare imports to the build-time dependencies.
  nodePaths: [path.join(dir, "node_modules")],
  external: ["node-pty", "fsevents"],
  define: {
    // CJS output lacks import.meta; Vendored sources only use it for optional
    // module resolution paths — keep a file-scoped value available.
    "import.meta.url": "__runtimeImportMetaUrl",
    "import.meta.dirname": "__runtimeImportMetaDir",
  },
  banner: {
    js: 'const __runtimeImportMetaUrl = require("node:url").pathToFileURL(__filename).href; const __runtimeImportMetaDir = __dirname;',
  },
};

await esbuild.build({
  ...shared,
  entryPoints: [path.join(dir, "entry.ts")],
  outfile: path.join(outdir, "agent-runtime.cjs"),
  format: "cjs",
});

await esbuild.build({
  ...shared,
  entryPoints: [path.join(dir, "bridge-entry.ts")],
  outfile: path.join(outdir, "mcp-bridge.cjs"),
  format: "cjs",
});

// Upstream bug: the ACP registry installer uses bare `tar` on win32-x64,
// which resolves to Git Bash's GNU tar on PATH — GNU tar reads "C:" as a
// remote host and aborts ("Cannot connect to C: resolve failed"). T3 only
// selects its Windows-aware cliArchiveTarCommand for the arm64-on-x64 case.
// Generalize it: on win32 always extract with System32 bsdtar.
{
  const bundleFile = path.join(outdir, "agent-runtime.cjs");
  const before = 'platformTarget === "windows-aarch64" && paths.platformTarget === "windows-x86_64" && kind === "zip" ? cliArchiveTarCommand(platform, hostEnvironment) : "tar"';
  const after = 'platform === "win32" ? cliArchiveTarCommand(platform, hostEnvironment) : "tar"';
  const source = fs.readFileSync(bundleFile, "utf8");
  if (!source.includes(before)) throw new Error("agent-runtime.cjs tar-selection patch no longer applies");
  fs.writeFileSync(bundleFile, source.replace(before, after));
}

console.log("ACP runtime bundles written to", outdir);
