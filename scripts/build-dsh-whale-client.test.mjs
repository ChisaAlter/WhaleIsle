import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HARNESS_CLIENT_EXTERNALS,
  buildDshWhaleClient,
  hasValidLoaderHeader,
} from './build-dsh-whale-client.mjs';

test('buildDshWhaleClient compiles TSX + CSS into Harness ModuleLoader factory format', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-whale-client-build-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'client'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"dsh-whale"}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'shared', 'label.js'), 'export const LABEL = "机器人";\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'client', 'bots.css'), '.dsh-bots { display: flex; }\n', 'utf8');
    fs.writeFileSync(
      path.join(root, 'src', 'client', 'index.tsx'),
      [
        'import { useState } from "react";',
        'import { Button } from "@deepseek-ai/dsh-client-ui-primitives";',
        'import { LABEL } from "../shared/label.js";',
        'import "./bots.css";',
        'export const inject = ["slots"];',
        'export function apply() { return { useState, Button, node: <span>{LABEL}</span> }; }',
        '',
      ].join('\n'),
      'utf8',
    );

    const first = await buildDshWhaleClient({ packageRoot: root, silent: true });
    assert.equal(first.built, true);
    const out = fs.readFileSync(first.output, 'utf8');
    assert.equal(hasValidLoaderHeader(out), true);
    assert.match(out, /require\(["']react["']\)/);
    assert.match(out, /require\(["']react\/jsx-runtime["']\)/);
    assert.match(out, /require\(["']@deepseek-ai\/dsh-client-ui-primitives["']\)/);
    assert.match(out, /data-dsh-whale-style/);
    assert.match(out, /\.dsh-bots \{ display: flex; \}/);

    // Execute wrapped bundle in a mock ModuleLoader sandbox to verify runtime factory exports.
    let loaded;
    const mockWindow = {
      __ModuleLoader__: {
        load(spec) {
          loaded = spec;
        },
      },
    };
    const fakeModules = {
      react: { useState: () => [0, () => {}] },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      '@deepseek-ai/dsh-client-ui-primitives': { Button: 'MockButton' },
    };
    const fn = new Function('window', out);
    fn(mockWindow);
    assert.equal(loaded.id, 'dsh-whale');
    const exportsObj = loaded.factory((id) => {
      if (!(id in fakeModules)) throw new Error(`unexpected external: ${id}`);
      return fakeModules[id];
    });
    assert.deepEqual(exportsObj.inject, ['slots']);
    assert.deepEqual(exportsObj.apply().node, { type: 'span', props: { children: '机器人' } });

    // Second run without edits skips rebuild.
    const second = await buildDshWhaleClient({ packageRoot: root, silent: true });
    assert.equal(second.built, false);
    assert.ok(HARNESS_CLIENT_EXTERNALS.includes('@tanstack/react-virtual'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildDshWhaleClient preserves an existing valid bundle while src/client/index.tsx is absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-whale-client-missing-'));
  try {
    fs.mkdirSync(path.join(root, 'client'), { recursive: true });
    const existing = 'window.__ModuleLoader__.load({ id: "dsh-whale", factory: () => ({}) });\n';
    fs.writeFileSync(path.join(root, 'client', 'client.js'), existing, 'utf8');

    const skipped = await buildDshWhaleClient({ packageRoot: root, silent: true });
    assert.equal(skipped.built, false);
    assert.equal(skipped.skippedMissingEntry, true);

    await assert.rejects(
      () => buildDshWhaleClient({ packageRoot: root, strict: true, silent: true }),
      /client entry is missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inline CSS injection guards missing document.head / querySelector / setAttribute / appendChild', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-whale-client-css-guard-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'client'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"dsh-whale"}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'client', 'bots.css'), '.dsh-bots-guard { color: red; }\n', 'utf8');
    fs.writeFileSync(
      path.join(root, 'src', 'client', 'index.tsx'),
      [
        'import css from "./bots.css";',
        'export const cssText = css;',
        '',
      ].join('\n'),
      'utf8',
    );

    const built = await buildDshWhaleClient({ packageRoot: root, silent: true });
    const out = fs.readFileSync(built.output, 'utf8');
    const runBundleWithDocument = (mockDocument) => {
      let loaded;
      const mockWindow = {
        __ModuleLoader__: {
          load(spec) {
            loaded = spec;
          },
        },
      };
      const fn = new Function('window', 'document', out);
      fn(mockWindow, mockDocument);
      return loaded.factory((id) => {
        if (id === 'react') return {};
        throw new Error(`unexpected external: ${id}`);
      });
    };

    // 1. Minimal document stub: no querySelector, no setAttribute, has createElement & head.appendChild.
    const appended = [];
    const minimalRes = runBundleWithDocument({
      head: {
        appendChild(node) {
          appended.push(node);
        },
      },
      createElement(tag) {
        return { tagName: tag, textContent: '' };
      },
    });
    assert.match(minimalRes.cssText, /\.dsh-bots-guard/);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].tagName, 'style');
    assert.match(appended[0].textContent, /\.dsh-bots-guard/);

    // 2. Degenerate document objects (no head / empty head / no createElement) do not throw.
    assert.doesNotThrow(() => runBundleWithDocument({}));
    assert.doesNotThrow(() => runBundleWithDocument({ head: null }));
    assert.doesNotThrow(() => runBundleWithDocument({ head: {} }));

    // 3. Full DOM stub mounts once with data-dsh-whale-style and updates idempotently on reload.
    const styles = new Map();
    const fullDoc = {
      head: {
        querySelector(sel) {
          const match = /^style\[data-dsh-whale-style="([^"]+)"\]$/.exec(sel);
          return match ? styles.get(match[1]) || null : null;
        },
        appendChild(node) {
          styles.set(node.attrs['data-dsh-whale-style'], node);
        },
      },
      createElement(tag) {
        return {
          tagName: tag,
          attrs: {},
          textContent: '',
          setAttribute(k, v) {
            this.attrs[k] = v;
          },
        };
      },
    };
    runBundleWithDocument(fullDoc);
    runBundleWithDocument(fullDoc);
    assert.equal(styles.size, 1);
    const mounted = [...styles.values()][0];
    assert.equal(mounted.attrs['data-dsh-whale-style'], 'src/client/bots.css');
    assert.match(mounted.textContent, /\.dsh-bots-guard/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
