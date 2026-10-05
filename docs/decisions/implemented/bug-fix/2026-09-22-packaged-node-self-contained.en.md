# Decision: Self-contained packaged Node and destination-deduped flatten copy

Status: implemented

[中文](2026-09-22-packaged-node-self-contained.md) | English

## Problem

Two release-blocking defects reproduced in the macOS 0.3.2 candidate. First: `copyBundledNode` copied `process.execPath` verbatim — a Homebrew-installed node is a ~50KB shim binary that depends on `libnode.137.dylib` plus a dozen `/opt/homebrew/opt/*` libraries, so on a machine without that Homebrew prefix the dsh child SIGABRTs and the desktop never starts. Second: `collectFiles` flat mode maps several real directories onto the same top-level `node_modules/<pkg>`, while the dedup table is keyed by real directory, so different sources can share one dest in the copy list; `copyFiles` then runs 32 concurrent `fs.copyFile` writers onto the same file, truncating each other and leaving corrupted manifests of the shape "valid JSON + trailing fragment" that crash `dsh web` at startup.

## Decision

All fixes live in `scripts/after-pack.js`: a new `pickCopyWinners` picks a single winner per resolved dest at the `copyFiles` entry — a `.pnpm` store path loses to a top-level hoisted copy (matching the version pnpm hoisted), and among non-store paths the first writer wins; the flatten collection, version-isolation repair, and deploy assembly call paths are all protected by the same funnel. `assertHarnessRuntime` gains `assertNodeModulesManifests` at the end: every package.json under `harnessDest/node_modules` must parse, so any corrupted manifest fails the build. `copyBundledNode` on darwin/linux first probes `process.execPath`'s dylib listing via `otool -L` / `ldd`; a listing that mentions libnode, `homebrew`, `/opt/`, or `/usr/local/` marks a shim binary, and the script instead downloads the official standalone build from nodejs.org (version pinned by the root `.nvmrc`, `DSH_NODE_DIST_MIRROR` swaps the mirror), caches it under `node_modules/.cache/dshd-node-dist/`, extracts only `bin/node`, and self-checks by running `--version`. The win32 path and the `NODE_BINARY` override are unchanged.

## Alternatives considered

- **Bundle Homebrew's dependency libraries and rewrite load paths with install_name_tool** — rejected: the dependency closure drifts with Homebrew formula versions and requires recursively shipping and rewriting every load path; the official standalone build is self-contained, version-aligned with the `.nvmrc` pin, and an order of magnitude simpler.
- **Dedupe by dest inside collectFiles while collecting** — rejected: the collector only produces the pending-copy list; the truncation happens in the write-phase concurrency window. Closing it in copyFiles covers every caller (flatten, version isolation, deploy assembly) in one place.
- **Manifest gate sampling only known CLI-critical dependencies** — rejected: the damage surface is unpredictable (four packages were hit this round); parsing every package.json is linear over a few thousand small files, giving fuller coverage with a simpler rule.

## Consequences

macOS/Linux packaging no longer assumes the build host happens to ship a self-contained Node — shim environments automatically fall back to the official build, at the cost of one ~40MB download on the first pack (cached across builds). The flattened tree's top-level contents now match pnpm's hoisted resolution, and the manifest gate turns the same class of corruption from a runtime crash on the user's machine into a build-time failure. `NODE_BINARY` remains the explicit override and `DSH_NODE_DIST_MIRROR` the mirror escape hatch. `scripts/after-pack.js` currently sits outside every feature card's allowed touch (the windows-installer card lists it under Do not touch); this record is the governance vehicle for the change.
