window.__ModuleLoader__.load({ id: "dsh-pad", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react4 = require("react");

// src/client/composer.ts
var mounted = [];
var composer = {
  attach(actions) {
    mounted.push(actions);
    return () => {
      const index = mounted.lastIndexOf(actions);
      if (index >= 0) mounted.splice(index, 1);
    };
  },
  /**
   * Put text into the composer.
   * @param text - the draft.
   * @param submit - send it right away when a session composer is mounted.
   * @returns what happened.
   */
  fill(text, submit) {
    const actions = mounted[mounted.length - 1];
    if (actions !== void 0) {
      actions.setDraft(text);
      if (submit) {
        actions.submit();
        return "sent";
      }
      focusEditor(findEditor());
      return "filled";
    }
    const editor = findEditor();
    if (editor === void 0) return "unavailable";
    focusEditor(editor);
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text);
    return "filled";
  },
  /**
   * Insert text at the caret, keeping anything the user already typed.
   * @param text - the prompt to add.
   * @returns what happened.
   */
  insert(text) {
    const actions = mounted[mounted.length - 1];
    if (actions !== void 0) {
      try {
        const span = actions.captureInsertion();
        if (!actions.insertText(text, span)) return "unavailable";
      } catch {
        return "unavailable";
      }
      focusEditor(findEditor());
      return "filled";
    }
    const editor = findEditor();
    if (editor === void 0) return "unavailable";
    focusEditor(editor);
    document.execCommand("insertText", false, text);
    return "filled";
  }
};
function findEditor() {
  const visible = (el) => el.closest(".dshpad-root") === null && el.getClientRects().length > 0;
  return [...document.querySelectorAll('[data-composer-input][contenteditable="true"]')].find(visible) ?? [...document.querySelectorAll('[contenteditable="true"]')].find(visible);
}
function focusEditor(editor) {
  if (editor === void 0) return;
  editor.focus();
  const selection = window.getSelection();
  if (selection !== null) {
    selection.selectAllChildren(editor);
    selection.collapseToEnd();
  }
}

// src/client/Dock.tsx
var import_react3 = require("react");

// src/shared/types.ts
var ROUTES = {
  panels: "/api/dsh-pad.panels",
  stream: "/api/dsh-pad.stream",
  action: "/api/dsh-pad.action",
  models: "/api/dsh-pad.models",
  run: "/api/dsh-pad.run",
  update: "/api/dsh-pad.update"
};

// src/client/layout.ts
var MAX_ROW_CHILDREN = 3;
var MAX_DEPTH = 8;
var MAX_WEIGHT = 20;
var MIN_WEIGHT = 0.05;
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function clampWeight(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, value));
}
function leaf(id) {
  return { kind: "leaf", id };
}
function makeSplit(dir, children, weights) {
  const kept = [];
  const keptWeights = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === void 0) continue;
    kept.push(child);
    keptWeights.push(clampWeight(weights?.[index]));
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0];
  return { kind: "split", dir, children: kept, weights: keptWeights };
}
function hasLeaf(node, id) {
  if (node === null) return false;
  if (node.kind === "leaf") return node.id === id;
  return node.children.some((child) => hasLeaf(child, id));
}
function parseTree(raw) {
  const seen = /* @__PURE__ */ new Set();
  return readNode(raw, void 0, seen, 0);
}
function readNode(raw, known, seen, depth) {
  if (!isRecord(raw) || depth > MAX_DEPTH) return null;
  const legacyLeaf = typeof raw["id"] === "string" && raw["kind"] !== "split";
  if (raw["kind"] === "leaf" || legacyLeaf) {
    const id = raw["id"];
    if (typeof id !== "string" || id === "" || seen.has(id)) return null;
    if (known !== void 0 && !known.has(id)) return null;
    seen.add(id);
    return leaf(id);
  }
  if (raw["kind"] !== "split" || !Array.isArray(raw["children"])) return null;
  const dir = raw["dir"] === "col" ? "col" : "row";
  const children = [];
  const weights = [];
  const limit = dir === "row" ? MAX_ROW_CHILDREN : Number.POSITIVE_INFINITY;
  for (let index = 0; index < raw["children"].length && children.length < limit; index += 1) {
    const child = readNode(raw["children"][index], known, seen, depth + 1);
    if (child === null) continue;
    children.push(child);
    weights.push(clampWeight(Array.isArray(raw["weights"]) ? raw["weights"][index] : void 0));
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { kind: "split", dir, children, weights };
}
function normalizeTree(raw, panelIds) {
  const known = [...new Set(panelIds.filter((id) => id !== ""))];
  if (known.length === 0) return null;
  const knownSet = new Set(known);
  const seen = /* @__PURE__ */ new Set();
  let tree = readNode(raw, knownSet, seen, 0);
  for (const id of known) {
    if (seen.has(id)) continue;
    seen.add(id);
    tree = appendRoot(tree, leaf(id));
  }
  return tree;
}
function legacyRowsToTree(rows) {
  const seen = /* @__PURE__ */ new Set();
  const rowNodes = [];
  for (const row of rows) {
    const ids = [];
    const weights = [];
    row.ids.forEach((id, index) => {
      if (id === "" || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
      weights.push(clampWeight(row.weights[index]));
    });
    for (let start2 = 0; start2 < ids.length; start2 += MAX_ROW_CHILDREN) {
      const chunkIds = ids.slice(start2, start2 + MAX_ROW_CHILDREN);
      const chunkWeights = weights.slice(start2, start2 + MAX_ROW_CHILDREN);
      const node = makeSplit("row", chunkIds.map(leaf), chunkWeights);
      if (node !== null) rowNodes.push(node);
    }
  }
  return makeSplit("col", rowNodes);
}
function appendRoot(tree, node) {
  if (tree === null) return node;
  if (tree.kind === "split" && tree.dir === "col") {
    return {
      kind: "split",
      dir: "col",
      children: [...tree.children, node],
      weights: [...tree.weights, 1]
    };
  }
  return { kind: "split", dir: "col", children: [tree, node], weights: [1, 1] };
}
function removeLeaf(tree, id) {
  if (tree.kind === "leaf") return tree.id === id ? null : tree;
  const children = [];
  const weights = [];
  tree.children.forEach((child, index) => {
    const next = removeLeaf(child, id);
    if (next === null) return;
    children.push(next);
    weights.push(tree.weights[index] ?? 1);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { kind: "split", dir: tree.dir, children, weights };
}
function swapLeaves(tree, a, b) {
  if (tree.kind === "leaf") {
    if (tree.id === a) return leaf(b);
    if (tree.id === b) return leaf(a);
    return tree;
  }
  return {
    kind: "split",
    dir: tree.dir,
    children: tree.children.map((child) => swapLeaves(child, a, b)),
    weights: tree.weights
  };
}
function locate(tree, id, parent = null, depth = 0, index = -1) {
  if (tree.kind === "leaf") return tree.id === id ? { depth, parent, index } : null;
  for (let position = 0; position < tree.children.length; position += 1) {
    const child = tree.children[position];
    const found = locate(child, id, tree, depth + 1, position);
    if (found !== null) return found;
  }
  return null;
}
function dropOnLeaf(tree, sourceId, targetId, zone) {
  if (sourceId === targetId) return tree;
  if (!hasLeaf(tree, sourceId) || !hasLeaf(tree, targetId)) return tree;
  if (zone === "center") return swapLeaves(tree, sourceId, targetId);
  const dir = zone === "left" || zone === "right" ? "row" : "col";
  const before = zone === "left" || zone === "top";
  const base = removeLeaf(tree, sourceId);
  if (base === null) return tree;
  const target = locate(base, targetId);
  if (target === null || target.depth >= MAX_DEPTH) return swapLeaves(tree, sourceId, targetId);
  const source = leaf(sourceId);
  const parent = target.parent;
  const canJoin = parent !== null && parent.dir === dir && (dir === "col" || parent.children.length < MAX_ROW_CHILDREN);
  if (canJoin && parent !== null) {
    const children = [...parent.children];
    const weights = [...parent.weights];
    const at = before ? target.index : target.index + 1;
    children.splice(at, 0, source);
    weights.splice(at, 0, 1);
    return replaceNode(base, parent, { kind: "split", dir: parent.dir, children, weights });
  }
  const replacement = makeSplit(dir, before ? [source, leaf(targetId)] : [leaf(targetId), source]);
  if (replacement === null) return tree;
  return replaceLeaf(base, targetId, replacement);
}
function replaceLeaf(root, id, replacement) {
  if (root.kind === "leaf") return root.id === id ? replacement : root;
  let changed = false;
  const children = root.children.map((child) => {
    const next = replaceLeaf(child, id, replacement);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { kind: "split", dir: root.dir, children, weights: root.weights } : root;
}
function moveToRoot(tree, sourceId) {
  if (!hasLeaf(tree, sourceId)) return tree;
  const base = removeLeaf(tree, sourceId);
  return base === null ? leaf(sourceId) : appendRoot(base, leaf(sourceId));
}
function replaceNode(root, target, replacement) {
  if (root === target) return replacement;
  if (root.kind === "leaf") return root;
  let changed = false;
  const children = root.children.map((child) => {
    const next = replaceNode(child, target, replacement);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { kind: "split", dir: root.dir, children, weights: root.weights } : root;
}
function nodeAtPath(tree, path) {
  let node = tree;
  for (const index of path) {
    if (node.kind !== "split") return null;
    const child = node.children[index];
    if (child === void 0) return null;
    node = child;
  }
  return node;
}
function withWeightsAtPath(tree, path, weights) {
  if (path.length === 0) {
    if (tree.kind !== "split") return tree;
    return { kind: "split", dir: tree.dir, children: tree.children, weights: applyWeights(tree.children.length, weights) };
  }
  if (tree.kind !== "split") return tree;
  const [head, ...rest] = path;
  if (head === void 0 || tree.children[head] === void 0) return tree;
  return {
    kind: "split",
    dir: tree.dir,
    children: tree.children.map((child, index) => index === head ? withWeightsAtPath(child, rest, weights) : child),
    weights: tree.weights
  };
}
function applyWeights(count, weights) {
  return Array.from({ length: count }, (_, index) => clampWeight(weights[index]));
}
function dropZoneFor(rect, x, y, edge = 0.3) {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const fx = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
  const fy = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
  const candidates = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy]
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  const nearest = candidates[0];
  return nearest[1] <= edge ? nearest[0] : "center";
}
function totalWeight(split) {
  return split.weights.reduce((sum, weight) => sum + clampWeight(weight), 0) || 1;
}

// src/client/pad-client.ts
var HISTORY_LIMIT = 120;
var LAYOUT_KEY = "dsh-pad:layout";
var DEFAULT_WIDTH = 352;
var MIN_WIDTH = 288;
var MAX_WIDTH = 980;
var MIN_PANEL_HEIGHT = 120;
var MAX_PANEL_HEIGHT = 900;
var MIN_DOCK_HEIGHT = 180;
var MAX_DOCK_HEIGHT = 2e3;
var BALL_SIZE = 28;
var BALL_MARGIN = 1;
var BALL_SNAP_INSET = 31 - BALL_SIZE / 2;
function viewportSize() {
  if (typeof window === "undefined") return { width: 1440, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}
function defaultBall() {
  const { width, height } = viewportSize();
  return {
    x: Math.max(BALL_MARGIN, Math.round(width - BALL_SIZE - BALL_SNAP_INSET)),
    y: Math.max(BALL_MARGIN, Math.round(height * 0.42 - BALL_SIZE / 2))
  };
}
var DEFAULT_LAYOUT = {
  expanded: false,
  width: DEFAULT_WIDTH,
  tree: null,
  ball: defaultBall(),
  dock: null,
  heights: {}
};
function routeUrl(route) {
  return route.slice(1);
}
function readHeights(raw) {
  const heights = {};
  if (typeof raw !== "object" || raw === null) return heights;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) heights[id] = clampPanelHeight(value);
  }
  return heights;
}
function clampPanelHeight(height) {
  return Math.round(Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, height)));
}
function awaitingFirstData(definition, data) {
  return definition.sources.some((source) => data.sources[source.id] === void 0);
}
function seedPanelHistory(store, panel) {
  if (panel.history === void 0 || panel.history === null) return;
  for (const [sourceId, points] of Object.entries(panel.history)) {
    if (!Array.isArray(points) || points.length === 0) continue;
    let panelHistory = store.get(panel.id);
    if (panelHistory === void 0) {
      panelHistory = /* @__PURE__ */ new Map();
      store.set(panel.id, panelHistory);
    }
    if (panelHistory.has(sourceId)) continue;
    const clean = points.filter((point) => typeof point?.at === "string" && Number.isFinite(Date.parse(point.at))).map((point) => ({ value: point.value, at: point.at }));
    if (clean.length > 0) panelHistory.set(sourceId, clean.slice(-HISTORY_LIMIT));
  }
}
function readPoint(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw;
  const x = record["x"];
  const y = record["y"];
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  return { x, y };
}
function readBall(raw, legacy) {
  const point = readPoint(raw);
  if (point !== null) {
    const { width, height } = viewportSize();
    return {
      x: Math.round(Math.min(Math.max(BALL_MARGIN, point.x), Math.max(BALL_MARGIN, width - BALL_SIZE - BALL_MARGIN))),
      y: Math.round(Math.min(Math.max(BALL_MARGIN, point.y), Math.max(BALL_MARGIN, height - BALL_SIZE - BALL_MARGIN)))
    };
  }
  const fraction = legacy["capsuleY"];
  if (typeof fraction === "number" && Number.isFinite(fraction)) {
    const { width, height } = viewportSize();
    const y = Math.min(0.94, Math.max(0.06, fraction));
    return { x: width - BALL_SIZE - BALL_SNAP_INSET, y: Math.round(height * y - BALL_SIZE / 2) };
  }
  return defaultBall();
}
function normalizeDockHeight(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return Math.round(Math.min(MAX_DOCK_HEIGHT, Math.max(MIN_DOCK_HEIGHT, value)));
}
function readRows(raw) {
  if (!Array.isArray(raw)) return [];
  const rows = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const row = value;
    const ids = row["ids"];
    const weights = row["weights"];
    if (!Array.isArray(ids) || !Array.isArray(weights)) continue;
    const cleanIds = ids.filter((id) => typeof id === "string" && id.length > 0);
    if (cleanIds.length === 0) continue;
    const cleanWeights = cleanIds.map((_, index) => {
      const weight = weights[index];
      return typeof weight === "number" && Number.isFinite(weight) && weight > 0 ? Math.min(20, weight) : 1;
    });
    rows.push({ ids: cleanIds, weights: cleanWeights });
  }
  return rows;
}
function normalizeDockLayout(raw) {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_LAYOUT, ball: defaultBall() };
  }
  const record = raw;
  const rows = readRows(record["rows"]);
  const tree = parseTree(record["tree"]) ?? (rows.length > 0 ? legacyRowsToTree(rows) : null);
  const width = typeof record["width"] === "number" && Number.isFinite(record["width"]) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, record["width"])) : DEFAULT_LAYOUT.width;
  const dockHeight = normalizeDockHeight(record["dockHeight"]);
  return {
    expanded: record["expanded"] === true,
    width,
    tree,
    ball: readBall(record["ball"], record),
    dock: readPoint(record["dock"]),
    heights: readHeights(record["heights"]),
    ...dockHeight === void 0 ? {} : { dockHeight }
  };
}
function readLayout() {
  try {
    return normalizeDockLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_LAYOUT, ball: defaultBall() };
  }
}
var PadClient = class {
  snapshot = { panels: [], connected: false, loaded: false, layout: readLayout(), fresh: void 0 };
  listeners = /* @__PURE__ */ new Set();
  history = /* @__PURE__ */ new Map();
  source;
  watchKey = "";
  known;
  freshTimer;
  modelCatalog;
  started = false;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  start() {
    if (this.started) return;
    this.started = true;
    this.reconnect();
  }
  stop() {
    this.started = false;
    this.source?.close();
    this.source = void 0;
    this.watchKey = "";
    clearTimeout(this.freshTimer);
  }
  /** Readings of one source collected while this page was open, oldest first. */
  historyOf(panelId, sourceId) {
    return this.history.get(panelId)?.get(sourceId) ?? [];
  }
  /** All histories of one panel, for the panel frame. */
  historiesOf(panelId) {
    return Object.fromEntries(this.history.get(panelId) ?? []);
  }
  setLayout(patch) {
    this.persistLayout(patch);
    this.reconnect();
  }
  /** Store the nested card tree (order, splits and widths). */
  setTree(tree) {
    this.setLayout({ tree });
  }
  /** Remember one panel's iframe height, or clear it with `undefined` (auto). */
  setPanelHeight(panelId, height) {
    const heights = { ...this.snapshot.layout.heights };
    if (height === void 0) delete heights[panelId];
    else heights[panelId] = clampPanelHeight(height);
    this.persistLayout({ heights });
  }
  /** Remember the dock's height, or clear it with `undefined` (auto). */
  setDockHeight(height) {
    this.persistLayout({ dockHeight: height });
  }
  /** The height the user dragged a panel to, if any. */
  panelHeight(panelId) {
    return this.snapshot.layout.heights[panelId];
  }
  persistLayout(patch) {
    const layout = normalizeDockLayout({ ...this.snapshot.layout, ...patch });
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
    }
    this.update({ layout });
  }
  async act(action) {
    try {
      const response = await fetch(routeUrl(ROUTES.action), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
        credentials: "same-origin"
      });
      const body = await response.json().catch(() => ({}));
      return response.ok ? { ok: true } : { ok: false, error: body.error ?? `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /** The per-panel model picker's catalog; fetched once per page. */
  async models(force = false) {
    if (!force && this.modelCatalog !== void 0) return this.modelCatalog;
    const response = await fetch(routeUrl(ROUTES.models), { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    this.modelCatalog = await response.json();
    return this.modelCatalog;
  }
  /** One `dsh.run` call from this panel's frame. */
  async run(panelId, prompt, system) {
    try {
      const response = await fetch(routeUrl(ROUTES.run), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panelId, prompt, ...system === void 0 ? {} : { system } }),
        credentials: "same-origin"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && typeof body.error !== "string") return { ok: false, error: `HTTP ${response.status}` };
      return {
        ok: body.ok === true,
        ...typeof body.text === "string" ? { text: body.text } : {},
        ...typeof body.error === "string" ? { error: body.error } : {}
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /** Latest GitHub release compared with the version loaded by the Host. */
  async checkUpdate(force = false) {
    const response = await fetch(`${routeUrl(ROUTES.update)}${force ? "?force=1" : ""}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  /** Download the release and replace this plugin; the next dsh start loads it. */
  async applyUpdate() {
    try {
      const response = await fetch(routeUrl(ROUTES.update), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
        credentials: "same-origin"
      });
      const body = await response.json().catch(() => ({}));
      return {
        ok: response.ok && body.ok === true,
        ...typeof body.error === "string" ? { error: body.error } : {},
        ...body.update === void 0 ? {} : { update: body.update }
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /** Panels the Host should poll: everything visible in an expanded dock. */
  watchIds() {
    if (!this.snapshot.layout.expanded) return [];
    return this.snapshot.panels.filter((p) => !p.collapsed && !p.needsApproval).map((p) => p.id);
  }
  /** (Re)open the stream when the watched set changed. */
  reconnect() {
    if (!this.started) return;
    const ids = this.watchIds();
    const key = ids.join(",");
    if (this.source !== void 0 && key === this.watchKey) return;
    this.watchKey = key;
    this.source?.close();
    const url = `${routeUrl(ROUTES.stream)}?watch=${encodeURIComponent(key)}`;
    const source = new EventSource(url, { withCredentials: true });
    this.source = source;
    source.onopen = () => {
      if (this.source === source) this.update({ connected: true });
    };
    source.onerror = () => {
      if (this.source === source) this.update({ connected: false });
    };
    source.onmessage = (message) => {
      if (this.source !== source) return;
      try {
        this.receive(JSON.parse(message.data));
      } catch {
      }
    };
  }
  receive(event) {
    if (event.type === "panels") {
      for (const panel of event.panels) {
        seedPanelHistory(this.history, panel);
        this.record(panel.id, panel.data);
      }
      const ids = new Set(event.panels.map((p) => p.id));
      for (const id of [...this.history.keys()]) if (!ids.has(id)) this.history.delete(id);
      const created = this.known === void 0 ? void 0 : event.panels.find((p) => !this.known.has(p.id));
      this.known = ids;
      this.update({ panels: event.panels, loaded: true, connected: true });
      if (created !== void 0) this.announce(created.id);
      this.reconnect();
      return;
    }
    this.record(event.panelId, event.data);
    this.update({
      panels: this.snapshot.panels.map((p) => p.id === event.panelId ? { ...p, data: event.data } : p)
    });
  }
  /** A panel appeared while the page was open: open the dock and highlight it. */
  announce(panelId) {
    clearTimeout(this.freshTimer);
    if (!this.snapshot.layout.expanded) this.setLayout({ expanded: true });
    this.update({ fresh: panelId });
    this.freshTimer = setTimeout(() => this.update({ fresh: void 0 }), 2400);
  }
  record(panelId, data) {
    let panelHistory = this.history.get(panelId);
    if (panelHistory === void 0) {
      panelHistory = /* @__PURE__ */ new Map();
      this.history.set(panelId, panelHistory);
    }
    for (const [sourceId, reading] of Object.entries(data.sources)) {
      if (!reading.ok || reading.value === void 0) continue;
      let points = panelHistory.get(sourceId);
      if (points === void 0) {
        points = [];
        panelHistory.set(sourceId, points);
      }
      if (points.length > 0 && points[points.length - 1].at === reading.at) continue;
      points.push({ value: reading.value, at: reading.at });
      if (points.length > HISTORY_LIMIT) points.splice(0, points.length - HISTORY_LIMIT);
    }
  }
  update(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
};

// src/client/PanelCard.tsx
var import_react2 = require("react");

// src/client/PanelFrame.tsx
var import_react = require("react");

// src/client/frame-runtime.ts
var FRAME_RUNTIME = String.raw`
(function () {
  'use strict';
  var root = document.documentElement;
  var token = root.getAttribute('data-token');
  var parentWin = window.parent;
  var init = JSON.parse(document.getElementById('pad-init').textContent || '{}');
  var current = init.data || null;
  var histories = init.histories || {};
  var stateStore = init.state || {};
  var lang = init.lang || 'zh';
  var listeners = [];
  var pendingRuns = {};
  var runSeq = 0;

  function post(msg) { msg.token = token; parentWin.postMessage(msg, '*'); }
  function report(err) {
    var text = err && err.stack ? String(err.stack) : String(err && err.message || err);
    post({ kind: 'error', message: text.slice(0, 2000) });
  }
  function emit() {
    var list = listeners.slice();
    // With no listener there is nothing to render: stay quiet rather than
    // reporting success for a script that never got as far as subscribing.
    if (list.length === 0) return;
    var failed = null;
    list.forEach(function (fn) {
      try { fn(current); } catch (e) { if (failed === null) failed = e; }
    });
    // Report the outcome of this render, not just failures: an error raised for
    // an earlier data set must not outlive the render that replaced it.
    if (failed === null) post({ kind: 'ok' });
    else report(failed);
  }

  window.addEventListener('error', function (e) { report(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { report(e.reason); });
  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var m = e.data || {};
    if (m.token !== token) return;
    if (m.kind === 'data') { current = m.data; histories = m.histories || histories; emit(); }
    else if (m.kind === 'theme') {
      document.getElementById('pad-theme').textContent = m.css;
      root.setAttribute('data-mode', m.mode);
    }
    else if (m.kind === 'height') {
      // A panel the user sized must scroll its own overflow; auto panels fit it.
      root.setAttribute('data-height', m.auto ? 'auto' : 'fixed');
    }
    else if (m.kind === 'run-result') {
      var runCb = pendingRuns[m.id];
      if (runCb) runCb({ ok: m.ok === true, text: m.text, error: m.error });
    }
  });

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    e.preventDefault();
    post({ kind: 'open', url: a.href });
  });

  var lastHeight = -1;
  function measure() {
    // Measure the content, not the viewport: this frame's own height is set by
    // the parent, and root.scrollHeight can never shrink below it again.
    var body = document.body;
    var h = Math.ceil(body ? body.scrollHeight : root.scrollHeight);
    if (h !== lastHeight) { lastHeight = h; post({ kind: 'resize', height: h }); }
  }
  if (typeof ResizeObserver === 'function') {
    var ro = new ResizeObserver(measure);
    ro.observe(root);
    document.addEventListener('DOMContentLoaded', function () { ro.observe(document.body); measure(); });
  }
  window.addEventListener('load', measure);

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  var zh = lang.indexOf('zh') === 0;
  var fmt = {
    bytes: function (n, digits) {
      n = Number(n);
      if (!isFinite(n)) return '—';
      var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
      var i = 0;
      while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return n.toFixed(i === 0 ? 0 : digits == null ? 1 : digits) + ' ' + units[i];
    },
    percent: function (x, digits) {
      x = Number(x);
      return isFinite(x) ? (x * 100).toFixed(digits == null ? 0 : digits) + '%' : '—';
    },
    number: function (n, digits) {
      n = Number(n);
      if (!isFinite(n)) return '—';
      return n.toLocaleString(lang, digits == null ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits });
    },
    ago: function (iso) {
      var t = typeof iso === 'number' ? iso : Date.parse(iso);
      if (!isFinite(t)) return '—';
      var s = Math.max(0, Math.round((Date.now() - t) / 1000));
      if (s < 5) return zh ? '刚刚' : 'just now';
      if (s < 60) return s + (zh ? ' 秒前' : 's ago');
      if (s < 3600) return Math.floor(s / 60) + (zh ? ' 分钟前' : 'm ago');
      if (s < 86400) return Math.floor(s / 3600) + (zh ? ' 小时前' : 'h ago');
      return Math.floor(s / 86400) + (zh ? ' 天前' : 'd ago');
    },
    duration: function (sec) {
      sec = Math.max(0, Math.floor(Number(sec)));
      if (!isFinite(sec)) return '—';
      var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
      if (d > 0) return d + (zh ? '天 ' : 'd ') + h + (zh ? '小时' : 'h');
      if (h > 0) return h + (zh ? '小时 ' : 'h ') + m + (zh ? '分' : 'm');
      if (m > 0) return m + (zh ? '分 ' : 'm ') + s + (zh ? '秒' : 's');
      return s + (zh ? '秒' : 's');
    },
    time: function (iso) {
      var d = new Date(iso);
      return isNaN(d) ? '—' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp01(x) { x = Number(x); return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }
  var gradientSeq = 0;
  var chart = {
    sparkline: function (values, opt) {
      opt = opt || {};
      var w = opt.width || 120, h = opt.height || 28, color = opt.color || 'var(--pad-accent)';
      var nums = (values || []).map(Number).filter(function (v) { return isFinite(v); });
      if (nums.length < 2) return '<svg width="' + w + '" height="' + h + '"></svg>';
      var min = opt.min != null ? opt.min : Math.min.apply(null, nums);
      var max = opt.max != null ? opt.max : Math.max.apply(null, nums);
      if (max === min) { max = min + 1; }
      var step = w / (nums.length - 1);
      var pts = nums.map(function (v, i) {
        var y = h - 1 - (v - min) / (max - min) * (h - 2);
        return (i * step).toFixed(1) + ',' + y.toFixed(1);
      });
      var id = 'pg' + (++gradientSeq);
      var area = opt.fill === false ? '' :
        '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" style="stop-color:' + color + ';stop-opacity:.28"/><stop offset="1" style="stop-color:' + color + ';stop-opacity:0"/></linearGradient></defs>' +
        '<polygon fill="url(#' + id + ')" points="0,' + h + ' ' + pts.join(' ') + ' ' + w + ',' + h + '"/>';
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="display:block;overflow:visible">' +
        area + '<polyline style="fill:none;stroke:' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/></svg>';
    },
    bar: function (fraction, opt) {
      opt = opt || {};
      var f = clamp01(fraction), color = opt.color || dsh.tone(f), h = opt.height || 6;
      return '<div style="height:' + h + 'px;border-radius:' + h + 'px;background:var(--pad-bg-2);overflow:hidden">' +
        '<div style="height:100%;width:' + (f * 100).toFixed(1) + '%;border-radius:inherit;background:' + color + ';transition:width .3s ease"></div></div>';
    },
    ring: function (fraction, opt) {
      opt = opt || {};
      var f = clamp01(fraction), size = opt.size || 44, sw = opt.stroke || 5, color = opt.color || dsh.tone(f);
      var r = (size - sw) / 2, c = 2 * Math.PI * r;
      var label = opt.label != null ? opt.label : Math.round(f * 100) + '%';
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="display:block">' +
        '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" style="fill:none;stroke:var(--pad-bg-2)" stroke-width="' + sw + '"/>' +
        '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" style="fill:none;stroke:' + color + '" stroke-width="' + sw + '" stroke-linecap="round"' +
        ' stroke-dasharray="' + (c * f).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
        '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" style="fill:var(--pad-fg);font-family:var(--pad-font);font-size:' + Math.round(size / 4) + 'px">' + esc(label) + '</text></svg>';
    }
  };

  var dsh = {
    get data() { return current; },
    onData: function (fn) {
      listeners.push(fn);
      if (current) { try { fn(current); } catch (e) { report(e); } }
      return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
    },
    history: function (sourceId) { return (histories[sourceId] || []).slice(); },
    refresh: function () { post({ kind: 'refresh' }); },
    openUrl: function (url) { post({ kind: 'open', url: String(url) }); },
    ask: function (text) { post({ kind: 'ask', text: String(text) }); },
    run: function (prompt, options) {
      var text = String(prompt == null ? '' : prompt);
      if (!text.trim()) return Promise.resolve({ ok: false, error: zh ? '提示词是空的' : 'Empty prompt' });
      var id = 'run-' + (++runSeq) + '-' + Math.random().toString(36).slice(2);
      var system = options && options.system != null ? String(options.system) : undefined;
      return new Promise(function (resolve) {
        var done = false;
        var timer;
        function finish(result) {
          if (done) return;
          done = true;
          delete pendingRuns[id];
          clearTimeout(timer);
          resolve(result);
        }
        timer = setTimeout(function () {
          finish({ ok: false, error: zh ? '模型调用超时' : 'Model call timed out' });
        }, 310000);
        pendingRuns[id] = finish;
        post({ kind: 'run', id: id, prompt: text, system: system });
      });
    },
    state: {
      get: function (key) { return stateStore[key]; },
      set: function (key, value) { stateStore[key] = value; post({ kind: 'state', key: String(key), value: value }); }
    },
    tone: function (fraction, warnAt, dangerAt) {
      var f = Number(fraction);
      if (f >= (dangerAt == null ? 0.9 : dangerAt)) return 'var(--pad-danger)';
      if (f >= (warnAt == null ? 0.7 : warnAt)) return 'var(--pad-warn)';
      return 'var(--pad-ok)';
    },
    escape: esc,
    fmt: fmt,
    chart: chart
  };
  window.dsh = dsh;
  post({ kind: 'ready' });
})();
`;

// src/client/PanelFrame.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
var BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;color:var(--pad-fg);font:13px/1.45 var(--pad-font);-webkit-font-smoothing:antialiased}
html[data-height=auto]{overflow:hidden}
body{padding:2px 0 4px}
a{color:var(--pad-accent);text-decoration:none}
a:hover{text-decoration:underline dotted;text-underline-offset:3px}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:var(--pad-border);border-radius:3px}`;
var MIN_AUTO_HEIGHT = 32;
var MAX_AUTO_HEIGHT = 640;
var STATE_PREFIX = "dsh-pad:state:";
var MAX_STATE_CHARS = 64 * 1024;
function readState(panelId) {
  try {
    return JSON.parse(localStorage.getItem(STATE_PREFIX + panelId) ?? "{}");
  } catch {
    return {};
  }
}
function writeState(panelId, key, value) {
  const state = { ...readState(panelId), [key]: value };
  const text = JSON.stringify(state);
  if (text.length > MAX_STATE_CHARS) return;
  try {
    localStorage.setItem(STATE_PREFIX + panelId, text);
  } catch {
  }
}
function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function frameDocument({ view, token, theme, data, histories, lang }) {
  const { definition } = view;
  const init = JSON.stringify({ data, histories, state: readState(view.id), lang }).replace(/</g, "\\u003c");
  const css = definition.css.replace(/<\/style/gi, "<\\/style");
  const script = definition.script.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html data-token="${token}" data-mode="${theme.mode}" data-height="${definition.height === "auto" ? "auto" : "fixed"}" lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style id="pad-theme">${theme.css}</style>
<style>${BASE_CSS}</style>
<style>${css}</style>
<script type="application/json" id="pad-init">${init}<\/script>
</head>
<body>
${definition.html}
<script>${FRAME_RUNTIME}<\/script>
<script>${script}
//# sourceURL=dsh-pad/${view.id}.js<\/script>
</body>
</html>`;
}
function PanelFrame({ view, histories, theme, lang, onRefresh, onAsk, onRun, onScriptError, height, onHeightChange, resizeLabel, resizable = true }) {
  const frameRef = (0, import_react.useRef)(null);
  const readyRef = (0, import_react.useRef)(false);
  const latest = (0, import_react.useRef)({ data: view.data, theme, onRefresh, onAsk, onRun, onScriptError, histories, height });
  const [dragHeight, setDragHeight] = (0, import_react.useState)();
  const fixedHeight = view.definition.height === "auto" ? void 0 : view.definition.height;
  latest.current = { data: view.data, theme, onRefresh, onAsk, onRun, onScriptError, histories, height };
  const [autoHeight, setAutoHeight] = (0, import_react.useState)(MIN_AUTO_HEIGHT * 2);
  const renderedHeight = dragHeight ?? height ?? fixedHeight ?? autoHeight;
  const resizing = dragHeight !== void 0;
  const { token, doc } = (0, import_react.useMemo)(() => {
    const token2 = randomToken();
    readyRef.current = false;
    const { data, theme: currentTheme, histories: readHistories } = latest.current;
    return { token: token2, doc: frameDocument({ view, token: token2, theme: currentTheme, data, histories: readHistories(), lang }) };
  }, [view.id, view.version, lang]);
  const post = (message) => {
    frameRef.current?.contentWindow?.postMessage({ ...message, token }, "*");
  };
  (0, import_react.useEffect)(() => {
    onScriptError(void 0);
    const onMessage = (event) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (message === null || typeof message !== "object" || message.token !== token) return;
      switch (message.kind) {
        case "ready":
          readyRef.current = true;
          post({ kind: "theme", css: latest.current.theme.css, mode: latest.current.theme.mode });
          post({ kind: "data", data: latest.current.data, histories: latest.current.histories() });
          post({ kind: "height", auto: latest.current.height === void 0 && view.definition.height === "auto" });
          break;
        case "resize":
          if (typeof message.height === "number" && Number.isFinite(message.height)) {
            setAutoHeight(Math.min(MAX_AUTO_HEIGHT, Math.max(MIN_AUTO_HEIGHT, Math.ceil(message.height))));
          }
          break;
        case "refresh":
          latest.current.onRefresh();
          break;
        case "open":
          if (typeof message.url === "string" && /^https?:\/\//i.test(message.url)) {
            window.open(message.url, "_blank", "noopener,noreferrer");
          }
          break;
        case "ask":
          if (typeof message.text === "string" && message.text.trim() !== "") latest.current.onAsk(message.text.slice(0, 4e3));
          break;
        case "run":
          if (typeof message.id === "string" && typeof message.prompt === "string" && message.prompt.trim() !== "") {
            const id = message.id;
            const prompt = message.prompt.slice(0, 24e3);
            const system = typeof message.system === "string" ? message.system.slice(0, 8e3) : void 0;
            void latest.current.onRun(prompt, system).then((result) => post({ kind: "run-result", id, ...result })).catch((error) => post({
              kind: "run-result",
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            }));
          }
          break;
        case "state":
          if (typeof message.key === "string") writeState(view.id, message.key, message.value);
          break;
        case "ok":
          latest.current.onScriptError(void 0);
          break;
        case "error":
          if (typeof message.message === "string") latest.current.onScriptError(message.message);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token, view.id]);
  (0, import_react.useEffect)(() => {
    if (readyRef.current) post({ kind: "data", data: view.data, histories: histories() });
  }, [view.data]);
  (0, import_react.useEffect)(() => {
    if (readyRef.current) post({ kind: "theme", css: theme.css, mode: theme.mode });
  }, [theme.css]);
  (0, import_react.useEffect)(() => {
    if (readyRef.current) post({ kind: "height", auto: height === void 0 && fixedHeight === void 0 });
  }, [height, fixedHeight]);
  const startResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = frameRef.current?.getBoundingClientRect().height ?? renderedHeight;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const heightAt = (y) => clampPanelHeight(startHeight + (y - startY));
    const move = (e) => setDragHeight(heightAt(e.clientY));
    const up = (e) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDragHeight(void 0);
      onHeightChange?.(heightAt(e.clientY));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshpad-frame-wrap", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "iframe",
      {
        ref: frameRef,
        className: `dshpad-frame${resizing ? " is-resizing" : ""}`,
        title: view.definition.title,
        sandbox: "allow-scripts",
        referrerPolicy: "no-referrer",
        srcDoc: doc,
        style: { height: renderedHeight, colorScheme: theme.mode }
      }
    ),
    resizable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        className: "dshpad-frame-handle",
        role: "separator",
        "aria-orientation": "horizontal",
        "aria-label": resizeLabel,
        title: resizeLabel,
        onPointerDown: startResize,
        onDoubleClick: () => onHeightChange?.(void 0)
      }
    ) : null
  ] });
}

// src/client/PanelCard.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function relativeTime(t, iso, now) {
  if (iso === void 0) return "\u2014";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1e3));
  if (seconds < 5) return t("time.justNow");
  if (seconds < 60) return t("time.seconds", { n: seconds });
  if (seconds < 3600) return t("time.minutes", { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("time.hours", { n: Math.floor(seconds / 3600) });
  return t("time.days", { n: Math.floor(seconds / 86400) });
}
function every(t, minutes) {
  if (minutes % 1440 === 0) return t("every.days", { n: minutes / 1440 });
  if (minutes % 60 === 0) return t("every.hours", { n: minutes / 60 });
  return t("every.minutes", { n: minutes });
}
function clock(iso) {
  if (iso === void 0) return "\u2014";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function lastUpdate(view) {
  const times = Object.values(view.data.sources).map((r) => r.at);
  if (view.data.agent !== null) times.push(view.data.agent.at);
  return times.sort().at(-1);
}
function needsAttention(view) {
  return view.needsApproval || view.agentRun?.status === "failed" || Object.values(view.data.sources).some((r) => !r.ok);
}
var Icon = {
  refresh: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" }) }),
  chevron: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4.5 6l3.5 3.5L11.5 6" }) }),
  grip: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "5.2", cy: "3.6", r: "1.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "10.8", cy: "3.6", r: "1.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "5.2", cy: "8", r: "1.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "10.8", cy: "8", r: "1.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "5.2", cy: "12.4", r: "1.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "10.8", cy: "12.4", r: "1.1" })
  ] }),
  more: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "3.5", cy: "8", r: ".9" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "8", cy: "8", r: ".9" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12.5", cy: "8", r: ".9" })
  ] }),
  expand: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10" }) })
};
var MenuIcon = {
  edit: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M10.6 2.6l2.8 2.8L5.4 13.4H2.6v-2.8l8-8z" }) }),
  refresh: Icon.refresh,
  undo: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M3.2 6.6h6.2a3.6 3.6 0 0 1 0 7.2H6" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M5.8 4L3.2 6.6l2.6 2.6" })
  ] }),
  up: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M8 13V3.4M4.2 7.2L8 3.4l3.8 3.8" }) }),
  down: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M8 3v9.6M4.2 8.8L8 12.6l3.8-3.8" }) }),
  model: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M3 5.2h10M3 10.8h10" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "6.2", cy: "5.2", r: "1.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "9.8", cy: "10.8", r: "1.5" })
  ] }),
  span: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "2", y: "3", width: "7", height: "10", rx: "1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "11", y: "3", width: "3", height: "10", rx: "1" })
  ] }),
  trash: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M3 4.6h10M6.4 4.6V2.9h3.2v1.7M4.9 4.6l.5 8.5h5.2l.5-8.5" }) })
};
function PanelCard({ view, client, theme, lang, t, now, fresh, dragging, dropTarget, dropZone, onAsk, onExpand, onDragStart }) {
  const [menuOpen, setMenuOpen] = (0, import_react2.useState)(false);
  const [confirmDelete, setConfirmDelete] = (0, import_react2.useState)(false);
  const [modelOpen, setModelOpen] = (0, import_react2.useState)(false);
  const [catalog, setCatalog] = (0, import_react2.useState)();
  const [modelError, setModelError] = (0, import_react2.useState)();
  const [modelBusy, setModelBusy] = (0, import_react2.useState)(false);
  const [scriptError, setScriptError] = (0, import_react2.useState)();
  const [actionError, setActionError] = (0, import_react2.useState)();
  const [folded, setFolded] = (0, import_react2.useState)(view.collapsed);
  const menuRef = (0, import_react2.useRef)(null);
  const { definition } = view;
  (0, import_react2.useEffect)(() => {
    setFolded(view.collapsed);
  }, [view.collapsed]);
  (0, import_react2.useEffect)(() => {
    if (!confirmDelete && !modelOpen) return;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setConfirmDelete(false);
        setModelOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDelete, modelOpen]);
  (0, import_react2.useEffect)(() => {
    if (!menuOpen) return;
    const close = (event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [menuOpen]);
  const act = async (action) => {
    setMenuOpen(false);
    const result = await client.act(action);
    setActionError(result.ok ? void 0 : result.error);
  };
  const sourceErrors = definition.sources.map((source) => [source.id, view.data.sources[source.id]]).filter(([, reading]) => reading !== void 0 && !reading.ok).map(([id, reading]) => t("card.sourceError", { id, error: reading.error ?? "" }));
  const awaiting = awaitingFirstData(definition, view.data);
  const updated = lastUpdate(view);
  const agent = definition.agent;
  const run = view.agentRun;
  const refreshing = run?.status === "running";
  const currentModel = definition.model;
  const findModel = (selection) => {
    if (selection === void 0) return void 0;
    for (const provider of catalog?.providers ?? []) {
      if (provider.id !== selection.provider) continue;
      return provider.models.find((model) => model.id === selection.model);
    }
    return void 0;
  };
  const modelLabel = currentModel === void 0 ? t("card.modelDefault") : findModel(currentModel)?.name ?? `${currentModel.provider}/${currentModel.model}`;
  const defaultModel = catalog?.default === null || catalog?.default === void 0 ? void 0 : findModel(catalog.default);
  const openModels = () => {
    setModelError(void 0);
    setModelOpen(true);
    if (catalog !== void 0) return;
    void client.models().then(setCatalog).catch((error) => setModelError(t("card.modelLoadFailed", { error: error instanceof Error ? error.message : String(error) })));
  };
  const chooseModel = async (selection) => {
    if (modelBusy) return;
    setModelBusy(true);
    setModelError(void 0);
    const result = await client.act({ op: "model", panelId: view.id, model: selection });
    setModelBusy(false);
    if (result.ok) setModelOpen(false);
    else setModelError(result.error ?? t("card.modelSwitchFailed"));
  };
  const toggleFold = () => {
    const next = !folded;
    setFolded(next);
    setActionError(void 0);
    void client.act({ op: "collapse", panelId: view.id, collapsed: next }).then((result) => {
      if (!result.ok) {
        setFolded(!next);
        setActionError(result.error);
      }
    });
  };
  let meta;
  if (refreshing) meta = t("card.agentRunning");
  else if (updated !== void 0) meta = t("card.updated", { ago: relativeTime(t, updated, now) });
  else meta = t("card.waiting");
  const startHeaderDrag = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button") !== null) return;
    if (target.closest(".dshpad-card-actions") !== null) return;
    if (target.closest(".dshpad-expand") !== null) return;
    onDragStart(event);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "article",
    {
      className: `dshpad-card${fresh ? " is-fresh" : ""}${folded ? " is-folded" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}${dropZone === void 0 ? "" : ` is-drop-${dropZone}`}`,
      "aria-label": definition.title,
      "data-panel-id": view.id,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "dshpad-card-head", onPointerDown: startHeaderDrag, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-card-grip", title: t("card.drag"), "aria-label": t("card.drag"), role: "button", tabIndex: -1, children: Icon.grip }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-card-actions", ref: menuRef, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                className: "dshpad-more",
                title: t("card.more"),
                "aria-label": t("card.more"),
                "aria-haspopup": "menu",
                "aria-expanded": menuOpen,
                onClick: () => {
                  setMenuOpen((open) => !open);
                  setConfirmDelete(false);
                },
                children: Icon.more
              }
            ),
            menuOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-menu", role: "menu", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", role: "menuitem", onClick: () => {
                setMenuOpen(false);
                onAsk(t("card.editPrompt", { title: definition.title, id: view.id }), false);
              }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-mi", children: MenuIcon.edit }),
                t("card.edit")
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "button",
                {
                  type: "button",
                  role: "menuitem",
                  disabled: view.needsApproval && !agent,
                  onClick: () => void act({ op: "refresh", panelId: view.id }),
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-mi", children: MenuIcon.refresh }),
                    t("card.refresh")
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", role: "menuitem", disabled: !view.canUndo, onClick: () => void act({ op: "undo", panelId: view.id }), children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-mi", children: MenuIcon.undo }),
                t("card.undo")
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("hr", {}),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", role: "menuitem", onClick: () => {
                setMenuOpen(false);
                openModels();
              }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-mi", children: MenuIcon.model }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("card.model") }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-menu-value", children: modelLabel })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("hr", {}),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", role: "menuitem", className: "is-danger", onClick: () => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-mi", children: MenuIcon.trash }),
                t("card.delete")
              ] })
            ] }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "button",
            {
              type: "button",
              className: "dshpad-card-title",
              "aria-expanded": !folded,
              title: folded ? t("card.unfold") : t("card.fold"),
              onClick: toggleFold,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-card-chevron", children: Icon.chevron }),
                definition.icon ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-card-icon", children: definition.icon }) : null,
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-card-name", children: definition.title })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `dshpad-card-meta${needsAttention(view) ? " is-alert" : ""}`, children: meta }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: "dshpad-icon-btn dshpad-expand",
              title: t("card.expand"),
              "aria-label": t("card.expand"),
              onClick: onExpand,
              children: Icon.expand
            }
          )
        ] }),
        confirmDelete ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-confirm", role: "alertdialog", "aria-label": t("card.deleteConfirm", { title: definition.title }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-confirm-text", children: t("card.deleteConfirm", { title: definition.title }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-confirm-hint", children: t("card.deleteCannotUndo") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-confirm-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dshpad-confirm-cancel", autoFocus: true, onClick: () => setConfirmDelete(false), children: t("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dshpad-confirm-delete", onClick: () => {
              setConfirmDelete(false);
              void act({ op: "delete", panelId: view.id });
            }, children: t("card.deleteAction") })
          ] })
        ] }) : null,
        modelOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-models", role: "dialog", "aria-label": t("card.model"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-models-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("card.model") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                className: "dshpad-models-close",
                "aria-label": t("common.close"),
                title: t("common.close"),
                onClick: () => setModelOpen(false),
                children: "\xD7"
              }
            )
          ] }),
          modelError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-models-error", children: modelError }) : null,
          catalog === void 0 && modelError === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-models-hint", children: t("card.modelLoading") }) : null,
          catalog !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-models-list", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "button",
              {
                type: "button",
                className: `dshpad-model-row${currentModel === void 0 ? " is-current" : ""}`,
                disabled: modelBusy,
                onClick: () => void chooseModel(null),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-model-name", children: t("card.modelDefault") }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-model-meta", children: defaultModel?.name ?? (catalog.default === null ? t("card.modelFollowDefault") : `${catalog.default.provider}/${catalog.default.model}`) }),
                  currentModel === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-model-check", children: "\u2713" }) : null
                ]
              }
            ),
            catalog.providers.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-model-group", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-model-provider", children: provider.name }),
              provider.models.map((model) => {
                const selected = currentModel?.provider === provider.id && currentModel.model === model.id;
                return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "button",
                  {
                    type: "button",
                    className: `dshpad-model-row${selected ? " is-current" : ""}`,
                    disabled: modelBusy,
                    onClick: () => void chooseModel({
                      provider: provider.id,
                      model: model.id,
                      ...model.defaultReasoningEffort === void 0 ? {} : { reasoningEffort: model.defaultReasoningEffort }
                    }),
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-model-name", children: model.name }),
                      model.description ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-model-meta", children: model.description }) : null,
                      selected ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshpad-model-check", children: "\u2713" }) : null
                    ]
                  },
                  model.id
                );
              })
            ] }, provider.id)),
            catalog.providers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-models-hint", children: t("card.modelEmpty") }) : null
          ] }) : null
        ] }) : null,
        folded ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-card-body", children: [
          view.needsApproval ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshpad-approve", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("approve.title") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { children: definition.sources.map((source) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: source.kind === "command" ? source.command : `${source.method ?? "GET"} ${source.url}` }) }, source.id)) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dshpad-primary", onClick: async () => {
              const result = await client.act({ op: "approve", panelId: view.id, fingerprint: view.fingerprint });
              setActionError(result.ok ? void 0 : t("approve.changed"));
            }, children: t("approve.allow") })
          ] }) : null,
          awaiting ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-card-note", children: t("card.firstData") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            PanelFrame,
            {
              view,
              histories: () => client.historiesOf(view.id),
              theme,
              lang,
              onRefresh: () => void client.act({ op: "refresh", panelId: view.id }),
              onAsk: (text) => onAsk(text, false),
              onRun: (prompt, system) => client.run(view.id, prompt, system),
              onScriptError: setScriptError,
              height: client.panelHeight(view.id),
              onHeightChange: (next) => client.setPanelHeight(view.id, next),
              resizeLabel: t("card.resize")
            }
          ),
          agent ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: `dshpad-card-note${run?.status === "failed" ? " is-alert" : ""}`, children: run?.status === "failed" && run.error ? t("card.agentFailed", { error: run.error }) : `${t("card.agentEvery", { every: every(t, agent.everyMinutes) })} \xB7 ${t("card.agentNext", { time: clock(run?.nextRunAt) })}` }) : null,
          [...sourceErrors, ...scriptError ? [scriptError.split("\n")[0]] : [], ...actionError ? [actionError] : []].map((line) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dshpad-card-note is-alert", children: line }, line))
        ] })
      ]
    }
  );
}

// src/client/theme.ts
var FALLBACK = {
  light: { fg: "#1f2329", fg2: "#545a63", fg3: "#8a9099", bg: "#ffffff", bg2: "rgba(0,0,0,.06)", border: "rgba(0,0,0,.1)" },
  dark: { fg: "#e9e9ec", fg2: "#b7b9bf", fg3: "#8e9198", bg: "#232326", bg2: "rgba(255,255,255,.08)", border: "rgba(255,255,255,.14)" }
};
var TOKENS = [
  ["--pad-fg", "--dsw-alias-label-primary", "fg"],
  ["--pad-fg-2", "--dsw-alias-label-secondary", "fg2"],
  ["--pad-fg-3", "--dsw-alias-label-tertiary", "fg3"],
  ["--pad-bg", "--dsw-alias-bg-layer-1", "bg"],
  ["--pad-bg-2", "--dsw-alias-interactive-bg-hover", "bg2"],
  ["--pad-border", "--dsw-alias-border-l1", "border"],
  ["--pad-accent", "--dsw-alias-brand-primary", "fg"],
  ["--pad-ok", "--dsw-alias-state-success-primary", "fg"],
  ["--pad-warn", "--dsw-alias-state-warn-primary", "fg"],
  ["--pad-danger", "--dsw-alias-state-error-primary", "fg"]
];
var CUSTOM_FALLBACK = {
  "--pad-accent": ["#4d6bfe", "#7c93ff"],
  "--pad-ok": ["#22a06b", "#3ddc97"],
  "--pad-warn": ["#d97706", "#f5a524"],
  "--pad-danger": ["#e5484d", "#ff6369"]
};
function luminance(color) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
  if (match === null) return void 0;
  const [r, g, b] = [match[1], match[2], match[3]].map((v) => Number(v) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function readTheme(element) {
  const style = getComputedStyle(element);
  const fg = luminance(style.color);
  const mode = fg !== void 0 && fg > 0.5 ? "dark" : "light";
  const fallback = FALLBACK[mode];
  const lines = [];
  for (const [name, token, key] of TOKENS) {
    const custom = CUSTOM_FALLBACK[name];
    const missing = custom === void 0 ? fallback[key] : mode === "dark" ? custom[1] : custom[0];
    const value = style.getPropertyValue(token).trim() || missing;
    lines.push(`${name}:${value};`);
  }
  lines.push(`--pad-font:${style.fontFamily || "system-ui, sans-serif"};`);
  lines.push('--pad-mono:ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;');
  lines.push("--pad-radius:8px;");
  lines.push(`color-scheme:${mode};`);
  return { mode, css: `:root{${lines.join("")}}` };
}
function watchTheme(onChange) {
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onChange);
  };
  const observer = new MutationObserver(schedule);
  const options = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-scheme"] };
  observer.observe(document.documentElement, options);
  if (document.body) observer.observe(document.body, options);
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", schedule);
  const timers = [setTimeout(schedule, 250), setTimeout(schedule, 1e3), setTimeout(schedule, 2500)];
  return () => {
    observer.disconnect();
    media.removeEventListener("change", schedule);
    for (const timer of timers) clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
}

// src/client/Dock.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var DRAG_THRESHOLD = 4;
var SNAP_DISTANCE = 26;
var EDGE_GAP = 8;
var SPLITTER_W = 6;
var MIN_PANE = 80;
var COLLAPSE_RIGHT = 9;
var COLLAPSE_TOP = 2;
var COLLAPSE_SIZE = 28;
var COLLAPSE_CENTER_FROM_RIGHT = COLLAPSE_RIGHT + COLLAPSE_SIZE / 2;
var COLLAPSE_CENTER_Y = COLLAPSE_TOP + COLLAPSE_SIZE / 2;
var Icon2 = {
  plus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M8 3v10M3 8h10" }) }),
  refresh: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" }) }),
  download: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M8 2.5v7.2M5 7l3 3 3-3M3 13.5h10" }) }),
  close: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M4 4l8 8M12 4l-8 8" }) })
};
var STAR_PATH = "M14 6.3C14.8 10.8 17.2 13.2 21.7 14C17.2 14.8 14.8 17.2 14 21.7C13.2 17.2 10.8 14.8 6.3 14C10.8 13.2 13.2 10.8 14 6.3Z";
function BallDisc() {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("svg", { className: "dshpad-ball-disc", viewBox: "0 0 28 28", width: "28", height: "28", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("linearGradient", { id: "dshpad-ball-surface", x1: "3", y1: "2", x2: "25", y2: "27", gradientUnits: "userSpaceOnUse", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("stop", { offset: "0", className: "dshpad-ball-stop-a" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("stop", { offset: "1", className: "dshpad-ball-stop-b" })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("circle", { className: "dshpad-ball-fill", cx: "14", cy: "14", r: "13.5" })
  ] });
}
function useNow(intervalMs) {
  const [now, setNow] = (0, import_react3.useState)(() => Date.now());
  (0, import_react3.useEffect)(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function clampBall(point, width, height) {
  return {
    x: Math.round(clamp(point.x, BALL_MARGIN, Math.max(BALL_MARGIN, width - BALL_SIZE - BALL_MARGIN))),
    y: Math.round(clamp(point.y, BALL_MARGIN, Math.max(BALL_MARGIN, height - BALL_SIZE - BALL_MARGIN)))
  };
}
function snapBall(point, width, height) {
  const right = Math.max(BALL_SNAP_INSET, width - BALL_SIZE - BALL_SNAP_INSET);
  const bottom = Math.max(BALL_SNAP_INSET, height - BALL_SIZE - BALL_SNAP_INSET);
  let { x, y } = clampBall(point, width, height);
  if (x - BALL_SNAP_INSET < SNAP_DISTANCE) x = BALL_SNAP_INSET;
  else if (right - x < SNAP_DISTANCE) x = right;
  if (y - BALL_SNAP_INSET < SNAP_DISTANCE) y = BALL_SNAP_INSET;
  else if (bottom - y < SNAP_DISTANCE) y = bottom;
  return { x, y };
}
function defaultDockPoint(ball, width, viewport, heightHint) {
  const height = clamp(heightHint, MIN_DOCK_HEIGHT, Math.max(MIN_DOCK_HEIGHT, viewport.height - EDGE_GAP * 2));
  const x = ball.x + BALL_SIZE / 2 - (width - COLLAPSE_CENTER_FROM_RIGHT);
  const y = ball.y + BALL_SIZE / 2 - COLLAPSE_CENTER_Y;
  return {
    x: Math.round(clamp(x, EDGE_GAP, Math.max(EDGE_GAP, viewport.width - width - EDGE_GAP))),
    y: Math.round(clamp(y, EDGE_GAP, Math.max(EDGE_GAP, viewport.height - height - EDGE_GAP)))
  };
}
function clampDock(point, width, viewport, heightHint) {
  const height = clamp(heightHint, MIN_DOCK_HEIGHT, Math.max(MIN_DOCK_HEIGHT, viewport.height - EDGE_GAP * 2));
  return {
    x: Math.round(clamp(point.x, EDGE_GAP, Math.max(EDGE_GAP, viewport.width - width - EDGE_GAP))),
    y: Math.round(clamp(point.y, EDGE_GAP, Math.max(EDGE_GAP, viewport.height - height - EDGE_GAP)))
  };
}
function rowTemplate(split) {
  const parts = [];
  split.children.forEach((_, index) => {
    if (index > 0) parts.push(`${SPLITTER_W}px`);
    parts.push(`${split.weights[index] ?? 1}fr`);
  });
  return parts.join(" ");
}
var DROP_LABEL = {
  left: "drop.left",
  right: "drop.right",
  top: "drop.top",
  bottom: "drop.bottom",
  center: "drop.center",
  root: "drop.root",
  hint: "drop.hint"
};
function createDock(client) {
  return function Dock({ t }) {
    const snap = (0, import_react3.useSyncExternalStore)(client.subscribe, client.getSnapshot);
    const rootRef = (0, import_react3.useRef)(null);
    const asideRef = (0, import_react3.useRef)(null);
    const shieldRef = (0, import_react3.useRef)(null);
    const [theme, setTheme] = (0, import_react3.useState)({ mode: "light", css: ":root{}" });
    const [notice, setNotice] = (0, import_react3.useState)();
    const [viewport, setViewport] = (0, import_react3.useState)(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const [ballDrag, setBallDrag] = (0, import_react3.useState)();
    const [dockDrag, setDockDrag] = (0, import_react3.useState)();
    const [dragHeight, setDragHeight] = (0, import_react3.useState)();
    const [dragWidth, setDragWidth] = (0, import_react3.useState)();
    const [drag, setDrag] = (0, import_react3.useState)();
    const [focusedId, setFocusedId] = (0, import_react3.useState)();
    const [closing, setClosing] = (0, import_react3.useState)(false);
    const [ballTransition, setBallTransition] = (0, import_react3.useState)();
    const [update, setUpdate] = (0, import_react3.useState)();
    const [updateOpen, setUpdateOpen] = (0, import_react3.useState)(false);
    const [updateBusy, setUpdateBusy] = (0, import_react3.useState)(false);
    const [updateError, setUpdateError] = (0, import_react3.useState)();
    const closeTimer = (0, import_react3.useRef)();
    const transitionTimer = (0, import_react3.useRef)();
    const holdTimer = (0, import_react3.useRef)();
    const suppressCollapseClick = (0, import_react3.useRef)(false);
    const collapsePressToken = (0, import_react3.useRef)(0);
    const focusedView = focusedId === void 0 ? void 0 : snap.panels.find((panel) => panel.id === focusedId);
    const now = useNow(1e4);
    const lang = t("dock.title") === "\u9762\u677F" ? "zh-CN" : "en";
    const panelIdsKey = snap.panels.map((panel) => panel.id).join("\0");
    const snapshotTree = (0, import_react3.useMemo)(
      () => normalizeTree(snap.layout.tree, snap.panels.map((panel) => panel.id)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [snap.layout.tree, panelIdsKey]
    );
    const treeSignature = JSON.stringify(snapshotTree);
    const [tree, setTree] = (0, import_react3.useState)(snapshotTree);
    (0, import_react3.useEffect)(() => {
      setTree(snapshotTree);
    }, [treeSignature]);
    (0, import_react3.useEffect)(() => {
      const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);
    (0, import_react3.useEffect)(() => () => {
      if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
      if (transitionTimer.current !== void 0) clearTimeout(transitionTimer.current);
      if (holdTimer.current !== void 0) clearTimeout(holdTimer.current);
    }, []);
    (0, import_react3.useEffect)(() => {
      if (snap.layout.expanded) return;
      collapsePressToken.current += 1;
      if (holdTimer.current !== void 0) {
        clearTimeout(holdTimer.current);
        holdTimer.current = void 0;
      }
      suppressCollapseClick.current = false;
    }, [snap.layout.expanded]);
    (0, import_react3.useEffect)(() => {
      if (focusedId === void 0) return;
      const onKey = (event) => {
        if (event.key === "Escape") setFocusedId(void 0);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [focusedId]);
    (0, import_react3.useEffect)(() => {
      if (focusedId !== void 0 && focusedView === void 0) setFocusedId(void 0);
    }, [focusedId, focusedView]);
    (0, import_react3.useEffect)(() => {
      const updateTheme = () => {
        if (rootRef.current === null) return;
        const next = readTheme(rootRef.current);
        setTheme((prev) => prev.css === next.css ? prev : next);
      };
      updateTheme();
      return watchTheme(updateTheme);
    }, [snap.layout.expanded]);
    (0, import_react3.useEffect)(() => {
      if (notice === void 0) return;
      const timer = setTimeout(() => setNotice(void 0), 4e3);
      return () => clearTimeout(timer);
    }, [notice]);
    (0, import_react3.useEffect)(() => {
      let alive = true;
      const load = async (force) => {
        try {
          const info = await client.checkUpdate(force);
          if (alive) setUpdate(info);
        } catch {
        }
      };
      void load(false);
      const timer = setInterval(() => void load(false), 30 * 60 * 1e3);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [client]);
    const checkUpdate = async (force) => {
      setUpdateBusy(true);
      setUpdateError(void 0);
      try {
        setUpdate(await client.checkUpdate(force));
      } catch (error) {
        setUpdateError(error instanceof Error ? error.message : String(error));
      } finally {
        setUpdateBusy(false);
      }
    };
    const applyUpdate = async () => {
      setUpdateBusy(true);
      setUpdateError(void 0);
      const result = await client.applyUpdate();
      if (result.update !== void 0) setUpdate(result.update);
      if (!result.ok) setUpdateError(t("update.applyFailed", { error: result.error ?? "unknown" }));
      setUpdateBusy(false);
    };
    const ask = (text, submit, insert = false) => {
      const result = insert ? composer.insert(text) : composer.fill(text, submit);
      if (result === "unavailable") {
        void navigator.clipboard?.writeText(text).catch(() => {
        });
        setNotice(t("new.unavailable"));
        return false;
      }
      if (result === "filled" && submit) setNotice(t("new.filled"));
      return true;
    };
    const attention = snap.panels.some(needsAttention);
    const ballPoint = clampBall(ballDrag ?? snap.layout.ball, viewport.width, viewport.height);
    const widthLimit = Math.max(120, viewport.width - EDGE_GAP * 2);
    const dockWidth = Math.min(dragWidth ?? snap.layout.width, widthLimit);
    const openHeight = snap.layout.dockHeight ?? Math.min(560, Math.max(MIN_DOCK_HEIGHT, viewport.height - EDGE_GAP * 2));
    const ballAnchorTop = ballPoint.y + BALL_SIZE / 2 - COLLAPSE_CENTER_Y;
    const belowBall = viewport.height - EDGE_GAP - ballAnchorTop;
    const defaultOpenHeight = belowBall >= MIN_DOCK_HEIGHT ? Math.max(MIN_DOCK_HEIGHT, Math.min(openHeight, belowBall)) : openHeight;
    const baseDock = snap.layout.dock ?? defaultDockPoint(ballPoint, dockWidth, viewport, defaultOpenHeight);
    const savedHeight = dragHeight ?? snap.layout.dockHeight;
    const dockPoint = dockDrag ?? clampDock(
      baseDock,
      dockWidth,
      viewport,
      snap.layout.dock === null ? defaultOpenHeight : savedHeight ?? MIN_DOCK_HEIGHT
    );
    const starPoint = snap.layout.expanded ? {
      x: dockPoint.x + dockWidth - COLLAPSE_RIGHT - COLLAPSE_SIZE,
      y: dockPoint.y + COLLAPSE_TOP
    } : ballPoint;
    const starAnchor = /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-star-anchor", style: { left: starPoint.x, top: starPoint.y }, "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { viewBox: "0 0 28 28", width: "28", height: "28", focusable: "false", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: STAR_PATH }) }) });
    const availableHeight = Math.max(MIN_DOCK_HEIGHT, viewport.height - dockPoint.y - EDGE_GAP);
    const renderedHeight = savedHeight === void 0 ? void 0 : Math.min(savedHeight, availableHeight);
    const maxHeight = renderedHeight ?? availableHeight;
    const dockStyle = {
      left: dockPoint.x,
      top: dockPoint.y,
      width: dockWidth,
      height: renderedHeight,
      maxHeight
    };
    const reserve = snap.layout.expanded && dockPoint.x + dockWidth >= viewport.width - EDGE_GAP - 2 ? Math.round(dockWidth) + 12 : 0;
    (0, import_react3.useEffect)(() => {
      const root = document.documentElement;
      root.classList.toggle("dshpad-reserve", reserve > 0);
      root.style.setProperty("--dshpad-reserve", `${reserve}px`);
    }, [reserve]);
    (0, import_react3.useEffect)(() => () => {
      document.documentElement.classList.remove("dshpad-reserve");
      document.documentElement.style.removeProperty("--dshpad-reserve");
    }, []);
    const commitTree = (next) => {
      const normalized = normalizeTree(next, snap.panels.map((panel) => panel.id));
      if (normalized === null) return;
      setTree(normalized);
      client.setTree(normalized);
    };
    const cardAt = (x, y) => {
      const shield = shieldRef.current;
      if (shield !== null) shield.style.pointerEvents = "none";
      const node = document.elementFromPoint(x, y);
      if (shield !== null) shield.style.pointerEvents = "";
      const card = node instanceof Element ? node.closest("[data-panel-id]") : null;
      if (card === null) return void 0;
      const id = card.getAttribute("data-panel-id");
      if (id === null || id === "") return void 0;
      return { id, rect: card.getBoundingClientRect() };
    };
    const startCardDrag = (sourceId, event) => {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      const capture = event.currentTarget;
      let moved = false;
      const move = (pointer) => {
        if (!moved && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) <= DRAG_THRESHOLD) return;
        if (!moved) {
          try {
            capture.setPointerCapture(pointerId);
          } catch {
          }
          pointer.preventDefault();
        }
        moved = true;
        const under = cardAt(pointer.clientX, pointer.clientY);
        const target = under !== void 0 && under.id !== sourceId ? under.id : void 0;
        const zone = target === void 0 || under === void 0 ? void 0 : dropZoneFor(under.rect, pointer.clientX, pointer.clientY);
        setDrag({
          id: sourceId,
          x: pointer.clientX,
          y: pointer.clientY,
          target,
          ...zone === void 0 ? {} : { zone },
          blank: under === void 0
        });
      };
      const suppressClick = (click) => {
        click.preventDefault();
        click.stopPropagation();
        click.stopImmediatePropagation();
      };
      const finish = (pointer) => {
        const under = cardAt(pointer.clientX, pointer.clientY);
        cleanup();
        setDrag(void 0);
        if (!moved) return;
        document.addEventListener("click", suppressClick, { capture: true, once: true });
        setTimeout(() => document.removeEventListener("click", suppressClick, true), 160);
        if (tree === null) return;
        if (under === void 0) {
          commitTree(moveToRoot(tree, sourceId));
        } else if (under.id !== sourceId) {
          commitTree(dropOnLeaf(tree, sourceId, under.id, dropZoneFor(under.rect, pointer.clientX, pointer.clientY)));
        }
      };
      const cancel = () => {
        cleanup();
        setDrag(void 0);
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", cancel);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
      document.addEventListener("pointercancel", cancel);
    };
    const startSplit = (path, boundary, event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      if (tree === null) return;
      const baseTree = tree;
      const split = nodeAtPath(baseTree, path);
      const areaElement = event.currentTarget.parentElement;
      if (split === null || split.kind !== "split" || split.dir !== "row" || areaElement === null) return;
      if (boundary + 1 >= split.children.length) return;
      const rect = areaElement.getBoundingClientRect();
      const gaps = SPLITTER_W * (split.children.length - 1);
      const cardArea = Math.max(1, rect.width - gaps);
      const total = totalWeight(split);
      const pairWeight = (split.weights[boundary] ?? 1) + (split.weights[boundary + 1] ?? 1);
      const startPx = (split.weights[boundary] ?? 1) / total * cardArea;
      const pairPx = pairWeight / total * cardArea;
      const minLeft = Math.min(MIN_PANE, pairPx / 2);
      const maxLeft = Math.max(minLeft, pairPx - MIN_PANE);
      const startX = event.clientX;
      let final = baseTree;
      const move = (pointer) => {
        const leftPx = clamp(startPx + pointer.clientX - startX, minLeft, maxLeft);
        const leftWeight = leftPx / cardArea * total;
        const weights = split.weights.map((weight, index) => index === boundary ? leftWeight : index === boundary + 1 ? pairWeight - leftWeight : weight);
        final = withWeightsAtPath(baseTree, path, weights);
        setTree(final);
      };
      const up = () => {
        cleanup();
        setTree(final);
        client.setTree(final);
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    };
    const collapse = () => {
      if (closing) return;
      const buttonRect = asideRef.current?.querySelector(".dshpad-collapse")?.getBoundingClientRect();
      const center = buttonRect === void 0 ? { x: dockPoint.x + dockWidth - COLLAPSE_CENTER_FROM_RIGHT, y: dockPoint.y + COLLAPSE_CENTER_Y } : { x: buttonRect.left + buttonRect.width / 2, y: buttonRect.top + buttonRect.height / 2 };
      const nextBall = clampBall(
        { x: center.x - BALL_SIZE / 2, y: center.y - BALL_SIZE / 2 },
        viewport.width,
        viewport.height
      );
      if (transitionTimer.current !== void 0) {
        clearTimeout(transitionTimer.current);
        transitionTimer.current = void 0;
      }
      setBallTransition({ point: nextBall, mode: "closing" });
      setClosing(true);
      closeTimer.current = setTimeout(() => {
        setClosing(false);
        setBallTransition(void 0);
        client.setLayout({ expanded: false, ball: nextBall });
      }, 160);
    };
    const openFromBall = (point) => {
      if (transitionTimer.current !== void 0) clearTimeout(transitionTimer.current);
      setBallTransition({ point, mode: "opening" });
      client.setLayout({ expanded: true });
      transitionTimer.current = setTimeout(() => {
        setBallTransition(void 0);
        transitionTimer.current = void 0;
      }, 200);
    };
    const onBallPointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const start2 = ballPoint;
      let moved = false;
      let final = start2;
      const move = (pointer) => {
        if (!moved && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < DRAG_THRESHOLD) return;
        moved = true;
        final = clampBall({ x: start2.x + pointer.clientX - startX, y: start2.y + pointer.clientY - startY }, viewport.width, viewport.height);
        setBallDrag(final);
      };
      const up = () => {
        cleanup();
        if (!moved) {
          setBallDrag(void 0);
          openFromBall(start2);
          return;
        }
        const snapped = snapBall(final, viewport.width, viewport.height);
        setBallDrag(void 0);
        client.setLayout({ ball: snapped, dock: null });
      };
      const cancel = () => {
        cleanup();
        setBallDrag(void 0);
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
    };
    const onBallKey = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openFromBall(ballPoint);
      }
    };
    const startDockMove = (startX, startY, onFirstMove) => {
      const start2 = dockPoint;
      const width = dockWidth;
      const boxHeight = asideRef.current?.getBoundingClientRect().height ?? MIN_DOCK_HEIGHT;
      const height = clamp(Math.round(boxHeight), MIN_DOCK_HEIGHT, Math.max(MIN_DOCK_HEIGHT, viewport.height - EDGE_GAP * 2));
      const maxX = Math.max(EDGE_GAP, viewport.width - width - EDGE_GAP);
      const maxY = Math.max(EDGE_GAP, viewport.height - height - EDGE_GAP);
      let moved = false;
      let final = start2;
      const move = (pointer) => {
        if (!moved && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < DRAG_THRESHOLD) return;
        if (!moved) {
          moved = true;
          onFirstMove?.();
          setDragHeight(height);
        }
        final = {
          x: Math.round(clamp(start2.x + pointer.clientX - startX, EDGE_GAP, maxX)),
          y: Math.round(clamp(start2.y + pointer.clientY - startY, EDGE_GAP, maxY))
        };
        setDockDrag(final);
      };
      const up = () => {
        cleanup();
        if (!moved) return;
        setDockDrag(void 0);
        setDragHeight(void 0);
        client.setLayout({ dock: final, dockHeight: height });
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    };
    const onHeadPointerDown = (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button") !== null) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      startDockMove(event.clientX, event.clientY);
    };
    const onCollapsePointerDown = (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      suppressCollapseClick.current = false;
      const token = collapsePressToken.current + 1;
      collapsePressToken.current = token;
      if (holdTimer.current !== void 0) {
        clearTimeout(holdTimer.current);
        holdTimer.current = void 0;
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      let dragged = false;
      let dragStarted = false;
      const clearTimer = () => {
        if (holdTimer.current !== void 0) {
          clearTimeout(holdTimer.current);
          holdTimer.current = void 0;
        }
      };
      const beginDrag = () => {
        if (dragStarted || token !== collapsePressToken.current) return;
        dragStarted = true;
        clearTimer();
        startDockMove(startX, startY, () => {
          dragged = true;
        });
      };
      const onMove = (pointer) => {
        if (Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > 8) {
          moved = true;
          beginDrag();
        }
      };
      const onUp = () => {
        clearTimer();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        if (!dragStarted && !moved) return;
        if (!dragged && !moved) return;
        suppressCollapseClick.current = true;
        setTimeout(() => {
          suppressCollapseClick.current = false;
        }, 500);
      };
      holdTimer.current = setTimeout(beginDrag, 260);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    };
    const onCollapseClick = () => {
      if (suppressCollapseClick.current) {
        suppressCollapseClick.current = false;
        return;
      }
      collapse();
    };
    const onResizePointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const startX = event.clientX;
      const startWidth = dockWidth;
      const right = dockPoint.x + startWidth;
      const minWidth = Math.min(MIN_WIDTH, Math.max(140, viewport.width - EDGE_GAP * 2));
      const maxWidth = Math.max(minWidth, Math.min(MAX_WIDTH, right - EDGE_GAP));
      let finalWidth = startWidth;
      let finalPoint = dockPoint;
      const move = (pointer) => {
        finalWidth = Math.round(clamp(startWidth + (startX - pointer.clientX), minWidth, maxWidth));
        finalPoint = { x: Math.round(right - finalWidth), y: dockPoint.y };
        setDragWidth(finalWidth);
        setDockDrag(finalPoint);
      };
      const up = () => {
        cleanup();
        setDragWidth(void 0);
        setDockDrag(void 0);
        client.setLayout({ width: finalWidth, dock: finalPoint });
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    };
    const onTopEdgePointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const startY = event.clientY;
      const boxHeight = asideRef.current?.getBoundingClientRect().height ?? savedHeight ?? MIN_DOCK_HEIGHT;
      const bottom = Math.min(dockPoint.y + boxHeight, viewport.height - EDGE_GAP);
      const startTop = dockPoint.y;
      const maxTop = Math.max(EDGE_GAP, bottom - MIN_DOCK_HEIGHT);
      let finalHeight = bottom - startTop;
      let finalPoint = dockPoint;
      const move = (pointer) => {
        const nextTop = Math.round(clamp(startTop + pointer.clientY - startY, EDGE_GAP, maxTop));
        finalHeight = Math.round(bottom - nextTop);
        finalPoint = { x: dockPoint.x, y: nextTop };
        setDragHeight(finalHeight);
        setDockDrag(finalPoint);
      };
      const up = () => {
        cleanup();
        setDragHeight(void 0);
        setDockDrag(void 0);
        client.setLayout({ dockHeight: finalHeight, dock: finalPoint });
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    };
    const onBottomEdgePointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const startY = event.clientY;
      const startHeight = asideRef.current?.getBoundingClientRect().height ?? savedHeight ?? MIN_DOCK_HEIGHT;
      const maxHeight2 = Math.max(MIN_DOCK_HEIGHT, viewport.height - dockPoint.y - EDGE_GAP);
      let finalHeight = startHeight;
      const move = (pointer) => {
        finalHeight = Math.round(clamp(startHeight + pointer.clientY - startY, MIN_DOCK_HEIGHT, maxHeight2));
        setDragHeight(finalHeight);
      };
      const up = () => {
        cleanup();
        setDragHeight(void 0);
        client.setLayout({ dockHeight: finalHeight, dock: dockPoint });
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    };
    const renderNode = (node, path) => {
      if (node.kind === "leaf") {
        const view = snap.panels.find((panel) => panel.id === node.id);
        if (view === void 0) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          PanelCard,
          {
            view,
            client,
            theme,
            lang,
            t,
            now,
            fresh: snap.fresh === view.id,
            dragging: drag?.id === view.id,
            dropTarget: drag?.target === view.id,
            dropZone: drag?.target === view.id ? drag.zone : void 0,
            onAsk: (text, submit) => {
              ask(text, submit);
            },
            onExpand: () => setFocusedId(view.id),
            onDragStart: (event) => startCardDrag(view.id, event)
          },
          node.id
        );
      }
      const pathKey = path.join(".") || "root";
      if (node.dir === "col") {
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-split is-col", children: node.children.map((child, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-pane", children: renderNode(child, [...path, index]) }, `${pathKey}.${index}`)) }, pathKey);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-split is-row", style: { gridTemplateColumns: rowTemplate(node) }, children: node.children.map((child, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.Fragment, { children: [
        index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "div",
          {
            className: "dshpad-splitter",
            role: "separator",
            "aria-orientation": "vertical",
            title: t("dock.split"),
            onPointerDown: (event) => startSplit(path, index - 1, event)
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-pane", children: renderNode(child, [...path, index]) })
      ] }, `${pathKey}.${index}`)) }, pathKey);
    };
    if (!snap.layout.expanded) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-root", ref: rootRef, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "div",
          {
            id: "dshpad-ball",
            className: `dshpad-ball${ballDrag !== void 0 ? " is-dragging" : ""}`,
            style: { left: ballPoint.x, top: ballPoint.y },
            role: "button",
            tabIndex: 0,
            title: attention ? t("capsule.attention") : `${t("dock.open")} \xB7 ${t("dock.ballHint")}`,
            "aria-label": t("dock.open"),
            onPointerDown: onBallPointerDown,
            onKeyDown: onBallKey,
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BallDisc, {})
          }
        ),
        starAnchor,
        ballDrag !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-drag-shield", "aria-hidden": "true" }) : null
      ] });
    }
    const examples = ["empty.example1", "empty.example2", "empty.example3"];
    const dragView = drag === void 0 ? void 0 : snap.panels.find((panel) => panel.id === drag.id);
    const dropHint = drag === void 0 ? void 0 : drag.target !== void 0 && drag.zone !== void 0 ? t(DROP_LABEL[drag.zone]) : drag.blank ? t(DROP_LABEL.root) : t(DROP_LABEL.hint);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-root", ref: rootRef, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "aside",
        {
          ref: asideRef,
          className: `dshpad-dock${dockDrag !== void 0 ? " is-moving" : ""}${closing ? " is-closing" : ""}`,
          style: dockStyle,
          "aria-label": t("dock.title"),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "div",
              {
                className: "dshpad-dock-edge is-top",
                role: "separator",
                "aria-orientation": "horizontal",
                title: t("dock.resizeHeight"),
                onPointerDown: onTopEdgePointerDown,
                onDoubleClick: () => {
                  setDragHeight(void 0);
                  client.setDockHeight(void 0);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-resize", title: t("dock.resize"), onPointerDown: onResizePointerDown }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "dshpad-dock-head", title: t("dock.move"), onPointerDown: onHeadPointerDown, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshpad-grip", "aria-hidden": "true" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshpad-spacer" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: "dshpad-icon-btn",
                  title: t("dock.newPanel"),
                  "aria-label": t("dock.newPanel"),
                  onClick: () => {
                    ask(t("new.prefix"), false, true);
                  },
                  children: Icon2.plus
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: "dshpad-icon-btn",
                  title: t("dock.refreshAll"),
                  "aria-label": t("dock.refreshAll"),
                  disabled: snap.panels.length === 0,
                  onClick: () => {
                    for (const panel of snap.panels) void client.act({ op: "refresh", panelId: panel.id });
                  },
                  children: Icon2.refresh
                }
              ),
              update?.available === true ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: "dshpad-icon-btn dshpad-update-btn",
                  title: t("update.tooltip"),
                  "aria-label": t("update.tooltip"),
                  onClick: () => setUpdateOpen((open) => !open),
                  children: Icon2.download
                }
              ) : null,
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: "dshpad-collapse",
                  title: `${t("dock.collapse")} \xB7 ${t("dock.holdDrag")}`,
                  "aria-label": t("dock.collapse"),
                  onClick: onCollapseClick,
                  onPointerDown: onCollapsePointerDown,
                  onContextMenu: (event) => event.preventDefault(),
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { className: "dshpad-collapse-star", viewBox: "0 0 28 28", width: "28", height: "28", "aria-hidden": "true", focusable: "false", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: STAR_PATH }) })
                }
              )
            ] }),
            updateOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "dshpad-update", role: "dialog", "aria-label": t("update.title"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-update-head", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: update?.available ? t("update.available") : t("update.title") }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "dshpad-update-close",
                    title: t("common.close"),
                    "aria-label": t("common.close"),
                    onClick: () => setUpdateOpen(false),
                    children: Icon2.close
                  }
                )
              ] }),
              update === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text", children: t("update.unavailable") }) : update.applied !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text is-ok", children: t("update.applied", { version: update.applied }) }) : update.reason === "disabled" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text", children: t("update.disabled") }) : update.reason === "error" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text is-error", children: t("update.failed", { error: update.error ?? "" }) }) : update.available ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "dshpad-update-text", children: [
                  t("update.current", { current: update.current }),
                  update.latest === void 0 ? "" : ` \u2192 ${t("update.latest", { latest: update.latest })}`
                ] }),
                update.reason === "source" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text", children: t("update.source") }) : null
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text", children: t("update.upToDate", { version: update.current }) }),
              updateError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-update-text is-error", children: updateError }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-update-actions", children: [
                update?.available === true && update.canApply ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshpad-update-primary", disabled: updateBusy, onClick: () => void applyUpdate(), children: updateBusy ? t("update.applying") : t("update.apply") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshpad-update-secondary", disabled: updateBusy, onClick: () => void checkUpdate(true), children: updateBusy ? t("update.checking") : t("update.check") }),
                update?.url === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { className: "dshpad-update-link", href: update.url, target: "_blank", rel: "noreferrer", children: t("update.release") }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshpad-update-secondary", onClick: () => setUpdateOpen(false), children: t("update.later") })
              ] })
            ] }) : null,
            snap.loaded && !snap.connected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-banner", children: t("dock.offline") }) : null,
            notice ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-banner", children: notice }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-list", children: snap.loaded && snap.panels.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-empty", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-empty-title", children: t("empty.title") }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("empty.body") }),
              examples.map((key) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshpad-example", onClick: () => ask(t(key), false), children: t(key) }, key))
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-rows", children: [
              tree === null ? null : renderNode(tree, []),
              drag?.blank ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-root-drop", children: t(DROP_LABEL.root) }) : null
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "div",
              {
                className: "dshpad-dock-foot",
                role: "separator",
                "aria-orientation": "horizontal",
                title: t("dock.resizeHeight"),
                onPointerDown: onBottomEdgePointerDown,
                onDoubleClick: () => {
                  setDragHeight(void 0);
                  client.setDockHeight(void 0);
                }
              }
            )
          ]
        }
      ),
      ballTransition === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "div",
        {
          className: `dshpad-ball-transition is-${ballTransition.mode}`,
          style: { left: ballTransition.point.x, top: ballTransition.point.y },
          "aria-hidden": "true",
          children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BallDisc, {})
        }
      ),
      starAnchor,
      dockDrag !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-drag-shield", "aria-hidden": "true" }) : null,
      dragHeight !== void 0 && dockDrag === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-drag-shield", "aria-hidden": "true" }) : null,
      drag !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshpad-drag-shield", ref: shieldRef, "aria-hidden": "true" }) : null,
      drag !== void 0 && dragView !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-drag-ghost", style: { left: drag.x + 12, top: drag.y + 12 }, children: [
        dragView.definition.icon ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: dragView.definition.icon }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshpad-drag-name", children: dragView.definition.title }),
        dropHint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshpad-drag-hint", children: dropHint })
      ] }) : null,
      focusedView ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "div",
        {
          className: "dshpad-focus",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": focusedView.definition.title,
          onClick: (event) => {
            if (event.target === event.currentTarget) setFocusedId(void 0);
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshpad-focus-panel", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "dshpad-focus-head", children: [
              focusedView.definition.icon ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshpad-card-icon", children: focusedView.definition.icon }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshpad-focus-title", children: focusedView.definition.title }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: "dshpad-icon-btn",
                  "aria-label": t("card.close"),
                  title: t("card.close"),
                  onClick: () => setFocusedId(void 0),
                  children: Icon2.close
                }
              )
            ] }),
            awaitingFirstData(focusedView.definition, focusedView.data) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dshpad-card-note", children: t("card.firstData") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              PanelFrame,
              {
                view: focusedView,
                histories: () => client.historiesOf(focusedView.id),
                theme,
                lang,
                onRefresh: () => void client.act({ op: "refresh", panelId: focusedView.id }),
                onAsk: (text) => {
                  ask(text, false);
                },
                onRun: (prompt, system) => client.run(focusedView.id, prompt, system),
                onScriptError: () => {
                },
                resizeLabel: t("card.resize"),
                resizable: false
              }
            )
          ] })
        }
      ) : null
    ] });
  };
}

// src/client/locales.ts
var zh = {
  "dock.title": "\u9762\u677F",
  "dock.open": "\u5C55\u5F00\u9762\u677F",
  "dock.ballHint": "\u62D6\u5230\u5C4F\u5E55\u4EFB\u610F\u4F4D\u7F6E\uFF0C\u9760\u8FD1\u56DB\u8FB9\u4F1A\u81EA\u52A8\u5438\u9644",
  "dock.collapse": "\u6536\u8D77\u6210\u60AC\u6D6E\u7403",
  "dock.holdDrag": "\u957F\u6309\u62D6\u52A8\u9762\u677F",
  "dock.new": "\u7528 AI \u65B0\u5EFA\u9762\u677F",
  "dock.refreshAll": "\u5168\u90E8\u5237\u65B0",
  "dock.offline": "\u548C dsh \u7684\u8FDE\u63A5\u65AD\u5F00\u4E86\uFF0C\u6B63\u5728\u91CD\u8FDE\u2026",
  "dock.resize": "\u62D6\u52A8\u8C03\u6574\u5BBD\u5EA6",
  "dock.move": "\u62D6\u52A8\u7A97\u53E3\u5230\u4EFB\u610F\u4F4D\u7F6E",
  "dock.resizeHeight": "\u62D6\u52A8\u4E0A\u4E0B\u8FB9\u7F18\u8C03\u6574\u9AD8\u5EA6\uFF0C\u53CC\u51FB\u6062\u590D\u81EA\u52A8",
  "drop.left": "\u653E\u5230\u5DE6\u4FA7",
  "drop.right": "\u653E\u5230\u53F3\u4FA7",
  "drop.top": "\u653E\u5230\u4E0A\u65B9",
  "drop.bottom": "\u653E\u5230\u4E0B\u65B9",
  "drop.center": "\u4EA4\u6362\u4F4D\u7F6E",
  "drop.root": "\u79FB\u5230\u672B\u5C3E\uFF08\u6574\u884C\uFF09",
  "drop.hint": "\u62D6\u5230\u5361\u7247\u8FB9\u7F18\u53EF\u5206\u680F",
  "capsule.label": "\u9762\u677F {count}",
  "capsule.attention": "\u6709\u9762\u677F\u9700\u8981\u5904\u7406",
  "empty.title": "\u8FD8\u6CA1\u6709\u9762\u677F",
  "empty.body": "\u5728\u5BF9\u8BDD\u91CC\u544A\u8BC9 AI \u4F60\u60F3\u76EF\u7740\u4EC0\u4E48\uFF0C\u5B83\u4F1A\u505A\u6210\u4E00\u5F20\u9762\u677F\u653E\u5728\u8FD9\u91CC\u3002",
  "empty.example1": "\u505A\u4E00\u4E2A\u89C2\u5BDF\u8FD9\u53F0\u670D\u52A1\u5668\u6027\u80FD\u7684\u9762\u677F\uFF1ACPU\u3001\u5185\u5B58\u3001\u78C1\u76D8\u3001\u8D1F\u8F7D\uFF0C\u6BCF 3 \u79D2\u5237\u65B0",
  "empty.example2": "\u505A\u4E00\u4E2A\u9762\u677F\u663E\u793A\u6211\u7684 DeepSeek API \u8D26\u6237\u4F59\u989D",
  "empty.example3": "\u505A\u4E00\u4E2A\u9762\u677F\u76EF\u7740 deepseek-ai/deepseek-harness \u7684\u6700\u65B0 release \u548C star \u6570",
  "new.prefix": "\u7528 dsh-pad \u7684 pad_create \u521B\u5EFA\u4E00\u5F20\u81EA\u5B9A\u4E49\u60AC\u6D6E\u9762\u677F\uFF0C\u6309\u5DE5\u5177\u63CF\u8FF0\u91CC\u7684\u9762\u677F\u7F16\u5199\u6307\u5357\u6765\u505A\u3002\u9700\u6C42\uFF1A",
  "new.unavailable": "\u6CA1\u627E\u5230\u5BF9\u8BDD\u8F93\u5165\u6846\uFF0C\u5185\u5BB9\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\u3002",
  "new.filled": "\u5DF2\u586B\u5165\u8F93\u5165\u6846\uFF0C\u6309\u56DE\u8F66\u53D1\u7ED9 AI\u3002",
  "card.refresh": "\u5237\u65B0",
  "card.resize": "\u62D6\u52A8\u8C03\u6574\u9AD8\u5EA6\uFF0C\u53CC\u51FB\u6062\u590D\u81EA\u52A8",
  "card.fold": "\u6298\u53E0",
  "card.unfold": "\u5C55\u5F00",
  "card.more": "\u66F4\u591A\u64CD\u4F5C",
  "card.moveUp": "\u4E0A\u79FB",
  "card.moveDown": "\u4E0B\u79FB",
  "card.undo": "\u64A4\u9500\u4E0A\u6B21\u4FEE\u6539",
  "card.edit": "\u8BA9 AI \u4FEE\u6539\u2026",
  "card.expand": "\u653E\u5927\u67E5\u770B",
  "card.close": "\u5173\u95ED",
  "dock.newPanel": "\u521B\u5EFA\u4E00\u4E2A\u9762\u677F",
  "dock.split": "\u62D6\u52A8\u8C03\u6574\u6BD4\u4F8B",
  "dock.autoLayout": "\u81EA\u52A8\u6392\u5217\uFF08\u91CD\u7F6E\u5361\u7247\u4F4D\u7F6E\uFF09",
  "dock.columns": "\u5E03\u5C40\uFF1A{n} \u5217",
  "card.editPrompt": "\u4FEE\u6539\u60AC\u6D6E\u9762\u677F\u300C{title}\u300D\uFF08id: {id}\uFF09\uFF1A",
  "card.delete": "\u5220\u9664\u9762\u677F",
  "card.deleteAction": "\u5220\u9664",
  "card.deleteCannotUndo": "\u5220\u9664\u540E\u65E0\u6CD5\u6062\u590D\u3002",
  "card.model": "\u9762\u677F\u6A21\u578B",
  "card.drag": "\u62D6\u52A8\u5361\u7247\uFF08\u653E\u5230\u8FB9\u7F18\u5206\u680F\uFF0C\u653E\u5230\u4E2D\u95F4\u4EA4\u6362\uFF09",
  "card.resizeWidth": "\u62D6\u52A8\u8C03\u6574\u5361\u7247\u5BBD\u5EA6",
  "card.auto": "\u6062\u590D\u81EA\u52A8\u6392\u5217",
  "card.span": "\u5360\u51E0\u5217",
  "card.modelDefault": "\u8DDF\u968F\u9ED8\u8BA4",
  "card.modelFollowDefault": "\u5168\u5C40\u9ED8\u8BA4\u6A21\u578B",
  "card.modelLoading": "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u2026",
  "card.modelEmpty": "\u6CA1\u6709\u53EF\u7528\u7684\u6A21\u578B",
  "card.modelSwitchFailed": "\u5207\u6362\u6A21\u578B\u5931\u8D25",
  "card.modelLoadFailed": "\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u5931\u8D25\uFF1A{error}",
  "common.cancel": "\u53D6\u6D88",
  "common.close": "\u5173\u95ED",
  "card.deleteConfirm": "\u5220\u9664\u9762\u677F\u300C{title}\u300D\uFF1F",
  "card.updated": "{ago}\u66F4\u65B0",
  "card.waiting": "\u7B49\u5F85\u6570\u636E\u2026",
  "card.firstData": "\u6B63\u5728\u8BFB\u53D6\u6570\u636E\u2026",
  "card.agentEvery": "AI \u6BCF {every}\u5237\u65B0",
  "card.agentRunning": "AI \u6B63\u5728\u5237\u65B0\u2026",
  "card.agentFailed": "AI \u5237\u65B0\u5931\u8D25\uFF1A{error}",
  "card.agentNext": "\u4E0B\u6B21 {time}",
  "card.sourceError": "{id}\uFF1A{error}",
  "approve.title": "\u8FD9\u5F20\u9762\u677F\u8981\u5728\u672C\u673A\u8FD0\u884C\u4EE5\u4E0B\u6570\u636E\u6E90\uFF1A",
  "approve.allow": "\u5141\u8BB8\u8FD0\u884C",
  "approve.changed": "\u6570\u636E\u6E90\u5DF2\u7ECF\u53D8\u4E86\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4",
  "update.title": "\u66F4\u65B0",
  "update.tooltip": "\u68C0\u67E5\u66F4\u65B0",
  "update.checking": "\u6B63\u5728\u68C0\u67E5\u2026",
  "update.current": "\u5F53\u524D v{current}",
  "update.latest": "\u6700\u65B0 v{latest}",
  "update.available": "\u53D1\u73B0\u65B0\u7248\u672C",
  "update.apply": "\u66F4\u65B0",
  "update.release": "Release \u8BF4\u660E",
  "update.later": "\u7A0D\u540E",
  "update.check": "\u91CD\u65B0\u68C0\u67E5",
  "update.applying": "\u6B63\u5728\u66F4\u65B0\u2026",
  "update.upToDate": "\u5DF2\u662F\u6700\u65B0\u7248\u672C v{version}",
  "update.source": "\u8FD9\u662F\u5F00\u53D1\u76EE\u5F55\u5B89\u88C5\uFF0C\u81EA\u52A8\u66F4\u65B0\u4E0D\u4F1A\u8986\u76D6\u6E90\u7801\uFF1B\u8BF7\u5728\u63D2\u4EF6\u76EE\u5F55\u6267\u884C git pull && npm run build\u3002",
  "update.applied": "\u5DF2\u4E0B\u8F7D v{version}\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548\u3002",
  "update.failed": "\u68C0\u67E5\u66F4\u65B0\u5931\u8D25\uFF1A{error}",
  "update.applyFailed": "\u66F4\u65B0\u5931\u8D25\uFF1A{error}",
  "update.disabled": "\u81EA\u52A8\u68C0\u67E5\u66F4\u65B0\u5DF2\u5173\u95ED\uFF08updateCheck: false\uFF09",
  "update.unavailable": "\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u66F4\u65B0\u4FE1\u606F",
  "time.justNow": "\u521A\u521A",
  "time.seconds": "{n} \u79D2\u524D",
  "time.minutes": "{n} \u5206\u949F\u524D",
  "time.hours": "{n} \u5C0F\u65F6\u524D",
  "time.days": "{n} \u5929\u524D",
  "every.minutes": "{n} \u5206\u949F",
  "every.hours": "{n} \u5C0F\u65F6",
  "every.days": "{n} \u5929"
};
var en = {
  "dock.title": "Panels",
  "dock.open": "Open panels",
  "dock.ballHint": "Drag anywhere; it snaps to the nearest screen edge",
  "dock.collapse": "Collapse to floating ball",
  "dock.holdDrag": "Hold to drag the window",
  "dock.new": "New panel with AI",
  "dock.refreshAll": "Refresh all",
  "dock.offline": "Lost connection to dsh, reconnecting\u2026",
  "dock.resize": "Drag to resize",
  "dock.move": "Drag the window anywhere",
  "dock.resizeHeight": "Drag the top or bottom edge to resize, double-click for auto",
  "drop.left": "Split left",
  "drop.right": "Split right",
  "drop.top": "Split above",
  "drop.bottom": "Split below",
  "drop.center": "Swap places",
  "drop.root": "Move to the bottom",
  "drop.hint": "Drop on a card edge to split",
  "capsule.label": "Panels {count}",
  "capsule.attention": "A panel needs attention",
  "empty.title": "No panels yet",
  "empty.body": "Tell the AI what you want to keep an eye on and it will build a panel here.",
  "empty.example1": "Make a panel watching this server: CPU, memory, disk and load, refreshing every 3 seconds",
  "empty.example2": "Make a panel showing my DeepSeek API balance",
  "empty.example3": "Make a panel tracking the latest release and stars of deepseek-ai/deepseek-harness",
  "new.prefix": "Create a custom floating panel with dsh-pad (pad_create; follow the panel authoring guide in its description). Requirements: ",
  "new.unavailable": "No composer found. The text was copied to the clipboard.",
  "new.filled": "Put into the composer. Press Enter to send it to the AI.",
  "card.refresh": "Refresh",
  "card.resize": "Drag to resize, double-click for auto",
  "card.fold": "Fold",
  "card.unfold": "Unfold",
  "card.more": "More actions",
  "card.moveUp": "Move up",
  "card.moveDown": "Move down",
  "card.undo": "Undo last change",
  "card.edit": "Ask AI to change\u2026",
  "card.expand": "Expand",
  "card.close": "Close",
  "dock.newPanel": "Create a panel",
  "dock.split": "Drag to resize columns",
  "dock.autoLayout": "Auto arrange (reset card positions)",
  "dock.columns": "Layout: {n} columns",
  "card.editPrompt": 'Change the floating panel "{title}" (id: {id}): ',
  "card.delete": "Delete panel",
  "card.deleteAction": "Delete",
  "card.deleteCannotUndo": "This cannot be undone.",
  "card.model": "Panel model",
  "card.drag": "Drag card (edge to split, centre to swap)",
  "card.resizeWidth": "Drag to resize card width",
  "card.auto": "Return to auto layout",
  "card.span": "Columns",
  "card.modelDefault": "Follow default",
  "card.modelFollowDefault": "Global default",
  "card.modelLoading": "Loading models\u2026",
  "card.modelEmpty": "No models available",
  "card.modelSwitchFailed": "Could not switch model",
  "card.modelLoadFailed": "Could not load models: {error}",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "card.deleteConfirm": 'Delete panel "{title}"?',
  "card.updated": "Updated {ago}",
  "card.waiting": "Waiting for data\u2026",
  "card.firstData": "Reading data\u2026",
  "card.agentEvery": "AI refreshes every {every}",
  "card.agentRunning": "AI is refreshing\u2026",
  "card.agentFailed": "AI refresh failed: {error}",
  "card.agentNext": "next {time}",
  "card.sourceError": "{id}: {error}",
  "approve.title": "This panel wants to run these data sources on this machine:",
  "approve.allow": "Allow",
  "approve.changed": "The data sources changed, please review again",
  "update.title": "Update",
  "update.tooltip": "Check for updates",
  "update.checking": "Checking\u2026",
  "update.current": "Current v{current}",
  "update.latest": "Latest v{latest}",
  "update.available": "Update available",
  "update.apply": "Update",
  "update.release": "Release notes",
  "update.later": "Later",
  "update.check": "Check again",
  "update.applying": "Updating\u2026",
  "update.upToDate": "Up to date (v{version})",
  "update.source": "This is a source checkout; auto-update never overwrites it. Run git pull && npm run build in the plugin directory.",
  "update.applied": "Downloaded v{version}. Restart dsh to apply.",
  "update.failed": "Update check failed: {error}",
  "update.applyFailed": "Update failed: {error}",
  "update.disabled": "Update checks are off (updateCheck: false)",
  "update.unavailable": "No update information yet",
  "time.justNow": "just now",
  "time.seconds": "{n}s ago",
  "time.minutes": "{n}m ago",
  "time.hours": "{n}h ago",
  "time.days": "{n}d ago",
  "every.minutes": "{n} min",
  "every.hours": "{n} h",
  "every.days": "{n} d"
};

// src/client/styles.ts
var DOCK_CSS = `
.dshpad-root{position:fixed;top:0;right:0;width:0;height:0;z-index:9000;
  --dshpad-fg:var(--dsw-alias-label-primary,#1f2329);
  --dshpad-fg-2:var(--dsw-alias-label-secondary,#545a63);
  --dshpad-fg-3:var(--dsw-alias-label-tertiary,#8a9099);
  --dshpad-surface:var(--dsw-alias-bg-layer-1,#fff);
  --dshpad-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  --dshpad-border:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  --dshpad-accent:var(--dsw-alias-brand-primary,#4d6bfe);
  --dshpad-danger:var(--dsw-alias-state-error-primary,#e5484d);
  --dshpad-warn:var(--dsw-alias-state-warn-primary,#d97706);
  --dshpad-ball-hi:color-mix(in srgb,var(--dshpad-surface) 90%,var(--dshpad-fg) 10%);
  --dshpad-ease:cubic-bezier(.22,.8,.24,1);
  color:var(--dshpad-fg)}
.dshpad-root svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dshpad-root circle{fill:currentColor;stroke:none}
.dshpad-root button{font:inherit;color:inherit}

.dshpad-root #dshpad-ball{position:fixed!important;display:grid;place-items:center;width:28px!important;height:28px!important;padding:0!important;border:0!important;border-radius:0!important;background:none!important;box-shadow:none!important;clip-path:none!important;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;overflow:visible!important;
  opacity:1!important;pointer-events:auto!important}
.dshpad-root .dshpad-ball-disc{display:block;width:28px!important;height:28px!important;overflow:visible;filter:drop-shadow(0 5px 14px rgba(0,0,0,.24))}
.dshpad-root .dshpad-ball-disc .dshpad-ball-fill{fill:url(#dshpad-ball-surface)!important;fill-opacity:1;stroke:var(--dsw-alias-border-l1,var(--dshpad-border))!important;stroke-width:1!important;transition:stroke .15s}
.dshpad-root .dshpad-ball-disc .dshpad-ball-stop-a{stop-color:var(--dshpad-ball-hi)!important}
.dshpad-root .dshpad-ball-disc .dshpad-ball-stop-b{stop-color:var(--dshpad-surface)!important}
.dshpad-root #dshpad-ball:active,.dshpad-root #dshpad-ball.is-dragging{cursor:grabbing}
.dshpad-root #dshpad-ball:focus-visible{outline:none}
.dshpad-root #dshpad-ball:focus-visible .dshpad-ball-fill{stroke:var(--dshpad-fg)!important;stroke-width:2!important}

/* One visible star for both states: it stays exactly where the ball / the
   header button is, while the surface around it cross-fades. */
.dshpad-root .dshpad-star-anchor{position:fixed;display:grid;place-items:center;width:28px;height:28px;pointer-events:none!important;z-index:3;color:var(--dshpad-fg-2)}
.dshpad-root .dshpad-star-anchor *{pointer-events:none!important}
.dshpad-root .dshpad-star-anchor svg{display:block;width:28px!important;height:28px!important;overflow:visible}
.dshpad-root .dshpad-star-anchor path{fill:currentColor!important;stroke:none!important}
.dshpad-root:has(#dshpad-ball:hover) .dshpad-star-anchor,
.dshpad-root:has(.dshpad-collapse:hover) .dshpad-star-anchor{color:var(--dshpad-fg)}
.dshpad-root .dshpad-ball-transition{position:fixed;display:grid;place-items:center;width:28px;height:28px;pointer-events:none;z-index:2}
.dshpad-root .dshpad-ball-transition.is-opening{animation:dshpad-ball-out .2s var(--dshpad-ease) forwards}

.dshpad-collapse{position:absolute!important;top:2px!important;right:9px!important;display:grid;place-items:center;width:28px!important;height:28px!important;min-width:0!important;min-height:0!important;padding:0!important;border:0!important;border-radius:9px!important;box-sizing:border-box!important;cursor:pointer;touch-action:none;user-select:none;pointer-events:auto!important;
  background:transparent!important;color:var(--dshpad-fg-2)!important;transition:background-color .18s}
.dshpad-collapse:hover{background:var(--dshpad-hover)!important}
.dshpad-collapse svg{display:block;width:28px!important;height:28px!important}
.dshpad-collapse-star{visibility:hidden}

.dshpad-dock{position:fixed;left:8px;top:52px;max-height:calc(100vh - 16px);max-width:calc(100vw - 16px);pointer-events:auto;display:flex;flex-direction:column;
  background:color-mix(in srgb, var(--dshpad-surface) 70%, transparent);border:0;border-radius:var(--dsw-radius-xl,16px);box-shadow:var(--dsw-elevation-panel,0 8px 28px rgba(0,0,0,.14));
  -webkit-backdrop-filter:blur(26px) saturate(1.45);backdrop-filter:blur(26px) saturate(1.45);
  font-size:13px;line-height:18px;animation:dshpad-dock-in .18s var(--dshpad-ease)}
.dshpad-dock.is-closing{animation:dshpad-dock-out .16s var(--dshpad-ease) forwards;pointer-events:none}
.dshpad-dock.is-closing .dshpad-collapse{pointer-events:none!important}
.dshpad-resize{position:absolute;left:-3px;top:16px;bottom:16px;width:7px;cursor:ew-resize;touch-action:none;z-index:2}
.dshpad-resize::after{content:"";position:absolute;left:3px;top:50%;width:2px;height:36px;margin-top:-18px;border-radius:1px;background:var(--dshpad-border);opacity:0;transition:opacity .15s}
.dshpad-resize:hover::after,.dshpad-resize:active::after{opacity:1}

.dshpad-dock-head{display:flex;align-items:center;gap:2px;height:32px;padding:0 42px 0 4px;flex:none;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.dshpad-dock.is-moving .dshpad-dock-head{cursor:grabbing}
.dshpad-grip{flex:none;width:10px;height:14px;margin-right:2px;color:var(--dshpad-fg-3);opacity:.5;
  background-image:radial-gradient(circle,currentColor 1px,transparent 1.2px);background-size:5px 5px;background-position:0 2px;transition:opacity .15s}
.dshpad-dock-head:hover .dshpad-grip{opacity:.9}
.dshpad-dock-edge{position:absolute;left:4px;right:102px;height:6px;z-index:3;cursor:ns-resize;touch-action:none}
.dshpad-dock-edge.is-top{top:0}
.dshpad-dock-edge::after{content:"";position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;border-radius:1px;background:var(--dshpad-border);opacity:0;transition:opacity .15s}
.dshpad-dock-edge:hover::after{opacity:.9}
.dshpad-dock-foot{flex:none;height:14px;display:grid;place-items:center;cursor:ns-resize;touch-action:none;user-select:none}
.dshpad-dock-foot::after{content:"";width:36px;height:3px;border-radius:2px;background:var(--dshpad-border);opacity:.75;transition:opacity .15s,background-color .15s}
.dshpad-dock-foot:hover::after{opacity:1;background:var(--dshpad-fg-3)}
.dshpad-spacer{flex:1}

.dshpad-icon-btn{flex:none;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dshpad-fg-2)!important;cursor:pointer;transition:background-color .15s,color .15s}
.dshpad-icon-btn:hover:not(:disabled),.dshpad-icon-btn.is-active{background:var(--dshpad-hover);color:var(--dshpad-fg)!important}
.dshpad-icon-btn:disabled{opacity:.4;cursor:default}
.dshpad-update{flex:none;margin:0 6px 5px;padding:8px 9px;border-radius:11px;background:color-mix(in srgb, var(--dshpad-surface) 55%, transparent);
  box-shadow:inset 0 0 0 .5px var(--dshpad-border);font-size:12px}
.dshpad-update-head{display:flex;align-items:center;justify-content:space-between;gap:6px}
.dshpad-update-close{display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dshpad-fg-3);cursor:pointer}
.dshpad-update-close:hover{background:var(--dshpad-hover);color:var(--dshpad-fg)}
.dshpad-update-text{margin:5px 0 0;color:var(--dshpad-fg-2);line-height:1.45}
.dshpad-update-text.is-error{color:var(--dshpad-danger)}
.dshpad-update-text.is-ok{color:var(--dsw-alias-state-success-primary,#16a34a)}
.dshpad-update-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px}
.dshpad-update-primary{padding:4px 10px;border:0;border-radius:7px;background:var(--dshpad-accent);color:#fff;font-size:12px;cursor:pointer}
.dshpad-update-primary:disabled{opacity:.55;cursor:default}
.dshpad-update-secondary{padding:3px 8px;border:0;border-radius:7px;background:transparent;color:var(--dshpad-fg-2);font-size:12px;cursor:pointer}
.dshpad-update-secondary:hover{background:var(--dshpad-hover);color:var(--dshpad-fg)}
.dshpad-update-link{color:var(--dshpad-accent);text-decoration:none;font-size:12px}
.dshpad-update-link:hover{text-decoration:underline}
.dshpad-root :focus-visible{outline:2px solid var(--dshpad-accent);outline-offset:1px}

.dshpad-banner{margin:0 6px 4px;padding:4px 5px;border-radius:8px;background:var(--dsw-alias-state-warn-tertiary,rgba(217,119,6,.1));color:var(--dsw-alias-state-warn-label,var(--dshpad-fg));font-size:12px;flex:none}

.dshpad-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:1px 5px 6px;position:relative}
.dshpad-rows{display:flex;flex-direction:column;gap:4px;min-width:0}
.dshpad-split{min-width:0;min-height:0}
.dshpad-split.is-row{display:grid;align-items:stretch}
.dshpad-split.is-col{display:flex;flex-direction:column;gap:4px}
.dshpad-pane{display:flex;flex-direction:column;min-width:0;min-height:0}
.dshpad-pane>.dshpad-card{width:100%}
.dshpad-root-drop{display:grid;place-items:center;min-height:58px;margin-top:2px;border:1.5px dashed color-mix(in srgb,var(--dshpad-accent) 55%, transparent);border-radius:12px;background:color-mix(in srgb,var(--dshpad-accent) 8%, transparent);color:var(--dshpad-accent);font-size:12px;pointer-events:none}
.dshpad-splitter{position:relative;min-height:24px;cursor:col-resize;touch-action:none;z-index:1;border-radius:3px;background:transparent}
.dshpad-splitter::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;transform:translateX(-50%);border-radius:1px;background:var(--dshpad-fg-3);opacity:.42;transition:background-color .15s,opacity .15s}
.dshpad-splitter:hover::before,.dshpad-splitter:active::before{background:var(--dshpad-fg-3);opacity:.68}

.dshpad-card{position:relative;min-width:0;border-radius:12px;background:color-mix(in srgb, var(--dsw-alias-settings-card-fill, transparent) 55%, transparent);box-shadow:inset 0 0 0 .5px var(--dsw-alias-settings-card-stroke,var(--dshpad-border));animation:dshpad-fade .24s ease-out}
.dshpad-card.is-dragging{opacity:.45}
.dshpad-card.is-drop-target{box-shadow:inset 0 0 0 2px var(--dshpad-accent),0 8px 24px rgba(0,0,0,.12)}
.dshpad-card.is-drop-left::after,.dshpad-card.is-drop-right::after,.dshpad-card.is-drop-top::after,.dshpad-card.is-drop-bottom::after,.dshpad-card.is-drop-center::after{content:"";position:absolute;z-index:3;pointer-events:none;border-radius:12px;background:color-mix(in srgb,var(--dshpad-accent) 14%, transparent)}
.dshpad-card.is-drop-left::after{inset:0 52% 0 0;border-right:2px solid var(--dshpad-accent);border-radius:12px 0 0 12px}
.dshpad-card.is-drop-right::after{inset:0 0 0 52%;border-left:2px solid var(--dshpad-accent);border-radius:0 12px 12px 0}
.dshpad-card.is-drop-top::after{inset:0 0 52% 0;border-bottom:2px solid var(--dshpad-accent);border-radius:12px 12px 0 0}
.dshpad-card.is-drop-bottom::after{inset:52% 0 0 0;border-top:2px solid var(--dshpad-accent);border-radius:0 0 12px 12px}
.dshpad-card.is-drop-center::after{inset:0;background:color-mix(in srgb,var(--dshpad-accent) 9%, transparent);box-shadow:inset 0 0 0 2px var(--dshpad-accent)}
.dshpad-card.is-fresh{animation:dshpad-flash 2.4s ease-out}
.dshpad-card-head{display:flex;align-items:center;gap:2px;height:38px;padding:0 3px;cursor:grab;touch-action:none}
.dshpad-card-head button{cursor:pointer}
.dshpad-card-grip{flex:none;display:grid;place-items:center;width:14px;height:28px;color:var(--dshpad-fg-3);opacity:.55;cursor:grab;touch-action:none;border-radius:5px}
.dshpad-card-grip:hover{opacity:1;background:var(--dshpad-hover)}
.dshpad-card-grip:active{cursor:grabbing}
.dshpad-card-grip svg{width:12px;height:12px;fill:currentColor;stroke:none}
.dshpad-card-title{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;height:28px;padding:0 4px;border:0;border-radius:8px;background:none;cursor:pointer;text-align:left;font-weight:600}
.dshpad-card-title:hover{background:var(--dshpad-hover)}
.dshpad-card-chevron{display:grid;color:var(--dshpad-fg-3);transition:transform .2s var(--dshpad-ease)}
.dshpad-card-chevron svg{width:12px;height:12px}
.dshpad-card.is-folded .dshpad-card-chevron{transform:rotate(-90deg)}
.dshpad-card-icon{flex:none;font-size:14px;line-height:1}
.dshpad-card-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshpad-card-meta{flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dshpad-fg-3);font-size:11px;font-variant-numeric:tabular-nums}
.dshpad-card-meta.is-alert{color:var(--dshpad-warn)}
.dshpad-card-actions{position:relative;flex:none;display:flex}
.dshpad-more{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dshpad-fg-2)!important;cursor:pointer;transition:background-color .15s,color .15s}
.dshpad-more:hover{background:transparent;color:var(--dshpad-fg)!important}
.dshpad-more svg{width:14px;height:14px}
.dshpad-card-body{padding:0 6px 5px}
.dshpad-drag-shield{position:fixed;inset:0;z-index:99990;cursor:grabbing;background:transparent;touch-action:none;user-select:none}
.dshpad-drag-ghost{position:fixed;z-index:99999;display:flex;align-items:center;gap:6px;max-width:280px;padding:6px 9px;border-radius:9px;  background:color-mix(in srgb, var(--dsw-alias-button-floating-fill,var(--dshpad-surface)) 88%, transparent);
  -webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);
  box-shadow:var(--dsw-elevation-panel,0 6px 20px rgba(0,0,0,.16));color:var(--dshpad-fg);
  font-size:12px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.dshpad-drag-name{overflow:hidden;text-overflow:ellipsis}
.dshpad-drag-hint{flex:none;padding-left:6px;border-left:.5px solid var(--dshpad-border);color:var(--dshpad-fg-3);font-size:11px}
.dshpad-card-note{margin:3px 0 0;color:var(--dshpad-fg-3);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.dshpad-card-note.is-alert{color:var(--dshpad-danger)}

.dshpad-confirm{margin:0 6px 5px;padding:6px 7px;border-radius:9px;background:var(--dsw-alias-state-error-tertiary,rgba(229,72,77,.1));box-shadow:inset 0 0 0 .5px rgba(229,72,77,.32);animation:dshpad-pop .14s ease-out}
.dshpad-confirm p{margin:0}
.dshpad-confirm-text{font-size:12px;line-height:16px;color:var(--dshpad-fg);overflow-wrap:anywhere}
.dshpad-confirm-hint{margin-top:2px;color:var(--dshpad-fg-3);font-size:11px;line-height:15px}
.dshpad-confirm-actions{display:flex;justify-content:flex-end;gap:4px;margin-top:6px}
.dshpad-confirm-actions button{height:24px;padding:0 9px;border:0;border-radius:7px;font-family:inherit;font-size:12px;cursor:pointer;transition:background-color .15s,filter .15s}
.dshpad-confirm-cancel{background:transparent;color:var(--dshpad-fg-2)!important}
.dshpad-confirm-cancel:hover{background:var(--dshpad-hover);color:var(--dshpad-fg)!important}
.dshpad-confirm-delete{background:var(--dshpad-danger,#e5484d);color:#fff!important;font-weight:500}
.dshpad-confirm-delete:hover{filter:brightness(1.08)}

.dshpad-menu-value{margin-left:auto;max-width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dshpad-fg-3);font-size:11px}
.dshpad-models{margin:0 6px 5px;padding:6px 7px;border-radius:9px;background:var(--dshpad-hover);box-shadow:inset 0 0 0 .5px var(--dshpad-border);animation:dshpad-pop .14s ease-out}
.dshpad-models-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;font-size:12px;font-weight:600}
.dshpad-models-close{display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dshpad-fg-3)!important;font-size:16px;line-height:1;cursor:pointer}
.dshpad-models-close:hover{background:var(--dshpad-hover);color:var(--dshpad-fg)!important}
.dshpad-models-list{display:flex;flex-direction:column;gap:1px;max-height:220px;overflow-y:auto;scrollbar-gutter:stable}
.dshpad-model-group{margin-top:4px}
.dshpad-model-provider{margin:2px 5px;color:var(--dshpad-fg-3);font-size:10px;letter-spacing:.03em}
.dshpad-model-row{display:flex;align-items:center;gap:6px;width:100%;padding:5px 6px;border:0;border-radius:7px;background:none;text-align:left;font-size:12px;cursor:pointer}
.dshpad-model-row:hover:not(:disabled){background:var(--dshpad-hover)}
.dshpad-model-row.is-current{background:var(--dsw-alias-interactive-bg-active,var(--dshpad-hover))}
.dshpad-model-row:disabled{opacity:.5;cursor:default}
.dshpad-model-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshpad-model-meta{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dshpad-fg-3);font-size:10px}
.dshpad-model-check{flex:none;color:var(--dshpad-accent);font-size:11px}
.dshpad-models-hint{margin:4px;color:var(--dshpad-fg-3);font-size:11px}
.dshpad-models-error{margin:4px;color:var(--dshpad-danger);font-size:11px}

.dshpad-frame{display:block;width:100%;border:0;background:transparent;transition:height .2s var(--dshpad-ease)}
.dshpad-frame.is-resizing{transition:none}
.dshpad-frame-handle{height:10px;margin-top:2px;display:flex;align-items:center;justify-content:center;cursor:ns-resize;touch-action:none}
.dshpad-frame-handle::after{content:"";width:28px;height:3px;border-radius:2px;background:var(--dshpad-border);opacity:.7;transition:opacity .15s,background-color .15s}
.dshpad-frame-handle:hover::after{opacity:1;background:var(--dshpad-fg-3)}

.dshpad-menu{position:absolute;left:0;top:28px;z-index:10;min-width:176px;padding:6px;display:flex;flex-direction:column;gap:1px;border-radius:12px;
  background:color-mix(in srgb, var(--dsw-alias-settings-card-fill,var(--dshpad-surface)) 86%, transparent);-webkit-backdrop-filter:blur(18px) saturate(1.15);backdrop-filter:blur(18px) saturate(1.15);border:.5px solid var(--dshpad-border);
  box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.18));animation:dshpad-pop .14s ease-out}
.dshpad-menu button{display:flex;align-items:center;gap:9px;width:100%;padding:7px 9px;border:0;border-radius:8px;background:none;text-align:left;font-size:13px;color:inherit;cursor:pointer}
.dshpad-menu button:hover:not(:disabled){background:var(--dshpad-hover)}
.dshpad-menu button:disabled{opacity:.4;cursor:default}
.dshpad-menu button.is-danger{color:var(--dshpad-danger)!important}
.dshpad-menu hr{margin:4px;border:0;border-top:.5px solid var(--dshpad-border)}
.dshpad-mi{display:grid;place-items:center;flex:none;width:16px;height:16px;color:var(--dshpad-fg-2)}
.dshpad-mi svg{width:15px;height:15px}
.dshpad-menu button.is-danger .dshpad-mi{color:inherit}

.dshpad-focus{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.42);animation:dshpad-fade .18s ease-out}
.dshpad-focus-panel{display:flex;flex-direction:column;width:min(640px,92vw);padding:8px 14px 12px;border-radius:16px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,var(--dshpad-surface)) 82%, transparent);-webkit-backdrop-filter:blur(40px) saturate(1.2);backdrop-filter:blur(40px) saturate(1.2);border:.5px solid var(--dshpad-border);box-shadow:var(--dsw-elevation-prominent,0 24px 60px rgba(0,0,0,.35))}
.dshpad-focus-head{display:flex;align-items:center;gap:8px;height:40px;flex:none}
.dshpad-focus-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}

.dshpad-approve{margin:0 0 5px;padding:5px 6px;border-radius:10px;background:var(--dsw-alias-state-warn-tertiary,rgba(217,119,6,.1));font-size:12px}
.dshpad-approve p{margin:0 0 3px}
.dshpad-approve ul{margin:0 0 5px;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}
.dshpad-approve code{display:block;max-height:76px;overflow:auto;padding:2px 4px;border-radius:6px;background:var(--dshpad-hover);font:11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;white-space:pre-wrap}
.dshpad-primary{height:28px;padding:0 12px;border:0;border-radius:8px;background:var(--dshpad-accent,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)!important;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);font-size:12px;font-weight:500;cursor:pointer}
.dshpad-primary:hover{filter:brightness(1.06)}

.dshpad-empty{padding:14px 5px 4px;color:var(--dshpad-fg-2);font-size:12px;text-align:center}
.dshpad-empty p{margin:0 0 6px}
.dshpad-empty .dshpad-empty-title{margin-bottom:2px;color:var(--dshpad-fg);font-size:14px;font-weight:600}
.dshpad-example{display:block;width:100%;margin:3px 0 0;padding:4px 6px;border:0;border-radius:10px;background:var(--dshpad-hover);text-align:left;font-size:12px;line-height:17px;cursor:pointer;transition:background-color .15s}
.dshpad-example:hover{background:var(--dsw-alias-interactive-bg-active,var(--dshpad-hover))}

/* Wide windows: the expanded dock reserves its own column. Padding the frame
   pushes the conversation and the (optional) right panel left, so the dock sits
   in the gap and covers neither \u2014 the panel no longer disappears under it. */
@media (min-width:1280px){
  html.dshpad-reserve [data-titlebar-density]{padding-right:var(--dshpad-reserve,0px)}
  /* The right panel's drag handle is positioned from viewport pixels, so pull it
     back onto the panel's edge while the dock holds that column. */
  html.dshpad-reserve [data-titlebar-density] [data-side=rightbar]{transform:translateX(calc(var(--dshpad-reserve,0px) * -1))}
  /* dsh hides the turn rail (the jump-to-turn column on the conversation's right
     edge) below a 900px conversation. While the dock has reserved its column the
     rail still sits in the conversation margin, left of the dock, so keep it as
     soon as there is room for it \u2014 opening the dock must not take it away. */
  @container (width >= 800px){
    html.dshpad-reserve [class*="_slot"]>nav[class*="_frame"]{display:block}
  }
}
[data-titlebar-density]{transition:padding-right .26s cubic-bezier(.22,.8,.24,1)}

@keyframes dshpad-dock-in{from{opacity:0}to{opacity:1}}
@keyframes dshpad-dock-out{to{opacity:0}}
@keyframes dshpad-ball-out{to{opacity:0}}
@keyframes dshpad-pop{from{opacity:0;scale:.96}to{opacity:1;scale:1}}
@keyframes dshpad-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes dshpad-flash{0%,30%{box-shadow:inset 0 0 0 1.5px var(--dshpad-accent)}100%{box-shadow:inset 0 0 0 .5px var(--dsw-alias-settings-card-stroke,var(--dshpad-border))}}
@media (prefers-reduced-motion:reduce){
  .dshpad-root *{animation-duration:1ms!important;transition-duration:1ms!important}
}
`;

// src/client/index.ts
var NS = "dsh-pad";
var inject = ["slots", "locale"];
function ComposerBridge({ inputActions }) {
  (0, import_react4.useEffect)(() => composer.attach(inputActions), [inputActions]);
  return null;
}
var DockBoundary = class extends import_react4.Component {
  state = {};
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    const error = this.state.error;
    if (error === void 0) return this.props.children;
    return (0, import_react4.createElement)("div", {
      style: {
        position: "fixed",
        right: "12px",
        top: "64px",
        zIndex: 99999,
        maxWidth: "min(420px,80vw)",
        padding: "10px 12px",
        borderRadius: "12px",
        background: "#b00020",
        color: "#fff",
        font: "12px/18px ui-monospace,Consolas,monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      }
    }, `\u9762\u677F\u575E\u6E32\u67D3\u5931\u8D25\uFF1A${error.message}`);
  }
};
function apply(ctx) {
  try {
    start(ctx);
  } catch (error) {
    console.error("[dsh-pad] \u9762\u677F\u575E\u542F\u52A8\u5931\u8D25\uFF0C\u5DF2\u7981\u7528\u3002\u5728\u63D2\u4EF6\u76EE\u5F55\u8FD0\u884C `node scripts/doctor.mjs` \u81EA\u68C0\uFF1A", error);
  }
}
function start(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-pad: dictionaries");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset["plugin"] = NS;
    style.textContent = DOCK_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, "dsh-pad: styles");
  const client = new PadClient();
  ctx.effect(() => {
    client.start();
    return () => client.stop();
  }, "dsh-pad: stream");
  const Dock = createDock(client);
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "dsh-pad",
    order: 50,
    locale: NS
  }, (props) => (0, import_react4.createElement)(DockBoundary, null, (0, import_react4.createElement)(Dock, { t: props.t }))));
  ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
    name: "conversation.input.overlay",
    id: "dsh-pad.composer-bridge",
    order: 1e3
  }, (props) => (0, import_react4.createElement)(ComposerBridge, { inputActions: props.inputActions })));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
