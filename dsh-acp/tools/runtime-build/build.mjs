import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../..");
const outdir = path.resolve(repoRoot, "lib/vendor");
const sourceRoot = path.join(dir, "upstream");
const noticesPath = path.join(repoRoot, "THIRD_PARTY_NOTICES.md");
const lockfilePath = path.join(dir, "package-lock.json");
const checkMode = process.argv.includes("--check");

const VENDORED_PACKAGES = [
  "@t3tools/contracts",
  "@t3tools/shared",
  "@t3tools/provider-core",
  "@t3tools/provider-acp",
  "@t3tools/provider-acp-registry",
  "effect-acp",
];

function ensureVendoredLinks() {
  const linkType = process.platform === "win32" ? "junction" : "dir";
  for (const pkg of VENDORED_PACKAGES) {
    const link = path.join(dir, "node_modules", pkg);
    const target = path.join(sourceRoot, "packages", pkg.replace(/^@t3tools\//, ""));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    let needsCreate = true;
    try {
      const stat = fs.lstatSync(link);
      if (stat.isSymbolicLink()) {
        const currentTarget = path.resolve(path.dirname(link), fs.readlinkSync(link));
        if (currentTarget === path.resolve(target) && fs.existsSync(link)) {
          needsCreate = false;
        } else {
          fs.unlinkSync(link);
        }
      } else {
        throw new Error(`Expected symlink/junction at ${link}, found non-link entry.`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (needsCreate) {
      fs.symlinkSync(target, link, linkType);
    }
  }
}

function extractBundledPackages(bundleTexts) {
  const pkgs = new Set();
  const re = /^\/\/ (?:tools\/runtime-build\/)?node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm;
  for (const text of bundleTexts) {
    let match;
    while ((match = re.exec(text)) !== null) {
      const pkg = match[1];
      if (!VENDORED_PACKAGES.includes(pkg)) {
        pkgs.add(pkg);
      }
    }
  }
  return [...pkgs].sort();
}

function verifyThirdPartyNotices(bundleTexts) {
  if (!fs.existsSync(noticesPath)) {
    throw new Error(`Missing THIRD_PARTY_NOTICES.md at ${noticesPath}`);
  }
  const notices = fs.readFileSync(noticesPath, "utf8");
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  const bundledPkgs = extractBundledPackages(bundleTexts);
  const missing = [];

  for (const pkg of bundledPkgs) {
    const lockEntry = lockfile.packages?.[`node_modules/${pkg}`];
    const license = lockEntry?.license;
    const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasPackageMention = new RegExp("`" + escapedPkg + "`").test(notices);
    if (!hasPackageMention) {
      missing.push(`${pkg} (package notice missing in THIRD_PARTY_NOTICES.md)`);
      continue;
    }
    if (license && !notices.includes(license)) {
      missing.push(`${pkg} (license "${license}" text/label missing in THIRD_PARTY_NOTICES.md)`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md is incomplete for statically bundled packages:\n  - ${missing.join("\n  - ")}`,
    );
  }
  return bundledPkgs;
}

ensureVendoredLinks();

const shared = {
  absWorkingDir: dir,
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "eof",
  logLevel: checkMode ? "silent" : "info",
  write: false,
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

const targets = [
  { entry: path.join(dir, "entry.ts"), out: path.join(outdir, "agent-runtime.cjs") },
  { entry: path.join(dir, "bridge-entry.ts"), out: path.join(outdir, "mcp-bridge.cjs") },
];

const builtOutputs = [];
for (const target of targets) {
  const result = await esbuild.build({
    ...shared,
    entryPoints: [target.entry],
    format: "cjs",
  });
  const text = result.outputFiles?.[0]?.text;
  if (!text) {
    throw new Error(`esbuild produced no output for ${target.entry}`);
  }
  builtOutputs.push({ out: target.out, text: text.replace(/\r\n/g, "\n") });
}

const verifiedPkgs = verifyThirdPartyNotices(builtOutputs.map((item) => item.text));

if (checkMode) {
  const drifts = [];
  for (const { out, text } of builtOutputs) {
    if (!fs.existsSync(out)) {
      drifts.push(`${path.relative(repoRoot, out)}: missing on disk`);
      continue;
    }
    const existing = fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n");
    if (existing !== text) {
      const a = existing.split("\n");
      const b = text.split("\n");
      let firstLine = 1;
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) {
          firstLine = i + 1;
          break;
        }
      }
      drifts.push(`${path.relative(repoRoot, out)}: differs starting at line ${firstLine}`);
    }
  }
  if (drifts.length > 0) {
    console.error("ACP runtime bundles are out of sync with tools/runtime-build/:");
    for (const drift of drifts) console.error(`  - ${drift}`);
    process.exit(1);
  }
  console.log(
    `ACP runtime bundles verified (${builtOutputs.length} bundles, ${verifiedPkgs.length} third-party notices OK).`,
  );
} else {
  fs.mkdirSync(outdir, { recursive: true });
  for (const { out, text } of builtOutputs) {
    fs.writeFileSync(out, text, "utf8");
  }
  console.log(
    `ACP runtime bundles written to ${outdir} (${verifiedPkgs.length} third-party notices verified).`,
  );
}
