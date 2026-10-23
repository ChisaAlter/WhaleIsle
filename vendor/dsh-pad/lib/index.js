// src/index.ts
import { homedir } from "node:os";
import { dirname as dirname4, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";

// src/host/agent-refresh.ts
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
var CHECK_EVERY_MS = 3e4;
var MAX_DATA_BYTES = 256 * 1024;
var AgentRefresher = class {
  constructor(ctx, store, options, dataChanged) {
    this.ctx = ctx;
    this.store = store;
    this.options = options;
    this.dataChanged = dataChanged;
  }
  ctx;
  store;
  options;
  dataChanged;
  queue = [];
  /** Panel id → generation of the run that owns it. */
  running = /* @__PURE__ */ new Map();
  /** In-flight agent handles, so stop() can cancel real work. */
  active = /* @__PURE__ */ new Map();
  timer;
  generation = 0;
  stopped = true;
  start() {
    if (this.timer !== void 0) return;
    this.stopped = false;
    this.generation += 1;
    for (const panel of this.store.list()) {
      if (panel.agentRun?.status === "running") {
        void this.store.setAgentRun(panel.id, { ...panel.agentRun, status: "failed", error: "\u4E0A\u6B21\u5237\u65B0\u88AB\u4E2D\u65AD" }).catch(() => {
        });
      }
    }
    this.timer = setInterval(() => this.scan(), CHECK_EVERY_MS);
    this.scan();
  }
  stop() {
    this.stopped = true;
    this.generation += 1;
    if (this.timer !== void 0) {
      clearInterval(this.timer);
      this.timer = void 0;
    }
    this.queue.length = 0;
    const active = [...this.active.values()];
    this.active.clear();
    this.running.clear();
    for (const entry of active) {
      try {
        entry.cancel();
      } catch {
      }
    }
  }
  /** Ask for a refresh now (user pressed refresh, or the model called pad_refresh). */
  request(panelId) {
    if (this.stopped) return;
    if (this.running.has(panelId) || this.queue.includes(panelId)) return;
    this.queue.push(panelId);
    this.pump();
  }
  isBusy(panelId) {
    return this.running.has(panelId) || this.queue.includes(panelId);
  }
  scan() {
    if (this.stopped) return;
    const now = Date.now();
    for (const panel of this.store.list()) {
      const next = panel.agentRun?.nextRunAt;
      if (panel.definition.agent && next !== void 0 && Date.parse(next) <= now) this.request(panel.id);
    }
  }
  pump() {
    if (this.stopped) return;
    const generation = this.generation;
    while (this.running.size < this.options.concurrency && this.queue.length > 0) {
      const panelId = this.queue.shift();
      if (this.running.has(panelId)) continue;
      const panel = this.store.find(panelId);
      if (panel?.definition.agent == null) continue;
      this.running.set(panelId, generation);
      void this.run(panel, generation).catch(() => {
      }).finally(() => {
        if (this.running.get(panelId) === generation) this.running.delete(panelId);
        if (!this.stopped && this.generation === generation) this.pump();
      });
    }
  }
  async run(panel, generation) {
    if (this.stopped || generation !== this.generation) return;
    const agentDef = panel.definition.agent;
    if (agentDef === void 0) return;
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    try {
      await this.store.setAgentRun(panel.id, { ...panel.agentRun, status: "running", lastRunAt: startedAt });
    } catch {
      return;
    }
    if (this.stopped || generation !== this.generation) return;
    let outcome;
    const panelId = panel.id;
    const store = this.store;
    const currentRun = () => !this.stopped && generation === this.generation;
    const submit = defineTool({
      name: "pad_submit_data",
      description: "\u63D0\u4EA4\u8FD9\u6B21\u5237\u65B0\u53D6\u5230\u7684\u9762\u677F\u6570\u636E\uFF08\u5B8C\u6574 JSON\uFF0C\u7ED3\u6784\u4E0E\u4E0A\u4E00\u6B21\u4E00\u81F4\uFF09\u3002\u6BCF\u6B21\u5237\u65B0\u53EA\u8C03\u7528\u4E00\u6B21\u3002",
      parameters: {
        data: { type: "json", required: true, description: "\u9762\u677F\u6570\u636E\uFF0CJSON \u503C\uFF1B\u9762\u677F\u811A\u672C\u8BFB dsh.data.agent.value" }
      },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute(args) {
        if (!currentRun()) throw new Error("\u5237\u65B0\u5DF2\u505C\u6B62");
        const data = args.data;
        if (JSON.stringify(data).length > MAX_DATA_BYTES) throw new Error(`\u6570\u636E\u8D85\u8FC7 ${MAX_DATA_BYTES / 1024}KB\uFF0C\u53EA\u4FDD\u7559\u9762\u677F\u8981\u663E\u793A\u7684\u5B57\u6BB5`);
        await store.setAgentData(panelId, data);
        outcome = { ok: true };
        return "\u5DF2\u63D0\u4EA4\uFF0C\u9762\u677F\u5DF2\u66F4\u65B0\u3002\u4E0D\u9700\u8981\u518D\u505A\u522B\u7684\u3002";
      }
    });
    const fail = defineTool({
      name: "pad_report_failure",
      description: "\u53D6\u4E0D\u5230\u771F\u5B9E\u6570\u636E\u65F6\u8C03\u7528\uFF0C\u7528\u4E00\u53E5\u8BDD\u8BF4\u660E\u539F\u56E0\uFF08\u4F1A\u663E\u793A\u5728\u9762\u677F\u4E0A\uFF09\u3002",
      parameters: { reason: { type: "string", required: true, description: "\u539F\u56E0\uFF0C\u4E00\u53E5\u5927\u767D\u8BDD" } },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute(args) {
        if (!currentRun()) throw new Error("\u5237\u65B0\u5DF2\u505C\u6B62");
        outcome = { ok: false, reason: args.reason.slice(0, 300) };
        return "\u5DF2\u8BB0\u5F55\u3002";
      }
    });
    let handle;
    try {
      const agents = this.ctx.get("agents");
      if (agents === void 0) throw new Error("\u8FD9\u4E2A dsh \u7EC4\u5408\u6CA1\u6709 agent \u670D\u52A1");
      await mkdir(this.options.workDir, { recursive: true });
      const explicit = panel.definition.model;
      const fallback = this.ctx.get("agentDefaultModel")?.currentSelection();
      const selection = explicit ?? fallback;
      const modelOptions = selection === void 0 ? {} : {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort }
      };
      const presets = this.ctx.get("agentPresets");
      const preset = presets === void 0 ? void 0 : await presets.resolve();
      handle = await agents.create({
        sessionId: `dsh-pad-${panel.id}-${randomUUID().slice(0, 8)}`,
        meta: { cwd: this.options.workDir, ...preset === void 0 ? {} : { agentPreset: preset.id } },
        ...selection === void 0 ? {} : { agentOptions: modelOptions },
        setup: async (agentCtx) => {
          if (presets !== void 0 && preset !== void 0) await presets.mount(agentCtx, preset.id);
          agentCtx.tools.register(submit);
          agentCtx.tools.register(fail);
        }
      });
      if (this.stopped || generation !== this.generation) return;
      this.active.set(panel.id, {
        generation,
        cancel: () => {
          try {
            handle?.agent.cancel({ kind: "hook", reason: "dsh-pad refresh stopped" });
          } catch {
          }
        }
      });
      const agent = handle.agent;
      agent.followup(createUserMessage({
        content: [{ type: "text", text: refreshPrompt(panel) }],
        source: { kind: "dsh-pad", panelId: panel.id }
      }));
      let timer;
      const timedOut = await Promise.race([
        agent.whenIdle().then(() => false),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(true), this.options.timeoutMs);
        })
      ]);
      clearTimeout(timer);
      if (timedOut) {
        agent.cancel({ kind: "hook", reason: "dsh-pad refresh timeout" });
        outcome ??= { ok: false, reason: `\u5237\u65B0\u8D85\u65F6\uFF08${Math.round(this.options.timeoutMs / 1e3)} \u79D2\uFF09` };
      }
    } catch (error) {
      outcome ??= { ok: false, reason: `\u5237\u65B0\u51FA\u9519\uFF1A${error instanceof Error ? error.message : String(error)}` };
    } finally {
      if (this.active.get(panel.id)?.generation === generation) this.active.delete(panel.id);
      await handle?.dispose().catch(() => {
      });
    }
    if (this.stopped || generation !== this.generation) return;
    const finished = Date.now();
    const current = this.store.find(panel.id);
    const currentAgent = current?.definition.agent;
    if (current === void 0 || currentAgent == null) return;
    const every = currentAgent.everyMinutes * 6e4;
    try {
      if (outcome?.ok) {
        await this.store.setAgentRun(panel.id, { status: "idle", lastRunAt: startedAt, nextRunAt: new Date(finished + every).toISOString() });
        try {
          this.dataChanged(panel.id);
        } catch {
        }
      } else {
        const retry = Math.min(every, this.options.retryMinutes * 6e4);
        await this.store.setAgentRun(panel.id, {
          status: "failed",
          lastRunAt: startedAt,
          nextRunAt: new Date(finished + retry).toISOString(),
          error: outcome?.reason ?? "\u8FD9\u4E00\u8F6E\u6CA1\u6709\u63D0\u4EA4\u6570\u636E"
        });
      }
    } catch {
    }
  }
};
function refreshPrompt(panel) {
  const previous = panel.agentData === void 0 ? "\uFF08\u8FD8\u6CA1\u6709\u6570\u636E\uFF09" : JSON.stringify(panel.agentData.value, null, 2).slice(0, 8e3);
  return [
    `\u4F60\u6B63\u5728\u540E\u53F0\u5237\u65B0\u60AC\u6D6E\u9762\u677F\u300C${panel.definition.title}\u300D\u7684\u6570\u636E\u3002\u8FD9\u4E0D\u662F\u548C\u7528\u6237\u5BF9\u8BDD\uFF0C\u6CA1\u6709\u4EBA\u4F1A\u770B\u5230\u4F60\u7684\u56DE\u590D\u3002`,
    "",
    "\u5237\u65B0\u8BF4\u660E\uFF1A",
    panel.definition.agent.instruction,
    "",
    "\u4E0A\u4E00\u6B21\u63D0\u4EA4\u7684\u6570\u636E\uFF08\u65B0\u6570\u636E\u5FC5\u987B\u4FDD\u6301\u540C\u6837\u7684\u7ED3\u6784\u548C\u5B57\u6BB5\u540D\uFF0C\u9762\u677F\u811A\u672C\u6309\u5B83\u6E32\u67D3\uFF09\uFF1A",
    "```json",
    previous,
    "```",
    "",
    "\u7528\u4F60\u7684\u5DE5\u5177\u53D6\u6700\u65B0\u7684\u771F\u5B9E\u6570\u636E\uFF0C\u7136\u540E\u8C03\u7528 pad_submit_data \u63D0\u4EA4\u4E00\u6B21\u5B8C\u6574\u6570\u636E\u3002",
    "\u53D6\u4E0D\u5230\u5C31\u8C03\u7528 pad_report_failure \u8BF4\u660E\u539F\u56E0\u3002\u7EDD\u4E0D\u7F16\u9020\u6570\u5B57\u3002\u5B8C\u6210\u540E\u76F4\u63A5\u7ED3\u675F\uFF0C\u4E0D\u8981\u8F93\u51FA\u603B\u7ED3\u3002"
  ].join("\n");
}

// src/host/sources.ts
import { spawn } from "node:child_process";
var MAX_OUTPUT_BYTES = 512 * 1024;
var DEFAULT_TIMEOUT_MS = 1e4;
var SECRET_REF = /\{\{\s*env:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
function parseOutput(raw, parse) {
  if (parse === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`\u8F93\u51FA\u4E0D\u662F\u5408\u6CD5 JSON\uFF08\u5F00\u5934\uFF1A${raw.slice(0, 120)}\uFF09`);
    }
  }
  if (parse === "lines") return raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  return raw.replace(/\s+$/, "");
}
async function fillSecrets(text, resolve, used) {
  const names = [...new Set([...text.matchAll(SECRET_REF)].map((match) => match[1]))];
  const values = /* @__PURE__ */ new Map();
  for (const name2 of names) {
    const value = await resolve(name2);
    if (value === void 0 || value === "") throw new Error(`\u5BC6\u94A5 ${name2} \u6CA1\u6709\u914D\u7F6E\uFF1A\u8BF7\u5728 dsh \u7684\u51ED\u636E\u8BBE\u7F6E\u6216\u73AF\u5883\u53D8\u91CF\u91CC\u8BBE\u7F6E ${name2}`);
    values.set(name2, value);
    used.add(value);
  }
  return text.replace(SECRET_REF, (_match, name2) => values.get(name2));
}
function redact(message, secrets) {
  let out = message;
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join("***");
  return out;
}
function killCommandTree(child) {
  if (child.pid === void 0) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => {
        try {
          child.kill();
        } catch {
        }
      });
    } catch {
      try {
        child.kill();
      } catch {
      }
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }
}
function runCommand(command, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const kill = () => {
      if (child.exitCode === null) killCommandTree(child);
    };
    const timer = setTimeout(() => {
      kill();
      finish(new Error(`\u547D\u4EE4\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09`));
    }, timeoutMs);
    const onAbort = () => {
      kill();
      finish(new Error("\u5DF2\u53D6\u6D88"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        kill();
        finish(new Error(`\u8F93\u51FA\u8D85\u8FC7 ${MAX_OUTPUT_BYTES / 1024}KB\uFF0C\u8BF7\u7528 head / grep / jq \u7B49\u5148\u7B5B\u4E00\u4E0B`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.concat(stderr).length < 8192) stderr.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      if (code === 0) {
        finish(void 0, out);
        return;
      }
      const err = Buffer.concat(stderr).toString("utf8").trim();
      finish(new Error(`\u547D\u4EE4\u9000\u51FA\u7801 ${code ?? "null"}${err ? `\uFF1A${err.slice(-500)}` : ""}`));
    });
  });
}
async function runHttp(source, timeoutMs, resolve, used, signal) {
  const url = await fillSecrets(source.url, resolve, used);
  const headers = {};
  for (const [key, value] of Object.entries(source.headers ?? {})) headers[key] = await fillSecrets(value, resolve, used);
  const body = source.body === void 0 ? void 0 : await fillSecrets(source.body, resolve, used);
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    method: source.method ?? "GET",
    headers: { "user-agent": "dsh-pad", ...headers },
    ...body === void 0 ? {} : { body },
    redirect: "follow",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_OUTPUT_BYTES) {
        await reader.cancel();
        throw new Error(`\u54CD\u5E94\u8D85\u8FC7 ${MAX_OUTPUT_BYTES / 1024}KB`);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `\uFF1A${text.slice(0, 300)}` : ""}`);
  return text;
}
async function runSource(source, resolve, signal) {
  const started = Date.now();
  const timeoutMs = source.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const used = /* @__PURE__ */ new Set();
  try {
    const raw = source.kind === "command" ? await runCommand(source.command, timeoutMs, signal) : await runHttp(source, timeoutMs, resolve, used, signal);
    return { ok: true, value: parseOutput(raw, source.parse), at: (/* @__PURE__ */ new Date()).toISOString(), durationMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.name === "TimeoutError" ? `\u8BF7\u6C42\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` : error.message : String(error);
    return { ok: false, error: redact(message, used), at: (/* @__PURE__ */ new Date()).toISOString(), durationMs: Date.now() - started };
  }
}

// src/host/store.ts
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
function clampSpan(value) {
  return value === 2 || value === 3 ? value : 1;
}
function sourcesFingerprint(sources) {
  if (sources.length === 0) return "";
  const canonical = sources.map((source) => source.kind === "command" ? ["command", source.id, source.command, source.parse, source.intervalSec, source.timeoutMs ?? null] : [
    "http",
    source.id,
    source.method ?? "GET",
    source.url,
    Object.entries(source.headers ?? {}).sort(),
    source.body ?? null,
    source.parse,
    source.intervalSec,
    source.timeoutMs ?? null
  ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24);
}
var PanelNotFoundError = class extends Error {
  constructor(panelId) {
    super(`\u6CA1\u6709 id \u4E3A\u300C${panelId}\u300D\u7684\u9762\u677F\uFF0C\u5148\u7528 pad_list \u67E5\u770B\u73B0\u6709\u9762\u677F`);
    this.panelId = panelId;
    this.name = "PanelNotFoundError";
  }
  panelId;
};
var PanelStore = class {
  constructor(file, autoApprove) {
    this.file = file;
    this.autoApprove = autoApprove;
  }
  file;
  autoApprove;
  panels = [];
  writing = Promise.resolve();
  listeners = /* @__PURE__ */ new Set();
  /** Load the file; a missing file is an empty store, a corrupt one is kept aside. */
  async load() {
    let text;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      this.panels = [...parsed.panels].sort((a, b) => a.position - b.position).map((panel) => ({ ...panel, span: clampSpan(panel.span) }));
    } catch {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      this.panels = [];
    }
  }
  /** @returns a listener disposer; listeners run after every committed change. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  list() {
    return this.panels;
  }
  get(id) {
    const panel = this.panels.find((p) => p.id === id);
    if (panel === void 0) throw new PanelNotFoundError(id);
    return panel;
  }
  find(id) {
    return this.panels.find((p) => p.id === id);
  }
  /** Whether the panel's current sources may run. */
  approved(panel) {
    const fingerprint = sourcesFingerprint(panel.definition.sources);
    return fingerprint === "" || panel.approvedSources === fingerprint;
  }
  async create(definition, data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const panel = {
      id: `p_${randomUUID2().slice(0, 8)}`,
      version: 1,
      position: this.panels.length === 0 ? 0 : Math.max(...this.panels.map((p) => p.position)) + 1,
      collapsed: false,
      span: 1,
      createdAt: now,
      updatedAt: now,
      definition,
      ...this.autoApprove ? { approvedSources: sourcesFingerprint(definition.sources) } : {},
      ...data === void 0 ? {} : { agentData: { value: data, at: now } },
      ...definition.agent ? { agentRun: { status: "idle", nextRunAt: nextRun(definition, now) } } : {}
    };
    await this.commit([...this.panels, panel]);
    return panel;
  }
  async update(id, definition, data) {
    const current = this.get(id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const scheduleChanged = JSON.stringify(current.definition.agent ?? null) !== JSON.stringify(definition.agent ?? null);
    const next = {
      ...current,
      version: current.version + 1,
      updatedAt: now,
      definition,
      previous: current.definition,
      ...this.autoApprove ? { approvedSources: sourcesFingerprint(definition.sources) } : {},
      ...data === void 0 ? {} : { agentData: { value: data, at: now } },
      ...scheduleChanged ? { agentRun: definition.agent ? { status: "idle", nextRunAt: nextRun(definition, now) } : void 0 } : {}
    };
    await this.replace(next);
    return next;
  }
  async undo(id) {
    const current = this.get(id);
    if (current.previous === void 0) throw new Error("\u8FD9\u4E2A\u9762\u677F\u6CA1\u6709\u53EF\u4EE5\u64A4\u9500\u7684\u4FEE\u6539");
    const { previous: _dropped, ...rest } = current;
    const previous = current.previous;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const scheduleChanged = JSON.stringify(current.definition.agent ?? null) !== JSON.stringify(previous.agent ?? null);
    const next = {
      ...rest,
      version: current.version + 1,
      updatedAt: now,
      definition: previous,
      ...scheduleChanged ? { agentRun: previous.agent ? { status: "idle", nextRunAt: nextRun(previous, now) } : void 0 } : {}
    };
    await this.replace(next);
    return next;
  }
  async remove(id) {
    this.get(id);
    await this.commit(this.panels.filter((p) => p.id !== id));
  }
  async approve(id, fingerprint) {
    const current = this.get(id);
    if (sourcesFingerprint(current.definition.sources) !== fingerprint) return false;
    await this.replace({ ...current, approvedSources: fingerprint });
    return true;
  }
  async setCollapsed(id, collapsed) {
    await this.replace({ ...this.get(id), collapsed });
  }
  /** Set how many grid columns one card wants. */
  async setSpan(id, span) {
    await this.replace({ ...this.get(id), span: clampSpan(span) });
  }
  async move(id, delta) {
    const ordered = [...this.panels];
    const index = ordered.findIndex((p) => p.id === id);
    if (index < 0) throw new PanelNotFoundError(id);
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    await this.commit(ordered.map((p, position) => ({ ...p, position })));
  }
  async setAgentData(id, value) {
    await this.replace({ ...this.get(id), agentData: { value, at: (/* @__PURE__ */ new Date()).toISOString() } });
  }
  /**
   * Set or clear one panel's model. The panel version stays put: this is a
   * routing choice, not an edit that should reload the frame. The model is
   * used by the AI refresh and by one-off `dsh.run` calls from the panel.
   * @param id - panel id.
   * @param model - provider/model to use, or null to follow the default.
   */
  async setModel(id, model) {
    const current = this.get(id);
    const definition = { ...current.definition };
    if (model === null) delete definition.model;
    else definition.model = model;
    await this.replace({ ...current, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), definition });
  }
  async setAgentRun(id, run) {
    const current = this.find(id);
    if (current !== void 0) await this.replace({ ...current, agentRun: run });
  }
  async replace(next) {
    await this.commit(this.panels.map((p) => p.id === next.id ? next : p));
  }
  async commit(panels) {
    this.panels = panels.sort((a, b) => a.position - b.position);
    const snapshot = { version: 1, panels: this.panels };
    const write = this.writing.then(async () => {
      await mkdir2(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}
`, "utf8");
      await rename(temp, this.file);
    });
    this.writing = write.catch(() => {
    });
    await write;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
      }
    }
  }
};
function nextRun(definition, from) {
  if (!definition.agent) return void 0;
  return new Date(Date.parse(from) + definition.agent.everyMinutes * 6e4).toISOString();
}

// src/host/hub.ts
var DataHub = class {
  constructor(store, resolveSecret, onAgentRefresh, options = {}) {
    this.store = store;
    this.resolveSecret = resolveSecret;
    this.onAgentRefresh = onAgentRefresh;
    this.cache = options.cache;
    for (const [panelId, sources] of options.restored ?? []) this.readings.set(panelId, new Map(sources));
  }
  store;
  resolveSecret;
  onAgentRefresh;
  readings = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  subscribers = /* @__PURE__ */ new Set();
  cache;
  disposed = false;
  /** Re-sync after a store change: push the panel list, restart changed timers. */
  storeChanged() {
    const ids = new Set(this.store.list().map((p) => p.id));
    for (const id of [...this.readings.keys()]) {
      if (ids.has(id)) continue;
      this.readings.delete(id);
      this.cache?.forgetPanel(id);
    }
    this.cache?.prune(this.store.list());
    this.broadcast({ type: "panels", panels: this.views() });
    this.reconcile();
  }
  subscribe(subscriber) {
    this.subscribers.add(subscriber);
    subscriber.send({ type: "panels", panels: this.views(true) });
    this.reconcile();
    return () => {
      this.subscribers.delete(subscriber);
      this.reconcile();
    };
  }
  /** Change what a subscriber watches (e.g. a card was folded). */
  rewatch(subscriber, watch) {
    subscriber.watch = watch;
    this.reconcile();
  }
  /**
   * Run a panel's sources now and, for agent panels, ask for an agent refresh.
   * @param panelId - the panel to refresh.
   */
  refresh(panelId) {
    const panel = this.store.get(panelId);
    if (panel.definition.agent) this.onAgentRefresh(panelId);
    if (!this.store.approved(panel)) return;
    for (const source of panel.definition.sources) void this.runNow(panel, source.id);
  }
  /** Send fresh data for one panel (after agent data changed). */
  pushData(panelId) {
    const panel = this.store.find(panelId);
    if (panel !== void 0) this.broadcastData(panel);
  }
  /**
   * One view per panel.
   * @param withHistory - include the cached trend; only a page's first list needs it.
   */
  views(withHistory = false) {
    return this.store.list().map((panel) => this.view(panel, withHistory));
  }
  dispose() {
    this.disposed = true;
    for (const sources of this.timers.values()) for (const t of sources.values()) clearTimeout(t.timer);
    this.timers.clear();
    this.subscribers.clear();
  }
  view(panel, withHistory) {
    return {
      id: panel.id,
      version: panel.version,
      position: panel.position,
      collapsed: panel.collapsed,
      span: panel.span,
      updatedAt: panel.updatedAt,
      definition: panel.definition,
      canUndo: panel.previous !== void 0,
      needsApproval: !this.store.approved(panel),
      fingerprint: sourcesFingerprint(panel.definition.sources),
      agentRun: panel.agentRun ?? null,
      data: this.data(panel),
      history: withHistory ? this.history(panel) : {}
    };
  }
  /** Cached points of the panel's declared sources, so a fresh page starts with a trend. */
  history(panel) {
    const cached = this.cache?.history(panel.id) ?? {};
    const history = {};
    for (const source of panel.definition.sources) {
      const points = cached[source.id];
      if (points !== void 0 && points.length > 0) history[source.id] = points;
    }
    return history;
  }
  data(panel) {
    const readings = this.readings.get(panel.id);
    const sources = {};
    for (const source of panel.definition.sources) {
      const reading = readings?.get(source.id);
      if (reading !== void 0) sources[source.id] = reading;
    }
    return { sources, agent: panel.agentData ?? null };
  }
  watched() {
    const ids = /* @__PURE__ */ new Set();
    for (const subscriber of this.subscribers) for (const id of subscriber.watch) ids.add(id);
    return ids;
  }
  /** Start timers for watched, approved sources; stop everything else. */
  reconcile() {
    if (this.disposed) return;
    const watched = this.watched();
    const live = /* @__PURE__ */ new Map();
    for (const panel of this.store.list()) {
      if (!watched.has(panel.id) || !this.store.approved(panel)) continue;
      const keep = /* @__PURE__ */ new Set();
      live.set(panel.id, keep);
      let timers = this.timers.get(panel.id);
      if (timers === void 0) {
        timers = /* @__PURE__ */ new Map();
        this.timers.set(panel.id, timers);
      }
      for (const source of panel.definition.sources) {
        const key = sourcesFingerprint([source]);
        keep.add(source.id);
        const existing = timers.get(source.id);
        if (existing?.key === key) continue;
        if (existing !== void 0) clearTimeout(existing.timer);
        const entry = { key, timer: void 0, running: false };
        timers.set(source.id, entry);
        const last = existing === void 0 ? this.readings.get(panel.id)?.get(source.id) : void 0;
        const age = last === void 0 ? Infinity : Date.now() - Date.parse(last.at);
        const wait = Math.max(0, source.intervalSec * 1e3 - age);
        entry.timer = setTimeout(() => void this.tick(panel.id, source.id), wait);
      }
    }
    for (const [panelId, timers] of this.timers) {
      const keep = live.get(panelId);
      for (const [sourceId, entry] of timers) {
        if (keep?.has(sourceId)) continue;
        clearTimeout(entry.timer);
        timers.delete(sourceId);
      }
      if (timers.size === 0) this.timers.delete(panelId);
    }
  }
  async tick(panelId, sourceId) {
    const entry = this.timers.get(panelId)?.get(sourceId);
    const panel = this.store.find(panelId);
    const source = panel?.definition.sources.find((s) => s.id === sourceId);
    if (entry === void 0 || panel === void 0 || source === void 0) return;
    await this.runNow(panel, sourceId);
    if (this.timers.get(panelId)?.get(sourceId) === entry && !this.disposed) {
      entry.timer = setTimeout(() => void this.tick(panelId, sourceId), source.intervalSec * 1e3);
    }
  }
  /**
   * Run every source of a panel once, record and broadcast the readings.
   * @param panelId - the panel.
   * @returns one reading per source (a source already running reports its last reading).
   */
  async runAll(panelId) {
    const panel = this.store.get(panelId);
    return await Promise.all(panel.definition.sources.map(async (source) => {
      const reading = await this.runNow(panel, source.id);
      return { id: source.id, ...reading ?? { ok: false, error: "\u6B63\u5728\u8FD0\u884C\u4E2D", at: (/* @__PURE__ */ new Date()).toISOString() } };
    }));
  }
  async runNow(panel, sourceId) {
    const source = panel.definition.sources.find((s) => s.id === sourceId);
    if (source === void 0) return void 0;
    const entry = this.timers.get(panel.id)?.get(sourceId);
    if (entry?.running) return this.readings.get(panel.id)?.get(sourceId);
    if (entry) entry.running = true;
    try {
      const reading = await runSource(source, this.resolveSecret);
      const key = sourcesFingerprint([source]);
      const current = this.store.find(panel.id);
      const still = current?.definition.sources.find((s) => s.id === sourceId);
      if (current === void 0 || still === void 0 || sourcesFingerprint([still]) !== key) {
        this.cache?.forgetSource(panel.id, sourceId);
        return reading;
      }
      let readings = this.readings.get(panel.id);
      if (readings === void 0) {
        readings = /* @__PURE__ */ new Map();
        this.readings.set(panel.id, readings);
      }
      readings.set(sourceId, reading);
      this.cache?.remember(panel.id, sourceId, key, reading);
      this.broadcastData(current);
      return reading;
    } finally {
      if (entry) entry.running = false;
    }
  }
  broadcastData(panel) {
    const event = { type: "data", panelId: panel.id, data: this.data(panel) };
    for (const subscriber of this.subscribers) if (subscriber.watch.has(panel.id)) subscriber.send(event);
  }
  broadcast(event) {
    for (const subscriber of this.subscribers) subscriber.send(event);
  }
};

// src/host/readings.ts
import { mkdir as mkdir3, readFile as readFile2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
var MAX_CACHED_VALUE_CHARS = 16384;
var HISTORY_POINTS = 20;
var MAX_CACHED_HISTORY_CHARS = 128 * 1024;
var DEFAULT_FLUSH_MS = 1e4;
function toReading(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const record = raw;
  const { ok, value, error, at, durationMs } = record;
  if (ok !== true || typeof at !== "string" || Number.isNaN(Date.parse(at))) return void 0;
  if (value === void 0) return void 0;
  return {
    ok: true,
    value,
    at,
    ...typeof durationMs === "number" && Number.isFinite(durationMs) ? { durationMs } : {},
    ...typeof error === "string" ? { error } : {}
  };
}
function valueSize(value) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function nextRing(previous, key, reading) {
  const points = previous?.key === key ? [...previous.points] : [];
  const last = points[points.length - 1];
  if (last !== void 0 && last.at === reading.at) points[points.length - 1] = reading;
  else points.push(reading);
  while (points.length > HISTORY_POINTS) points.shift();
  while (points.length > 1 && valueSize(points) > MAX_CACHED_HISTORY_CHARS) points.shift();
  return { key, points };
}
var ReadingCache = class {
  /**
   * @param file - cache file path, usually next to `panels.json`.
   * @param flushMs - coalescing window for writes.
   */
  constructor(file, flushMs = DEFAULT_FLUSH_MS) {
    this.file = file;
    this.flushMs = flushMs;
  }
  file;
  flushMs;
  panels = /* @__PURE__ */ new Map();
  timer;
  dirty = false;
  disposed = false;
  writing = Promise.resolve();
  /**
   * Read the cache back for the panels that are still declared.
   * @param panels - panels loaded from the store.
   * @returns the newest reading per panel id and source id, ready to seed a `DataHub`.
   */
  async load(panels) {
    const newest = /* @__PURE__ */ new Map();
    let text;
    try {
      text = await readFile2(this.file, "utf8");
    } catch {
      return newest;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return newest;
    }
    if (parsed === null || typeof parsed !== "object" || typeof parsed.panels !== "object" || parsed.panels === null) return newest;
    for (const panel of panels) {
      const entries = parsed.panels[panel.id];
      if (typeof entries !== "object" || entries === null) continue;
      for (const source of panel.definition.sources) {
        const entry = entries[source.id];
        if (typeof entry !== "object" || entry === null) continue;
        const { key, points, reading } = entry;
        if (typeof key !== "string" || key !== sourcesFingerprint([source])) continue;
        const raw = Array.isArray(points) ? points : reading === void 0 ? [] : [reading];
        const ring = raw.map(toReading).filter((point) => point !== void 0 && valueSize(point.value) <= MAX_CACHED_VALUE_CHARS).slice(-HISTORY_POINTS);
        if (ring.length === 0) continue;
        let cached = this.panels.get(panel.id);
        if (cached === void 0) {
          cached = /* @__PURE__ */ new Map();
          this.panels.set(panel.id, cached);
        }
        cached.set(source.id, { key, points: ring });
        let sources = newest.get(panel.id);
        if (sources === void 0) {
          sources = /* @__PURE__ */ new Map();
          newest.set(panel.id, sources);
        }
        sources.set(source.id, ring[ring.length - 1]);
      }
    }
    return newest;
  }
  /** Cache one successful reading; failed and oversized readings are ignored. */
  remember(panelId, sourceId, key, reading) {
    if (this.disposed || !reading.ok || reading.value === void 0) return;
    if (valueSize(reading.value) > MAX_CACHED_VALUE_CHARS) return;
    let sources = this.panels.get(panelId);
    if (sources === void 0) {
      sources = /* @__PURE__ */ new Map();
      this.panels.set(panelId, sources);
    }
    sources.set(sourceId, nextRing(sources.get(sourceId), key, reading));
    this.schedule();
  }
  /**
   * Recent points of every cached source of one panel, oldest first.
   * @param panelId - the panel.
   * @returns points per source id; empty when nothing is cached.
   */
  history(panelId) {
    const sources = this.panels.get(panelId);
    if (sources === void 0) return {};
    const history = {};
    for (const [sourceId, entry] of sources) {
      history[sourceId] = entry.points.map((point) => ({ value: point.value, at: point.at }));
    }
    return history;
  }
  /** Drop one source's readings (its definition changed). */
  forgetSource(panelId, sourceId) {
    if (this.panels.get(panelId)?.delete(sourceId) === true) this.schedule();
  }
  /** Drop a deleted panel. */
  forgetPanel(panelId) {
    if (this.panels.delete(panelId)) this.schedule();
  }
  /** Drop entries whose panel, source or source definition no longer exists. */
  prune(panels) {
    const current = new Map(panels.map((panel) => [panel.id, panel]));
    let changed = false;
    for (const [panelId, sources] of this.panels) {
      const panel = current.get(panelId);
      if (panel === void 0) {
        this.panels.delete(panelId);
        changed = true;
        continue;
      }
      const keys = new Map(panel.definition.sources.map((source) => [source.id, sourcesFingerprint([source])]));
      for (const [sourceId, entry] of sources) {
        if (keys.get(sourceId) === entry.key) continue;
        sources.delete(sourceId);
        changed = true;
      }
      if (sources.size === 0) {
        this.panels.delete(panelId);
        changed = true;
      }
    }
    if (changed) this.schedule();
  }
  /** Write now if anything changed; concurrent calls share one write. */
  async flush() {
    if (!this.dirty) return await this.writing;
    this.dirty = false;
    const snapshot = JSON.stringify(this.serializable());
    const write = this.writing.then(async () => {
      await mkdir3(dirname2(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile2(temp, `${snapshot}
`, "utf8");
      await rename2(temp, this.file);
    });
    this.writing = write.catch(() => {
    });
    await write;
  }
  /** Stop the timer and make one last best-effort write. */
  dispose() {
    this.disposed = true;
    if (this.timer !== void 0) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
    void this.flush().catch(() => {
    });
  }
  serializable() {
    const panels = {};
    for (const [panelId, sources] of this.panels) {
      const entries = {};
      for (const [sourceId, entry] of sources) entries[sourceId] = { key: entry.key, points: entry.points };
      panels[panelId] = entries;
    }
    return { version: 2, panels };
  }
  schedule() {
    this.dirty = true;
    if (this.timer !== void 0 || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.flush().catch(() => {
      });
    }, this.flushMs);
    this.timer.unref?.();
  }
};

// src/shared/types.ts
var ROUTES = {
  panels: "/api/dsh-pad.panels",
  stream: "/api/dsh-pad.stream",
  action: "/api/dsh-pad.action",
  models: "/api/dsh-pad.models",
  run: "/api/dsh-pad.run",
  update: "/api/dsh-pad.update"
};

// src/host/models.ts
function llmOf(ctx) {
  return ctx.get("llm");
}
function defaultOf(ctx) {
  const selection = ctx.get("agentDefaultModel")?.currentSelection();
  if (selection === void 0) return null;
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort }
  };
}
async function modelCatalog(ctx) {
  const fallback = defaultOf(ctx);
  const llm = llmOf(ctx);
  if (llm === void 0) return { default: fallback, providers: [] };
  const providers = await Promise.all(llm.listProviders().map(async (provider) => {
    try {
      const models = await llm.listModels(provider.id);
      const options = await Promise.all(models.map(async (model) => {
        let reasoning;
        try {
          reasoning = (await llm.resolveModelInfo(provider.id, model.id)).reasoning;
        } catch {
        }
        return {
          id: model.id,
          name: model.name,
          ...model.description === void 0 ? {} : { description: model.description },
          ...reasoning === void 0 || reasoning.efforts.length === 0 ? {} : {
            reasoningEfforts: reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name })),
            ...reasoning.defaultEffort === void 0 ? {} : { defaultReasoningEffort: reasoning.defaultEffort }
          }
        };
      }));
      return options.length === 0 ? void 0 : { id: provider.id, name: provider.name, models: options };
    } catch {
      return void 0;
    }
  }));
  return {
    default: fallback,
    providers: providers.filter((provider) => provider !== void 0)
  };
}
async function assertModel(ctx, selection) {
  const llm = llmOf(ctx);
  if (llm === void 0) throw new Error("\u8FD9\u4E2A dsh \u7EC4\u5408\u6CA1\u6709 llm \u670D\u52A1\uFF0C\u4E0D\u80FD\u6307\u5B9A\u9762\u677F\u6A21\u578B");
  const providers = llm.listProviders();
  if (!providers.some((provider) => provider.id === selection.provider)) {
    throw new Error(`\u6CA1\u6709 provider\u300C${selection.provider}\u300D\u3002\u53EF\u7528\uFF1A${providers.map((provider) => provider.id).join(", ") || "\u65E0"}`);
  }
  let models;
  try {
    models = await llm.listModels(selection.provider);
  } catch (error) {
    throw new Error(`\u8BFB\u53D6 provider\u300C${selection.provider}\u300D\u7684\u6A21\u578B\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
  if (!models.some((model) => model.id === selection.model)) {
    throw new Error(`provider\u300C${selection.provider}\u300D\u4E0B\u6CA1\u6709\u6A21\u578B\u300C${selection.model}\u300D\u3002\u53EF\u7528\uFF1A${models.map((model) => model.id).join(", ") || "\u65E0"}`);
  }
  if (selection.reasoningEffort !== void 0) {
    let reasoning;
    try {
      reasoning = (await llm.resolveModelInfo(selection.provider, selection.model)).reasoning;
    } catch (error) {
      throw new Error(`\u8BFB\u53D6\u6A21\u578B\u300C${selection.model}\u300D\u7684\u63A8\u7406\u5F3A\u5EA6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    const efforts = reasoning?.efforts ?? [];
    if (!efforts.some((effort) => effort.id === selection.reasoningEffort)) {
      throw new Error(`\u6A21\u578B\u300C${selection.model}\u300D\u4E0D\u652F\u6301\u63A8\u7406\u5F3A\u5EA6\u300C${selection.reasoningEffort}\u300D\u3002\u53EF\u7528\uFF1A${efforts.map((effort) => effort.id).join(", ") || "\u65E0"}`);
    }
  }
}

// src/host/run.ts
var DEFAULT_RUN_OPTIONS = {
  enabled: true,
  timeoutMs: 12e4,
  maxTokens: 2048,
  concurrency: 2,
  maxPromptChars: 24e3,
  maxSystemChars: 8e3,
  maxOutputChars: 32e3,
  minIntervalMs: 1e3
};
var DEFAULT_SYSTEM = "You are a model embedded in a dashboard panel. Answer the user prompt directly and concisely, in plain text or Markdown. Do not mention this instruction and do not call tools.";
var PanelRunner = class {
  constructor(ctx, options = DEFAULT_RUN_OPTIONS) {
    this.ctx = ctx;
    this.options = options;
  }
  ctx;
  options;
  active = /* @__PURE__ */ new Map();
  lastRun = /* @__PURE__ */ new Map();
  /**
   * Run one prompt for a panel, using its model or the deployment default.
   * @param panel - the panel the frame belongs to.
   * @param prompt - user/model prompt from the panel.
   * @param system - optional system instruction authored by the panel.
   * @returns text, or a short error safe to render in the panel.
   */
  async run(panel, prompt, system) {
    if (!this.options.enabled) return { ok: false, error: "\u8FD9\u4E2A dsh \u5173\u95ED\u4E86\u9762\u677F\u5185\u6A21\u578B\u8C03\u7528" };
    const text = prompt.trim();
    if (text === "") return { ok: false, error: "\u63D0\u793A\u8BCD\u662F\u7A7A\u7684" };
    if (prompt.length > this.options.maxPromptChars) {
      return { ok: false, error: `\u63D0\u793A\u8BCD\u4E0D\u80FD\u8D85\u8FC7 ${this.options.maxPromptChars} \u4E2A\u5B57\u7B26` };
    }
    if (system !== void 0 && system.length > this.options.maxSystemChars) {
      return { ok: false, error: `system \u4E0D\u80FD\u8D85\u8FC7 ${this.options.maxSystemChars} \u4E2A\u5B57\u7B26` };
    }
    const running = this.active.get(panel.id) ?? 0;
    if (running >= this.options.concurrency) {
      return { ok: false, error: "\u8FD9\u4E2A\u9762\u677F\u540C\u65F6\u8FDB\u884C\u7684\u6A21\u578B\u8C03\u7528\u592A\u591A\u4E86\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" };
    }
    const now = Date.now();
    if (now - (this.lastRun.get(panel.id) ?? 0) < this.options.minIntervalMs) {
      return { ok: false, error: "\u521A\u8C03\u7528\u8FC7\u6A21\u578B\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" };
    }
    this.lastRun.set(panel.id, now);
    this.active.set(panel.id, running + 1);
    try {
      return await this.call(panel, text, system);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      const left = (this.active.get(panel.id) ?? 1) - 1;
      if (left <= 0) this.active.delete(panel.id);
      else this.active.set(panel.id, left);
    }
  }
  async call(panel, prompt, system) {
    const llm = this.ctx.get("llm");
    if (llm === void 0) return { ok: false, error: "\u8FD9\u4E2A dsh \u7EC4\u5408\u6CA1\u6709 llm \u670D\u52A1" };
    const selection = panel.definition.model ?? this.ctx.get("agentDefaultModel")?.currentSelection();
    if (selection === void 0) return { ok: false, error: "\u6CA1\u6709\u53EF\u7528\u7684\u6A21\u578B" };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs);
    let output = "";
    let failure;
    try {
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort },
        system: system ?? DEFAULT_SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        maxTokens: this.options.maxTokens,
        signal: controller.signal
      })) {
        if (chunk.type === "text-delta" && typeof chunk.text === "string") output += chunk.text;
        else if (chunk.type === "finish") {
          if (chunk.reason?.kind === "error") {
            failure = chunk.reason.failure?.message ?? "\u6A21\u578B\u8C03\u7528\u51FA\u9519";
          } else if (chunk.reason?.kind === "aborted") {
            failure = timedOut ? "\u6A21\u578B\u8C03\u7528\u8D85\u65F6" : "\u6A21\u578B\u8C03\u7528\u88AB\u4E2D\u6B62";
          }
        }
      }
    } catch (error) {
      failure ??= timedOut ? "\u6A21\u578B\u8C03\u7528\u8D85\u65F6" : error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    if (failure !== void 0) return { ok: false, error: failure };
    const text = output.trim();
    if (text === "") return { ok: false, error: "\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u6587\u672C" };
    return { ok: true, text: text.slice(0, this.options.maxOutputChars) };
  }
};

// src/host/routes.ts
var HEARTBEAT_MS = 2e4;
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function parseModel(value) {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return void 0;
  const record = value;
  const provider = record["provider"];
  const model = record["model"];
  const effort = record["reasoningEffort"];
  if (typeof provider !== "string" || provider.trim() === "" || provider.length > 120) return void 0;
  if (typeof model !== "string" || model.trim() === "" || model.length > 200) return void 0;
  if (effort !== void 0 && (typeof effort !== "string" || effort.length > 120)) return void 0;
  return {
    provider,
    model,
    ...effort === void 0 ? {} : { reasoningEffort: effort }
  };
}
function parseAction(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const action = value;
  if (typeof action["panelId"] !== "string") return void 0;
  switch (action["op"]) {
    case "refresh":
    case "delete":
    case "undo":
      return action;
    case "approve":
      return typeof action["fingerprint"] === "string" ? action : void 0;
    case "collapse":
      return typeof action["collapsed"] === "boolean" ? action : void 0;
    case "move":
      return action["delta"] === 1 || action["delta"] === -1 ? action : void 0;
    case "span":
      return action["span"] === 1 || action["span"] === 2 || action["span"] === 3 ? action : void 0;
    case "model": {
      const model = parseModel(action["model"]);
      return model === void 0 ? void 0 : { op: "model", panelId: action["panelId"], model };
    }
    default:
      return void 0;
  }
}
function registerRoutes({ ctx, store, hub, runOptions, update }) {
  const connection = ctx.connection;
  const runner = new PanelRunner(ctx, runOptions);
  ctx.effect(() => connection.fetch.register({
    path: ROUTES.panels,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => json({ panels: hub.views() })
  }), "dsh-pad: panels route");
  ctx.effect(() => connection.fetch.register({
    path: ROUTES.stream,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const watchParam = new URL(request.url).searchParams.get("watch") ?? "";
      const watch = new Set(watchParam.split(",").map((id) => id.trim()).filter(Boolean));
      const encoder = new TextEncoder();
      let cleanup;
      const body = new ReadableStream({
        start(controller) {
          let open = true;
          let close = () => {
          };
          const write = (text) => {
            if (!open) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              close();
            }
          };
          const subscriber = {
            watch,
            send: (event) => write(`data: ${JSON.stringify(event)}

`)
          };
          write("retry: 3000\n\n");
          const unsubscribe = hub.subscribe(subscriber);
          const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
          close = () => {
            if (!open) return;
            open = false;
            clearInterval(heartbeat);
            unsubscribe();
            request.signal.removeEventListener("abort", close);
            try {
              controller.close();
            } catch {
            }
          };
          cleanup = close;
          request.signal.addEventListener("abort", close, { once: true });
        },
        cancel() {
          cleanup?.();
        }
      });
      return new Response(body, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no"
        }
      });
    }
  }), "dsh-pad: stream route");
  ctx.effect(() => connection.fetch.register({
    path: ROUTES.models,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => json(await modelCatalog(ctx))
  }), "dsh-pad: models route");
  if (update !== void 0) {
    ctx.effect(() => connection.fetch.register({
      path: ROUTES.update,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        if (request.method === "GET") {
          const force = new URL(request.url).searchParams.get("force") === "1";
          return json(force ? await update.check(true) : await update.ensure());
        }
        let body;
        try {
          body = await request.json();
        } catch {
          body = void 0;
        }
        const action = typeof body === "object" && body !== null ? body["action"] : void 0;
        if (action === "check") return json(await update.check(true));
        if (action === "apply") return json(await update.apply());
        return json({ ok: false, error: "unknown update action" }, 400);
      }
    }), "dsh-pad: update route");
  }
  ctx.effect(() => connection.fetch.register({
    path: ROUTES.run,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      let body;
      try {
        body = await request.json();
      } catch {
        body = void 0;
      }
      if (typeof body !== "object" || body === null) return json({ ok: false, error: "bad request" }, 400);
      const record = body;
      const panelId = record["panelId"];
      const prompt = record["prompt"];
      const system = record["system"];
      if (typeof panelId !== "string" || typeof prompt !== "string") {
        return json({ ok: false, error: "panelId \u548C prompt \u5FC5\u987B\u662F\u5B57\u7B26\u4E32" }, 400);
      }
      if (system !== void 0 && typeof system !== "string") {
        return json({ ok: false, error: "system \u5FC5\u987B\u662F\u5B57\u7B26\u4E32" }, 400);
      }
      const panel = store.find(panelId);
      if (panel === void 0) return json({ ok: false, error: "\u9762\u677F\u4E0D\u5B58\u5728" }, 404);
      const result = await runner.run(panel, prompt, system);
      return json(result, result.ok ? 200 : 400);
    }
  }), "dsh-pad: run route");
  ctx.effect(() => connection.fetch.register({
    path: ROUTES.action,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      let action;
      try {
        action = parseAction(await request.json());
      } catch {
        action = void 0;
      }
      if (action === void 0) return json({ ok: false, error: "bad action" }, 400);
      try {
        switch (action.op) {
          case "refresh":
            hub.refresh(action.panelId);
            break;
          case "delete":
            await store.remove(action.panelId);
            break;
          case "undo":
            await store.undo(action.panelId);
            break;
          case "approve":
            if (!await store.approve(action.panelId, action.fingerprint)) {
              return json({ ok: false, error: "\u6570\u636E\u6E90\u5DF2\u7ECF\u53D8\u4E86\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4" }, 409);
            }
            break;
          case "collapse":
            await store.setCollapsed(action.panelId, action.collapsed);
            break;
          case "move":
            await store.move(action.panelId, action.delta);
            break;
          case "span":
            await store.setSpan(action.panelId, action.span);
            break;
          case "model":
            if (action.model !== null) await assertModel(ctx, action.model);
            await store.setModel(action.panelId, action.model);
            break;
        }
        return json({ ok: true });
      } catch (error) {
        const status = error instanceof PanelNotFoundError ? 404 : 409;
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, status);
      }
    }
  }), "dsh-pad: action route");
}

// src/host/tools.ts
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";

// src/shared/validate.ts
var MAX_SOURCES = 8;
var MAX_CODE_BYTES = 2e5;
var MAX_TITLE = 40;
var SOURCE_ID = /^[a-z][a-z0-9_]{0,31}$/;
var PARSES = ["text", "json", "lines"];
var PanelValidationError = class extends Error {
  constructor(problems) {
    super(`\u9762\u677F\u5B9A\u4E49\u6709 ${problems.length} \u5904\u95EE\u9898\uFF1A
- ${problems.join("\n- ")}`);
    this.problems = problems;
    this.name = "PanelValidationError";
  }
  problems;
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function intIn(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function checkSource(raw, index, limits, problems) {
  const at = `sources[${index}]`;
  if (!isRecord(raw)) {
    problems.push(`${at} \u5FC5\u987B\u662F\u5BF9\u8C61`);
    return void 0;
  }
  const { id, kind, parse, intervalSec, timeoutMs } = raw;
  const before = problems.length;
  if (typeof id !== "string" || !SOURCE_ID.test(id)) problems.push(`${at}.id \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684\u6807\u8BC6\u7B26\uFF08a-z0-9_\uFF0C\u226432 \u5B57\u7B26\uFF09`);
  if (typeof parse !== "string" || !PARSES.includes(parse)) problems.push(`${at}.parse \u53EA\u80FD\u662F text / json / lines`);
  if (!intIn(intervalSec, limits.minIntervalSec, 86400)) problems.push(`${at}.intervalSec \u5FC5\u987B\u662F ${limits.minIntervalSec}\u201386400 \u7684\u6574\u6570`);
  if (timeoutMs !== void 0 && !intIn(timeoutMs, 500, 6e4)) problems.push(`${at}.timeoutMs \u5FC5\u987B\u662F 500\u201360000 \u7684\u6574\u6570`);
  const common = {
    id,
    parse,
    intervalSec,
    ...timeoutMs === void 0 ? {} : { timeoutMs }
  };
  if (kind === "command") {
    const { command } = raw;
    if (typeof command !== "string" || command.trim() === "" || command.length > 2e3) {
      problems.push(`${at}.command \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u22642000 \u5B57\u7B26\uFF09`);
    }
    return problems.length === before ? { ...common, kind, command } : void 0;
  }
  if (kind === "http") {
    const { url, method, headers, body } = raw;
    let parsed;
    try {
      parsed = typeof url === "string" ? new URL(url) : void 0;
    } catch {
      parsed = void 0;
    }
    if (parsed === void 0 || parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      problems.push(`${at}.url \u5FC5\u987B\u662F http(s) \u7F51\u5740`);
    }
    if (method !== void 0 && method !== "GET" && method !== "POST") problems.push(`${at}.method \u53EA\u80FD\u662F GET / POST`);
    if (headers !== void 0) {
      if (!isRecord(headers) || Object.keys(headers).length > 20 || Object.values(headers).some((v) => typeof v !== "string")) {
        problems.push(`${at}.headers \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u5230\u5B57\u7B26\u4E32\u7684\u5BF9\u8C61\uFF08\u226420 \u9879\uFF09`);
      }
    }
    if (body !== void 0 && (typeof body !== "string" || body.length > 2e4)) problems.push(`${at}.body \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF08\u226420000 \u5B57\u7B26\uFF09`);
    if (problems.length !== before) return void 0;
    return {
      ...common,
      kind,
      url,
      ...method === void 0 ? {} : { method },
      ...headers === void 0 ? {} : { headers },
      ...body === void 0 ? {} : { body }
    };
  }
  problems.push(`${at}.kind \u53EA\u80FD\u662F command / http`);
  return void 0;
}
function checkAgent(raw, limits, problems) {
  if (raw === void 0) return void 0;
  if (raw === null) return null;
  if (!isRecord(raw)) {
    problems.push("agent \u5FC5\u987B\u662F\u5BF9\u8C61\u6216 null");
    return void 0;
  }
  const { instruction, everyMinutes } = raw;
  const before = problems.length;
  if (typeof instruction !== "string" || instruction.trim() === "" || instruction.length > 4e3) {
    problems.push("agent.instruction \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u22644000 \u5B57\u7B26\uFF09");
  }
  if (!intIn(everyMinutes, limits.minAgentMinutes, 10080)) {
    problems.push(`agent.everyMinutes \u5FC5\u987B\u662F ${limits.minAgentMinutes}\u201310080 \u7684\u6574\u6570`);
  }
  return problems.length === before ? { instruction, everyMinutes } : void 0;
}
function checkModel(raw, problems) {
  if (raw === void 0 || raw === null) return void 0;
  if (!isRecord(raw)) {
    problems.push("model \u5FC5\u987B\u662F { provider, model, reasoningEffort? } \u6216 null");
    return void 0;
  }
  const before = problems.length;
  const provider = raw["provider"];
  const id = raw["model"];
  const effort = raw["reasoningEffort"];
  if (typeof provider !== "string" || provider.trim() === "" || provider.length > 120) {
    problems.push("model.provider \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u2264120 \u5B57\u7B26\uFF09");
  }
  if (typeof id !== "string" || id.trim() === "" || id.length > 200) {
    problems.push("model.model \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\uFF08\u2264200 \u5B57\u7B26\uFF09");
  }
  if (effort !== void 0 && (typeof effort !== "string" || effort.length > 120)) {
    problems.push("model.reasoningEffort \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF08\u2264120 \u5B57\u7B26\uFF09");
  }
  return problems.length === before ? {
    provider,
    model: id,
    ...effort === void 0 ? {} : { reasoningEffort: effort }
  } : void 0;
}
function validateDefinition(raw, limits) {
  const problems = [];
  const { title, icon, html, css, script, height, sources, agent, model } = raw;
  if (typeof title !== "string" || title.trim() === "" || [...title].length > MAX_TITLE) {
    problems.push(`title \u5FC5\u987B\u662F 1\u2013${MAX_TITLE} \u5B57\u7684\u5B57\u7B26\u4E32`);
  }
  if (icon !== void 0 && (typeof icon !== "string" || [...icon].length > 4)) problems.push("icon \u53EA\u80FD\u662F\u4E00\u4E2A emoji");
  for (const [key, value] of [["html", html], ["css", css], ["script", script]]) {
    if (typeof value !== "string") problems.push(`${key} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF08\u53EF\u4EE5\u4E3A\u7A7A\uFF09`);
  }
  const codeBytes = [html, css, script].reduce(
    (sum, part) => sum + (typeof part === "string" ? new TextEncoder().encode(part).length : 0),
    0
  );
  if (codeBytes > MAX_CODE_BYTES) problems.push(`html + css + script \u5408\u8BA1\u4E0D\u80FD\u8D85\u8FC7 ${MAX_CODE_BYTES} \u5B57\u8282\uFF08\u73B0\u5728 ${codeBytes}\uFF09`);
  if (height !== "auto" && !intIn(height, 60, 1200)) problems.push('height \u5FC5\u987B\u662F "auto" \u6216 60\u20131200 \u7684\u6574\u6570\u50CF\u7D20');
  const checkedSources = [];
  if (!Array.isArray(sources)) {
    problems.push("sources \u5FC5\u987B\u662F\u6570\u7EC4\uFF08\u6CA1\u6709\u6570\u636E\u6E90\u5C31\u4F20 []\uFF09");
  } else {
    if (sources.length > MAX_SOURCES) problems.push(`sources \u6700\u591A ${MAX_SOURCES} \u4E2A`);
    sources.forEach((source, index) => {
      const checked = checkSource(source, index, limits, problems);
      if (checked !== void 0) checkedSources.push(checked);
    });
    const ids = checkedSources.map((source) => source.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate !== void 0) problems.push(`sources \u91CC\u7684 id\u300C${duplicate}\u300D\u91CD\u590D\u4E86`);
  }
  const checkedAgent = checkAgent(agent, limits, problems);
  const checkedModel = checkModel(model, problems);
  if (problems.length > 0) throw new PanelValidationError(problems);
  return {
    title: title.trim(),
    ...icon === void 0 || icon === "" ? {} : { icon },
    html,
    css,
    script,
    height,
    sources: checkedSources,
    ...checkedModel === void 0 ? {} : { model: checkedModel },
    ...checkedAgent === void 0 ? {} : { agent: checkedAgent }
  };
}

// src/host/guide.ts
var PANEL_GUIDE = `## \u60AC\u6D6E\u9762\u677F\uFF08dsh-pad\uFF09

\u7528\u6237\u60F3\u957F\u671F\u76EF\u7740\u67D0\u4E2A\u4F1A\u53D8\u7684\u4E1C\u897F\uFF08\u670D\u52A1\u5668\u6027\u80FD\u3001\u5957\u9910\u4F59\u989D\u3001\u4EF7\u683C\u3001\u6784\u5EFA\u72B6\u6001\u3001\u5012\u8BA1\u65F6\u2026\u2026\uFF09\uFF0C\u6216\u8005\u8BF4\u300C\u505A\u4E2A\u9762\u677F / \u770B\u677F / \u5C0F\u7EC4\u4EF6\u300D\u65F6\uFF0C\u7528 pad_* \u5DE5\u5177\u5728\u60AC\u6D6E\u9762\u677F\u91CC\u505A\u4E00\u5F20\u9762\u677F\uFF0C\u4E0D\u8981\u53EA\u5728\u5BF9\u8BDD\u91CC\u56DE\u7B54\u3002

### \u6D41\u7A0B
1. \u5148\u60F3\u6E05\u695A\u8FD9\u5F20\u9762\u677F\u56DE\u7B54\u54EA\u4E00\u4E2A\u95EE\u9898\uFF0C\u53EA\u653E\u56DE\u7B54\u5B83\u9700\u8981\u7684\u6570\u636E\u3002
2. \u9009\u6570\u636E\u600E\u4E48\u6765\uFF1A
   - **\u76F4\u63A5\u6570\u636E\u6E90**\uFF08\u9996\u9009\uFF0C\u79D2\u7EA7\u5237\u65B0\uFF0C\u4E0D\u8017 token\uFF09\uFF1A\`command\` \u5728\u7528\u6237\u672C\u673A\u8DD1 shell \u547D\u4EE4\uFF1B\`http\` \u4ECE\u672C\u673A\u8BF7\u6C42\u63A5\u53E3\u3002
     \u5148\u7528 pad_test_source \u8BD5\u8DD1\uFF0C\u770B\u6E05\u771F\u5B9E\u8F93\u51FA\u683C\u5F0F\u518D\u5199\u811A\u672C\u3002\u8F93\u51FA\u5C3D\u91CF\u8BA9\u547D\u4EE4\u672C\u8EAB\u6574\u7406\u597D\uFF08jq\u3001awk\u3001--json \u53C2\u6570\uFF09\uFF0Cparse \u9009 json / lines / text\u3002
     \u5BC6\u94A5\u4E0D\u8981\u5199\u8FDB\u9762\u677F\uFF1A\u5199\u6210 \`{{env:\u53D8\u91CF\u540D}}\`\uFF08\u53EF\u7528\u5728 url\u3001headers\u3001body\uFF09\uFF0C\u503C\u7531\u5BBF\u4E3B\u4ECE\u51ED\u636E\u6216\u73AF\u5883\u53D8\u91CF\u91CC\u53D6\uFF0C\u6D4F\u89C8\u5668\u62FF\u4E0D\u5230\u3002\u6CA1\u914D\u7F6E\u65F6\u544A\u8BC9\u7528\u6237\u8981\u8BBE\u7F6E\u54EA\u4E2A\u53D8\u91CF\u3002
   - **AI \u5237\u65B0**\uFF08\u6570\u636E\u53EA\u80FD\u9760\u641C\u7D22 / \u8BFB\u7F51\u9875 / \u591A\u6B65\u63A8\u7406\u5F97\u5230\u65F6\uFF09\uFF1A\u7ED9 \`agent: { instruction, everyMinutes }\`\u3002\u540E\u53F0\u4F1A\u6309\u95F4\u9694\u8DD1\u4E00\u8F6E\u65E0\u4EBA\u503C\u5B88\u7684 agent\uFF0C\u5B83\u53EA\u770B\u5F97\u5230 instruction \u548C\u4E0A\u4E00\u6B21\u7684\u6570\u636E\uFF0C\u6240\u4EE5 instruction \u91CC\u5199\u6E05\u695A\uFF1A\u53D6\u4EC0\u4E48\u3001\u53BB\u54EA\u91CC\u53D6\uFF08\u5177\u4F53\u7F51\u5740\u6216\u63A5\u53E3\uFF09\u3001\u63D0\u4EA4\u7684\u6570\u636E\u7ED3\u6784\u3002
     \u9876\u5C42 \`model\`\uFF08\`{ provider, model, reasoningEffort? }\`\uFF09\u662F\u8FD9\u5F20\u9762\u677F\u81EA\u5DF1\u7684\u6A21\u578B\uFF1AAI \u5237\u65B0\u548C\u9762\u677F\u91CC\u7684 \`dsh.run\` \u90FD\u7528\u5B83\uFF1B\u4E0D\u4F20\u5219\u8DDF\u968F\u5168\u5C40\u9ED8\u8BA4\u3002\u5148\u8C03 \`pad_models\` \u770B\u5F53\u524D\u53EF\u7528\u7684 provider/model\u3002\u7528\u6237\u60F3\u7528\u4FBF\u5B9C/\u5FEB\u7684\u6A21\u578B\u76EF\u7B80\u5355\u6570\u636E\u3001\u6216\u6307\u5B9A\u5F3A\u6A21\u578B\u505A\u590D\u6742\u6574\u7406\u65F6\u7528\u5B83\u3002
     \u521B\u5EFA\u65F6\u4F60\u81EA\u5DF1\u5148\u53D6\u4E00\u6B21\u771F\u5B9E\u6570\u636E\uFF0C\u7528 \`data\` \u53C2\u6570\u4EA4\u4E0A\u7B2C\u4E00\u7248\uFF0C\u7ED3\u6784\u8981\u548C\u4EE5\u540E\u5237\u65B0\u4E00\u81F4\u3002
3. \u5199 html / css / script\uFF08\u89C1\u4E0B\u65B9\u8FD0\u884C\u73AF\u5883\uFF09\uFF0Cpad_create\u3002\u7ED3\u679C\u91CC\u6709\u6BCF\u4E2A\u6570\u636E\u6E90\u7684\u9996\u6B21\u8BFB\u6570\uFF0C\u68C0\u67E5\u6709\u6CA1\u6709\u62A5\u9519\uFF1B\u6709\u95EE\u9898\u7528 pad_update \u4FEE\u3002
4. \u5BF9\u8BDD\u91CC\u4E00\u53E5\u8BDD\u8BF4\u505A\u597D\u4E86\u3001\u591A\u4E45\u5237\u65B0\u4E00\u6B21\u3002\u8981\u6539\u5DF2\u6709\u9762\u677F\u5148 pad_list \u627E\u5230\u5B83\u518D pad_update\uFF0C\u4E0D\u8981\u65B0\u5EFA\u91CD\u590D\u7684\u3002

### \u8FD0\u884C\u73AF\u5883\uFF08\u6C99\u7BB1 iframe\uFF09
- \u5BBD\u7EA6 200\u2013400px \u7684\u7A84\u5361\u7247\uFF08\u7528\u6237\u53EF\u4EE5\u62D6\u5361\u7247\u5230\u522B\u7684\u5361\u7247\u7684\u4E0A/\u4E0B/\u5DE6/\u53F3\u8FB9\u7F18\u5206\u51FA\u5D4C\u5957\u533A\u57DF\u3001\u62D6\u5206\u9694\u6761\u8C03\u6BD4\u4F8B\uFF1B\u4E0D\u8981\u5047\u8BBE\u56FA\u5B9A\u5217\u6570\uFF09\uFF0C\u6309\u7A84\u5361\u8BBE\u8BA1\uFF1A\u4E00\u5C4F\u770B\u5B8C\uFF0C\u5C11\u5B57\u591A\u6570\u5B57\uFF0C\u4E0D\u653E\u5927\u6807\u9898\uFF08\u5361\u7247\u5934\u5DF2\u7ECF\u6709\u6807\u9898\u548C\u56FE\u6807\uFF09\u3002
- \u65E0\u7F51\u7EDC\u3001\u65E0\u540C\u6E90\u6743\u9650\uFF1A\u4E0D\u80FD fetch\u3001\u4E0D\u80FD\u52A0\u8F7D\u5916\u90E8\u811A\u672C / \u5B57\u4F53 / \u56FE\u7247\uFF08\u53EA\u80FD data: \u56FE\u7247 / \u5185\u8054 SVG\uFF09\u3002\u6570\u636E\u53EA\u4ECE \`dsh\` \u6765\u3002
- \u53EF\u7528 CSS \u53D8\u91CF\uFF08\u81EA\u52A8\u8DDF\u968F\u4EAE / \u6697\u4E3B\u9898\uFF09\uFF1A--pad-fg, --pad-fg-2, --pad-fg-3, --pad-bg, --pad-bg-2, --pad-border, --pad-accent, --pad-ok, --pad-warn, --pad-danger, --pad-font, --pad-mono, --pad-radius\u3002\u4E0D\u8981\u5199\u6B7B\u989C\u8272\u3002
- \u5168\u5C40\u5BF9\u8C61 \`dsh\`\uFF1A
  - \`dsh.onData(fn)\`\uFF1Afn(data) \u5728\u6709\u6570\u636E\u65F6\u7ACB\u5373\u8C03\u7528\uFF0C\u4E4B\u540E\u6BCF\u6B21\u66F4\u65B0\u518D\u8C03\u7528\u3002data = \`{ sources: { [id]: { ok, value, error, at } }, agent: { value, at } | null }\`\u3002
    \u811A\u672C\u7B2C\u4E00\u6B21\u8FD0\u884C\u524D\uFF0C\u58F0\u660E\u7684\u6BCF\u4E2A\u6570\u636E\u6E90\u90FD\u5DF2\u6709\u4E00\u6B21\u8BFB\u6570\uFF08dsh \u91CD\u542F\u540E\u4E5F\u4E00\u6837\uFF09\uFF0C\u4F46\u8BFB\u6570\u53EF\u80FD\u662F\u5931\u8D25\uFF1A\`sources[id].ok === false\` \u65F6\u8981\u663E\u793A \`error\`\uFF0C\u4E0D\u8981\u5047\u8BBE \`value\` \u4E00\u5B9A\u5B58\u5728\u3002
  - \`dsh.history(sourceId)\`\uFF1A\u8BE5\u6570\u636E\u6E90\u6700\u8FD1 120 \u6B21\u6210\u529F\u8BFB\u6570 \`[{ value, at }]\`\uFF08\u9762\u677F\u6253\u5F00\u671F\u95F4\u7D2F\u79EF\uFF1Bdsh \u91CD\u542F\u540E\u5148\u5E26\u4E0A\u4E0A\u6B21\u7F13\u5B58\u7684\u6700\u8FD1 20 \u4E2A\u70B9\uFF09\uFF0C\u753B\u8D8B\u52BF\u7528\u3002
  - \`dsh.refresh()\`\uFF1A\u7ACB\u5373\u5237\u65B0\u3002\`dsh.openUrl(url)\`\uFF1A\u5728\u65B0\u6807\u7B7E\u6253\u5F00\u94FE\u63A5\uFF08iframe \u91CC\u666E\u901A\u94FE\u63A5\u6253\u4E0D\u5F00\uFF09\u3002
  - \`dsh.state.get(key)\` / \`dsh.state.set(key, value)\`\uFF1A\u6309\u9762\u677F\u4FDD\u5B58\u7684\u5C0F\u91CF UI \u72B6\u6001\uFF08\u4F8B\u5982\u9009\u4E2D\u7684\u6807\u7B7E\u9875\uFF09\u3002
  - \`dsh.ask(text)\`\uFF1A\u628A\u4E00\u53E5\u8BDD\u586B\u8FDB\u5BF9\u8BDD\u8F93\u5165\u6846\uFF08\u4F8B\u5982\u300C\u5E2E\u6211\u5206\u6790\u4E00\u4E0B\u8FD9\u53F0\u673A\u5668\u4E3A\u4EC0\u4E48\u8D1F\u8F7D\u9AD8\u300D\uFF09\u3002
  - \`dsh.run(prompt, { system? })\`\uFF1A\u7528**\u8FD9\u5F20\u9762\u677F\u7684\u6A21\u578B**\u8DD1\u4E00\u6B21\u3001\u8FD4\u56DE \`{ ok, text?, error? }\`\u3002\u9002\u5408\u5728\u9762\u677F\u91CC\u653E\u4E00\u4E2A\u6309\u94AE\uFF0C\u8BA9\u6A21\u578B\u5904\u7406\u5F53\u524D\u6570\u636E\u5E76\u663E\u793A\u7ED3\u679C\u3002\u4E00\u6B21\u8C03\u7528\u53EA\u505A\u7EAF\u6587\u672C\u751F\u6210\uFF0C\u6CA1\u6709\u5DE5\u5177\u3001\u6CA1\u6709\u7F51\u7EDC\uFF1B\u9700\u8981\u7F51\u9875\u6570\u636E\u5148\u7528\u76F4\u63A5\u6570\u636E\u6E90\u6216 AI \u5237\u65B0\u578B\u9762\u677F\u628A\u6570\u636E\u62FF\u8FDB\u6765\u3002prompt \u5EFA\u8BAE\u4E0D\u8D85\u8FC7 2 \u4E07\u5B57\uFF0C\u8C03\u7528\u65F6\u7981\u7528\u6309\u94AE\u3001\u663E\u793A\u300C\u5206\u6790\u4E2D\u2026\u300D\uFF0C\u62FF\u5230\u7ED3\u679C\u518D\u7528 \`textContent\` \u663E\u793A\u3002\`dsh.ask\` \u4ECD\u7136\u662F\u628A\u8BDD\u4EA4\u7ED9\u4E3B\u5BF9\u8BDD\uFF0C\u4E0D\u662F\u9762\u677F\u6A21\u578B\u3002
    \`\`\`js
    var btn = document.getElementById('go'), out = document.getElementById('out');
    btn.onclick = async function () {
      btn.disabled = true; out.textContent = '\u5206\u6790\u4E2D\u2026';
      var r = await dsh.run('\u628A\u4E0B\u9762\u7684\u6570\u636E\u603B\u7ED3\u6210\u4E09\u884C\uFF1A\\n' + JSON.stringify(dsh.data.sources.metric.value));
      out.textContent = r.ok ? r.text : r.error;
      btn.disabled = false;
    };
    \`\`\`
  - \u5DE5\u5177\u51FD\u6570\uFF1A\`dsh.fmt.bytes(n)\`\u3001\`dsh.fmt.percent(x, digits)\`\uFF08x \u662F 0\u20131\uFF09\u3001\`dsh.fmt.number(n, digits)\`\u3001\`dsh.fmt.ago(isoTime)\`\u3001\`dsh.fmt.time(isoTime)\`\u3001\`dsh.fmt.duration(seconds)\`\u3001\`dsh.escape(text)\`\uFF08HTML \u8F6C\u4E49\uFF09\u3001\`dsh.tone(fraction, warnAt=0.7, dangerAt=0.9)\`\uFF08\u8FD4\u56DE ok / warn / danger \u989C\u8272\u53D8\u91CF\uFF09\u3002
  - \u753B\u56FE\uFF1A\`dsh.chart.sparkline(numbers, { width, height, color, fill, min, max })\`\u3001\`dsh.chart.bar(fraction, { color, height })\`\u3001\`dsh.chart.ring(fraction, { size, stroke, color, label })\`\uFF0C\u90FD\u8FD4\u56DE SVG / HTML \u5B57\u7B26\u4E32\uFF0C\u914D\u5408 innerHTML \u4F7F\u7528\uFF1B\u4E0D\u4F20 color \u65F6\u6309 dsh.tone \u81EA\u52A8\u7740\u8272\u3002
- \u811A\u672C\u5728 html \u4E4B\u540E\u6267\u884C\uFF1B\u6E32\u67D3\u8981\u80FD\u5904\u7406\u300C\u8FD8\u6CA1\u6709\u6570\u636E\u300D\u300C\u6570\u636E\u6E90\u62A5\u9519\u300D\u4E24\u79CD\u60C5\u51B5\uFF08\u663E\u793A \u2014 \u548C\u9519\u8BEF\u539F\u56E0\uFF09\u3002
- \u7528 \`textContent\` \u6216\u81EA\u5DF1\u8F6C\u4E49\u540E\u518D\u62FC HTML\uFF0C\u4E0D\u8981\u628A\u5916\u90E8\u5B57\u7B26\u4E32\u76F4\u63A5\u585E\u8FDB innerHTML\u3002
`;

// src/host/tools.ts
var SAMPLE_CHARS = 1500;
var sourceItem = {
  type: "object",
  additionalProperties: true,
  description: '\u6570\u636E\u6E90\u3002command\uFF1A{ id, kind:"command", command, parse, intervalSec, timeoutMs? }\uFF1Bhttp\uFF1A{ id, kind:"http", url, method?, headers?, body?, parse, intervalSec, timeoutMs? }',
  properties: {
    id: { type: "string", description: "\u5C0F\u5199\u6807\u8BC6\u7B26\uFF0C\u811A\u672C\u91CC\u7528 dsh.data.sources[id] \u8BFB\u53D6" },
    kind: { type: "string", enum: ["command", "http"] },
    command: { type: "string", description: "kind=command\uFF1A\u5728\u7528\u6237\u672C\u673A\u6267\u884C\u7684 shell \u547D\u4EE4" },
    url: { type: "string", description: "kind=http\uFF1A\u8BF7\u6C42\u5730\u5740\uFF0C\u53EF\u542B {{env:NAME}}" },
    method: { type: "string", enum: ["GET", "POST"] },
    headers: { type: "object", additionalProperties: true, description: "\u8BF7\u6C42\u5934\uFF0C\u503C\u53EF\u542B {{env:NAME}} \u5BC6\u94A5\u5F15\u7528" },
    body: { type: "string" },
    parse: { type: "string", enum: ["json", "lines", "text"], description: "\u8F93\u51FA\u600E\u4E48\u4EA4\u7ED9\u811A\u672C\uFF1Ajson \u89E3\u6790 / \u6309\u884C\u62C6\u6210\u6570\u7EC4 / \u539F\u6587" },
    intervalSec: { type: "integer", description: "\u9762\u677F\u6253\u5F00\u65F6\u7684\u5237\u65B0\u95F4\u9694\uFF08\u79D2\uFF09" },
    timeoutMs: { type: "integer" }
  }
};
var modelSelection = {
  type: "object",
  additionalProperties: false,
  description: "\u8FD9\u5F20\u9762\u677F\u4F7F\u7528\u7684\u6A21\u578B\uFF08AI \u5237\u65B0\u548C\u9762\u677F\u5185 dsh.run \u90FD\u7528\u5B83\uFF09\uFF1A{ provider, model, reasoningEffort? }\uFF1B\u4E0D\u4F20\u5219\u8DDF\u968F\u5168\u5C40\u9ED8\u8BA4\u6A21\u578B\u3002\u5148\u7528 pad_models \u67E5\u770B\u53EF\u9009\u503C\u3002",
  properties: {
    provider: { type: "string", required: true, description: "provider id\uFF0C\u4F8B\u5982 magpie\u3001stepfun" },
    model: { type: "string", required: true, description: "\u8BE5 provider \u4E0B\u7684\u6A21\u578B id" },
    reasoningEffort: { type: "string", description: "\u53EF\u9009\uFF1A\u8BE5\u6A21\u578B\u652F\u6301\u7684\u63A8\u7406\u5F3A\u5EA6 id" }
  }
};
var agentBlock = {
  type: "object",
  additionalProperties: true,
  description: "AI \u5237\u65B0\uFF08\u53EF\u9009\uFF09\uFF1A{ instruction, everyMinutes }\u3002\u6570\u636E\u53EA\u80FD\u9760\u641C\u7D22/\u8BFB\u7F51\u9875/\u63A8\u7406\u5F97\u5230\u65F6\u624D\u7528\u3002",
  properties: {
    instruction: { type: "string", description: "\u540E\u53F0\u5237\u65B0\u65F6\u8981\u505A\u4EC0\u4E48\uFF1A\u53D6\u4EC0\u4E48\u3001\u53BB\u54EA\u91CC\u53D6\u3001\u63D0\u4EA4\u7684\u6570\u636E\u7ED3\u6784" },
    everyMinutes: { type: "integer", description: "\u5237\u65B0\u95F4\u9694\uFF08\u5206\u949F\uFF09" }
  }
};
var textOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }]
};
function sample(value) {
  const text = JSON.stringify(value) ?? "null";
  return text.length > SAMPLE_CHARS ? `${text.slice(0, SAMPLE_CHARS)}\u2026\uFF08\u5171 ${text.length} \u5B57\u7B26\uFF0C\u5DF2\u622A\u65AD\uFF09` : text;
}
function describeSources(sources) {
  return sources.map((source) => source.kind === "command" ? `\u2022 [${source.id}] \u6BCF ${source.intervalSec} \u79D2\u8FD0\u884C\u547D\u4EE4\uFF1A${source.command}` : `\u2022 [${source.id}] \u6BCF ${source.intervalSec} \u79D2\u8BF7\u6C42\uFF1A${source.method ?? "GET"} ${source.url}`).join("\n");
}
function panelSummary(panel, store, refresher, hub) {
  const view = hub.views().find((v) => v.id === panel.id);
  return {
    id: panel.id,
    title: panel.definition.title,
    icon: panel.definition.icon ?? null,
    version: panel.version,
    sources: panel.definition.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      what: s.kind === "command" ? s.command : `${s.method ?? "GET"} ${s.url}`,
      intervalSec: s.intervalSec,
      lastError: view?.data.sources[s.id]?.ok === false ? view.data.sources[s.id].error ?? null : null
    })),
    waitingForApproval: !store.approved(panel),
    agent: panel.definition.agent ? {
      everyMinutes: panel.definition.agent.everyMinutes,
      status: refresher?.isBusy(panel.id) ? "running" : panel.agentRun?.status ?? "idle",
      lastError: panel.agentRun?.error ?? null,
      nextRunAt: panel.agentRun?.nextRunAt ?? null
    } : null
  };
}
function registerTools(deps) {
  const { ctx, store, hub, refresher, limits, resolveSecret } = deps;
  async function askToRun(exec, toolName, title, sources) {
    if (sources.length === 0 || deps.autoApprove) return true;
    const approval = ctx.get("approval");
    if (approval === void 0 || exec.agent === void 0) return false;
    const reason = `\u9762\u677F\u300C${title}\u300D\u8981\u5728\u8FD9\u53F0\u673A\u5668\u4E0A\u8FD0\u884C\uFF1A
${describeSources(sources)}`;
    const outcome = await approval.request({
      agent: exec.agent,
      toolName,
      callId: exec.callId,
      reason,
      displayReason: { en: `Panel "${title}" wants to run on this machine:
${describeSources(sources)}`, zh: reason },
      signal: exec.signal
    });
    return outcome === "allowed-once";
  }
  function readingsReport(readings) {
    return readings.map((r) => r.ok ? `- ${r.id}: \u2713 ${sample(r.value)}` : `- ${r.id}: \u2717 ${r.error}`);
  }
  async function firstReadings(panel) {
    if (panel.definition.sources.length === 0) return [];
    if (!store.approved(panel)) {
      return ["\u6570\u636E\u6E90\u8FD8\u6CA1\u88AB\u5141\u8BB8\u8FD0\u884C\uFF1A\u5DF2\u5728\u9762\u677F\u4E0A\u663E\u793A\u300C\u5141\u8BB8\u8FD0\u884C\u300D\uFF0C\u7528\u6237\u70B9\u4E86\u4E4B\u540E\u624D\u4F1A\u5F00\u59CB\u53D6\u6570\u3002\u544A\u8BC9\u7528\u6237\u8FD9\u4E00\u70B9\u3002"];
    }
    const readings = await hub.runAll(panel.id);
    return ["\u6570\u636E\u6E90\u8BFB\u6570\uFF1A", ...readingsReport(readings)];
  }
  function validate(raw) {
    try {
      return validateDefinition(raw, limits);
    } catch (error) {
      if (error instanceof PanelValidationError) throw new Error(error.message);
      throw error;
    }
  }
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_list",
    description: "\u5217\u51FA\u60AC\u6D6E\u9762\u677F\u575E\u91CC\u7684\u6240\u6709\u9762\u677F\uFF08id\u3001\u6807\u9898\u3001\u6570\u636E\u6E90\u3001\u6700\u8FD1\u7684\u9519\u8BEF\u3001AI \u5237\u65B0\u72B6\u6001\uFF09\u3002\u6539\u9762\u677F\u3001\u4FEE\u9762\u677F\u524D\u5148\u8C03\u7528\u3002",
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute() {
      const panels = store.list().map((p) => panelSummary(p, store, refresher, hub));
      return panels.length === 0 ? "\u8FD8\u6CA1\u6709\u9762\u677F\u3002" : JSON.stringify(panels, null, 2);
    }
  })), "dsh-pad: pad_list");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_get",
    description: "\u8BFB\u53D6\u4E00\u5F20\u9762\u677F\u7684\u5B8C\u6574\u5B9A\u4E49\uFF08html / css / script / sources / agent\uFF09\u548C\u6700\u65B0\u6570\u636E\uFF0C\u4FEE\u6539\u9762\u677F\u524D\u7528\u3002",
    parameters: { id: { type: "string", required: true, description: "\u9762\u677F id" } },
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute(args) {
      const panel = store.get(args.id);
      const view = hub.views().find((v) => v.id === panel.id);
      const data = view?.data;
      return JSON.stringify({
        id: panel.id,
        definition: panel.definition,
        latest: {
          sources: Object.fromEntries(Object.entries(data?.sources ?? {}).map(([id, r]) => [id, r.ok ? { ok: true, value: sample(r.value) } : { ok: false, error: r.error ?? "" }])),
          agent: panel.agentData ? sample(panel.agentData.value) : null
        }
      }, null, 2);
    }
  })), "dsh-pad: pad_get");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_test_source",
    description: "\u8BD5\u8DD1\u4E00\u4E2A\u6570\u636E\u6E90\uFF08\u4E0D\u4FDD\u5B58\uFF09\uFF0C\u8FD4\u56DE\u771F\u5B9E\u8F93\u51FA\u3002\u5199\u9762\u677F\u811A\u672C\u524D\u5148\u7528\u5B83\u770B\u6E05\u8F93\u51FA\u683C\u5F0F\u3002\u9700\u8981\u7528\u6237\u5141\u8BB8\u3002",
    parameters: { source: { ...sourceItem, required: true } },
    output: textOutput,
    async execute(args, exec) {
      const probe = validate({ title: "test", html: "", css: "", script: "", height: "auto", sources: [{ intervalSec: limits.minIntervalSec, ...args.source }] });
      const source = probe.sources[0];
      if (!await askToRun(exec, "pad_test_source", "\u8BD5\u8DD1\u6570\u636E\u6E90", [source])) throw new Error("\u7528\u6237\u6CA1\u6709\u5141\u8BB8\u8FD0\u884C\u8FD9\u4E2A\u6570\u636E\u6E90");
      const reading = await runSource(source, resolveSecret, exec.signal);
      return reading.ok ? `\u2713 \u7528\u65F6 ${reading.durationMs}ms\uFF0C\u8F93\u51FA\uFF1A
${sample(reading.value)}` : `\u2717 ${reading.error}`;
    }
  })), "dsh-pad: pad_test_source");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_models",
    description: "\u5217\u51FA\u53EF\u7528\u4E8E\u8FD9\u5F20\u9762\u677F\u7684 provider / \u6A21\u578B / \u63A8\u7406\u5F3A\u5EA6\uFF0C\u4EE5\u53CA\u5F53\u524D\u5168\u5C40\u9ED8\u8BA4\u6A21\u578B\u3002\u7ED9\u9762\u677F\u9876\u5C42 model \u9009\u503C\u65F6\u5148\u8C03\u7528\u5B83\u3002",
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute() {
      return JSON.stringify(await modelCatalog(ctx), null, 2);
    }
  })), "dsh-pad: pad_models");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_create",
    description: `\u5728\u60AC\u6D6E\u9762\u677F\u575E\u91CC\u65B0\u5EFA\u4E00\u5F20\u9762\u677F\u3002

${PANEL_GUIDE}`,
    parameters: {
      title: { type: "string", required: true, description: "\u7B80\u77ED\u6807\u9898\uFF08\u226440 \u5B57\uFF09" },
      icon: { type: "string", description: "\u4E00\u4E2A emoji" },
      html: { type: "string", required: true, description: "\u9762\u677F body \u5185\u7684 HTML" },
      css: { type: "string", description: "\u9762\u677F\u6837\u5F0F\uFF0C\u7528 --pad-* \u53D8\u91CF" },
      script: { type: "string", description: "\u9762\u677F\u811A\u672C\uFF0C\u7528 dsh.onData \u6E32\u67D3" },
      height: { oneOf: [{ type: "string", enum: ["auto"] }, { type: "integer" }], description: '"auto"\uFF08\u9ED8\u8BA4\uFF0C\u8DDF\u968F\u5185\u5BB9\uFF09\u6216\u56FA\u5B9A\u50CF\u7D20\u9AD8\u5EA6' },
      sources: { type: "array", items: sourceItem, description: "\u76F4\u63A5\u6570\u636E\u6E90\uFF08\u53EF\u4EE5\u4E3A\u7A7A\uFF09" },
      model: modelSelection,
      agent: agentBlock,
      data: { type: "json", description: "AI \u5237\u65B0\u9762\u677F\u7684\u7B2C\u4E00\u7248\u6570\u636E\uFF08\u4F60\u521A\u53D6\u5230\u7684\u771F\u5B9E\u6570\u636E\uFF09" }
    },
    output: textOutput,
    async execute(args, exec) {
      const definition = validate({ css: "", script: "", height: "auto", sources: [], ...args });
      if (definition.model) await assertModel(ctx, definition.model);
      const duplicate = store.list().find((p) => p.definition.title === definition.title);
      let panel = await store.create(definition, args.data);
      if (!store.approved(panel) && await askToRun(exec, "pad_create", definition.title, definition.sources)) {
        await store.approve(panel.id, sourcesFingerprint(definition.sources));
        panel = store.get(panel.id);
      }
      const lines = [`\u5DF2\u521B\u5EFA\u9762\u677F ${panel.id}\u300C${definition.title}\u300D\uFF0C\u5DF2\u7ECF\u51FA\u73B0\u5728\u60AC\u6D6E\u9762\u677F\u575E\u3002`];
      if (duplicate) lines.push(`\u6CE8\u610F\uFF1A\u5DF2\u6709\u540C\u540D\u9762\u677F ${duplicate.id}\uFF0C\u5982\u679C\u662F\u91CD\u590D\u521B\u5EFA\u8BF7\u7528 pad_delete \u5220\u6389\u4E00\u5F20\u3002`);
      lines.push(...await firstReadings(panel));
      if (definition.agent && args.data === void 0) lines.push("\u63D0\u9192\uFF1AAI \u5237\u65B0\u9762\u677F\u6CA1\u6709\u4EA4\u7B2C\u4E00\u7248 data\uFF0C\u9762\u677F\u5728\u7B2C\u4E00\u6B21\u540E\u53F0\u5237\u65B0\u524D\u662F\u7A7A\u7684\u3002\u6700\u597D\u73B0\u5728\u53D6\u4E00\u6B21\u771F\u5B9E\u6570\u636E\uFF0C\u7528 pad_update \u7684 data \u8865\u4E0A\u3002");
      return lines.join("\n");
    }
  })), "dsh-pad: pad_create");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_update",
    description: "\u4FEE\u6539\u5DF2\u6709\u9762\u677F\uFF1A\u53EA\u4F20\u8981\u6539\u7684\u5B57\u6BB5\uFF0C\u5176\u4F59\u4FDD\u6301\u4E0D\u53D8\uFF08model \u4F20\u5BF9\u8C61\u66FF\u6362\u8FD9\u5F20\u9762\u677F\u7684\u6A21\u578B\uFF0C\u4F20 null \u8DDF\u968F\u9ED8\u8BA4\uFF1Bagent \u4F20\u5BF9\u8C61\u65F6\u6574\u4F53\u66FF\u6362\uFF0Cagent \u4F20 null \u8868\u793A\u53D6\u6D88 AI \u5237\u65B0\uFF09\u3002\u4E5F\u53EF\u4EE5\u53EA\u4F20 data \u66F4\u65B0 AI \u5237\u65B0\u9762\u677F\u7684\u6570\u636E\u3002\u6539\u52A8\u540E\u7528\u6237\u53EF\u4EE5\u5728\u9762\u677F\u83DC\u5355\u91CC\u64A4\u9500\u3002",
    parameters: {
      id: { type: "string", required: true, description: "\u9762\u677F id" },
      title: { type: "string" },
      icon: { type: "string" },
      html: { type: "string" },
      css: { type: "string" },
      script: { type: "string" },
      height: { oneOf: [{ type: "string", enum: ["auto"] }, { type: "integer" }] },
      sources: { type: "array", items: sourceItem, description: "\u4F20\u4E86\u5C31\u6574\u4F53\u66FF\u6362\u6570\u636E\u6E90\u5217\u8868" },
      model: { oneOf: [modelSelection, { type: "null" }] },
      agent: { oneOf: [agentBlock, { type: "null" }] },
      data: { type: "json", description: "\u65B0\u7684 AI \u5237\u65B0\u6570\u636E" }
    },
    output: textOutput,
    async execute(args, exec) {
      const current = store.get(args.id);
      const { id, data, ...fields } = args;
      const changesDefinition = Object.keys(fields).length > 0;
      if (!changesDefinition) {
        if (data === void 0) throw new Error("\u6CA1\u6709\u8981\u6539\u7684\u5B57\u6BB5");
        await store.setAgentData(id, data);
        hub.pushData(id);
        return `\u5DF2\u66F4\u65B0\u9762\u677F\u300C${current.definition.title}\u300D\u7684\u6570\u636E\u3002`;
      }
      const definition = validate({ ...current.definition, ...fields });
      if (definition.model) await assertModel(ctx, definition.model);
      let panel = await store.update(id, definition, data);
      if (!store.approved(panel) && await askToRun(exec, "pad_update", definition.title, definition.sources)) {
        await store.approve(panel.id, sourcesFingerprint(definition.sources));
        panel = store.get(panel.id);
      }
      const sourcesChanged = sourcesFingerprint(current.definition.sources) !== sourcesFingerprint(definition.sources);
      return [
        `\u5DF2\u66F4\u65B0\u9762\u677F ${panel.id}\u300C${definition.title}\u300D\uFF08\u7248\u672C ${panel.version}\uFF09\u3002`,
        ...sourcesChanged ? await firstReadings(panel) : []
      ].join("\n");
    }
  })), "dsh-pad: pad_update");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_refresh",
    description: "\u7ACB\u5373\u5237\u65B0\u4E00\u5F20\u9762\u677F\uFF1A\u76F4\u63A5\u6570\u636E\u6E90\u4F1A\u9A6C\u4E0A\u91CD\u8DD1\u5E76\u8FD4\u56DE\u8BFB\u6570\uFF1BAI \u5237\u65B0\u9762\u677F\u4F1A\u6392\u8FDB\u540E\u53F0\u5237\u65B0\u3002\u7528\u6237\u8BF4\u9762\u677F\u574F\u4E86 / \u8FC7\u671F\u65F6\uFF0C\u4FEE\u5B8C\u540E\u7528\u5B83\u9A8C\u8BC1\u3002",
    parameters: { id: { type: "string", required: true, description: "\u9762\u677F id" } },
    output: textOutput,
    async execute(args) {
      const panel = store.get(args.id);
      const lines = [];
      if (panel.definition.agent) {
        refresher?.request(panel.id);
        lines.push(refresher ? "\u5DF2\u5B89\u6392\u540E\u53F0 AI \u5237\u65B0\uFF0C\u5B8C\u6210\u540E\u9762\u677F\u4F1A\u81EA\u52A8\u66F4\u65B0\u3002" : "\u8FD9\u4E2A dsh \u6CA1\u6709 agent \u670D\u52A1\uFF0CAI \u5237\u65B0\u4E0D\u53EF\u7528\u3002");
      }
      lines.push(...await firstReadings(panel));
      return lines.join("\n") || "\u8FD9\u5F20\u9762\u677F\u6CA1\u6709\u6570\u636E\u6E90\u3002";
    }
  })), "dsh-pad: pad_refresh");
  ctx.effect(() => ctx.tools.register(defineTool2({
    name: "pad_delete",
    description: "\u5220\u9664\u4E00\u5F20\u9762\u677F\uFF08\u7528\u6237\u660E\u786E\u8981\u5220\u65F6\u624D\u7528\uFF09\u3002",
    parameters: { id: { type: "string", required: true, description: "\u9762\u677F id" } },
    output: textOutput,
    async execute(args) {
      const panel = store.get(args.id);
      await store.remove(args.id);
      return `\u5DF2\u5220\u9664\u9762\u677F\u300C${panel.definition.title}\u300D\u3002`;
    }
  })), "dsh-pad: pad_delete");
}

// src/host/update.ts
import { existsSync } from "node:fs";
import { copyFile, mkdir as mkdir4, readFile as readFile3, rename as rename3, rm, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname3, join } from "node:path";
var REPO = "ChisaAlter/dsh-pad";
var RELEASE_FEED = `https://github.com/${REPO}/releases.atom`;
var RAW_ROOT = `https://raw.githubusercontent.com/${REPO}`;
var REQUEST_TIMEOUT_MS = 15e3;
var FIRST_CHECK_DELAY_MS = 7e3;
var UPDATE_FILES = ["lib/index.js", "lib/client.js", "package.json", "cordis.patch.yml"];
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (match === null) return void 0;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    ...match[4] === void 0 ? {} : { pre: match[4] }
  };
}
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === void 0 || b === void 0) return 0;
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === void 0) return 1;
  if (b.pre === void 0) return -1;
  return a.pre < b.pre ? -1 : 1;
}
var UpdateService = class {
  state;
  current;
  root;
  enabled;
  checkHours;
  fetchImpl;
  source;
  tag;
  applied;
  checking;
  applying;
  firstTimer;
  interval;
  constructor(options) {
    this.current = options.current;
    this.root = options.root;
    this.enabled = options.enabled;
    this.checkHours = Math.max(1, options.checkHours);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.source = existsSync(join(this.root, ".git"));
    this.state = {
      current: this.current,
      available: false,
      canApply: false,
      reason: this.enabled ? "unchecked" : "disabled"
    };
  }
  start() {
    if (!this.enabled || this.firstTimer !== void 0) return;
    this.firstTimer = setTimeout(() => {
      void this.check();
    }, FIRST_CHECK_DELAY_MS);
    this.firstTimer.unref?.();
    this.interval = setInterval(() => {
      void this.check(true);
    }, this.checkHours * 60 * 60 * 1e3);
    this.interval.unref?.();
  }
  dispose() {
    if (this.firstTimer !== void 0) clearTimeout(this.firstTimer);
    if (this.interval !== void 0) clearInterval(this.interval);
    this.firstTimer = void 0;
    this.interval = void 0;
  }
  info() {
    return this.state;
  }
  /** Cached info, or a check the first time the dock asks. */
  async ensure() {
    if (!this.enabled || this.applied !== void 0 || this.state.checkedAt !== void 0) return this.state;
    return this.check();
  }
  async check(force = false) {
    if (!this.enabled || this.applied !== void 0) return this.state;
    if (this.checking !== void 0) return this.checking;
    if (!force && this.state.checkedAt !== void 0 && Date.now() - Date.parse(this.state.checkedAt) < this.checkHours * 60 * 60 * 1e3) {
      return this.state;
    }
    this.checking = this.fetchLatest().finally(() => {
      this.checking = void 0;
    });
    return this.checking;
  }
  async fetchLatest() {
    try {
      const response = await this.fetchImpl(RELEASE_FEED, {
        headers: {
          accept: "application/atom+xml",
          "user-agent": `dsh-pad/${this.current}`
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`GitHub ${response.status}`);
      const xml = await response.text();
      const match = /<entry>[\s\S]*?<link[^>]+href="([^"]+\/releases\/tag\/([^"/]+))"/.exec(xml);
      const tag = match?.[2] ?? "";
      const url = match?.[1] ?? `https://github.com/${REPO}/releases`;
      const latest = tag.replace(/^v/i, "");
      const available = latest !== "" && compareVersions(latest, this.current) > 0;
      this.tag = tag;
      this.state = {
        current: this.current,
        latest: latest === "" ? void 0 : latest,
        available,
        canApply: available && !this.source,
        reason: available ? this.source ? "source" : "available" : "up-to-date",
        url,
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch (error) {
      this.state = {
        ...this.state,
        available: false,
        canApply: false,
        reason: "error",
        checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return this.state;
  }
  /** Download the release's built files and replace this plugin in place. */
  async apply() {
    if (this.applying !== void 0) return this.applying;
    if (this.applied !== void 0) return { ok: true, update: this.state };
    this.applying = this.replaceFiles().finally(() => {
      this.applying = void 0;
    });
    return this.applying;
  }
  async replaceFiles() {
    const latest = this.state.latest;
    if (!this.state.available || latest === void 0 || this.tag === void 0) {
      return { ok: false, update: this.state, error: this.state.reason === "source" ? "source" : "no-update" };
    }
    if (this.source) {
      return { ok: false, update: this.state, error: "source" };
    }
    const contents = /* @__PURE__ */ new Map();
    try {
      const fetched = await Promise.all(UPDATE_FILES.map(async (file) => {
        const response = await this.fetchImpl(`${RAW_ROOT}/${encodeURIComponent(this.tag ?? "")}/${file}`, {
          headers: { "user-agent": `dsh-pad/${this.current}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`${file}: GitHub ${response.status}`);
        return [file, await response.text()];
      }));
      for (const [file, content] of fetched) contents.set(file, content);
    } catch (error) {
      return this.fail(`\u4E0B\u8F7D\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const manifest = JSON.parse(contents.get("package.json") ?? "");
      if (manifest.name !== "dsh-pad" || manifest.version !== latest) {
        throw new Error("release manifest does not match dsh-pad@" + latest);
      }
      if ((contents.get("lib/index.js") ?? "").length < 1e3 || (contents.get("lib/client.js") ?? "").length < 1e3) {
        throw new Error("release bundles are incomplete");
      }
    } catch (error) {
      return this.fail(`\u6821\u9A8C\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    const backup = join(this.root, ".dsh-pad-update-backup", (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"));
    try {
      await mkdir4(backup, { recursive: true });
      for (const file of UPDATE_FILES) {
        const target = join(this.root, file);
        if (existsSync(target)) {
          await mkdir4(dirname3(join(backup, file)), { recursive: true });
          await copyFile(target, join(backup, file));
        }
      }
      for (const file of UPDATE_FILES) {
        const content = contents.get(file);
        if (content === void 0) continue;
        const target = join(this.root, file);
        await mkdir4(dirname3(target), { recursive: true });
        const temp = `${target}.update-${process.pid}`;
        await writeFile3(temp, content, "utf8");
        try {
          await rename3(temp, target);
        } catch {
          await rm(target, { force: true });
          await rename3(temp, target);
        }
      }
    } catch (error) {
      await this.restore(backup);
      return this.fail(`\u5199\u5165\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    this.applied = latest;
    this.state = {
      ...this.state,
      available: false,
      canApply: false,
      reason: "applied",
      applied: latest,
      requiresRestart: true,
      error: void 0
    };
    return { ok: true, update: this.state };
  }
  async restore(backup) {
    for (const file of UPDATE_FILES) {
      const saved = join(backup, file);
      const target = join(this.root, file);
      try {
        if (existsSync(saved)) await copyFile(saved, target);
        else await rm(target, { force: true });
      } catch {
      }
    }
  }
  fail(error) {
    this.state = { ...this.state, error };
    return { ok: false, update: this.state, error };
  }
};
async function readPluginVersion(root) {
  try {
    const manifest = JSON.parse(await readFile3(join(root, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// src/index.ts
var name = "dsh-pad";
var inject = ["tools", "connection"];
var Config = Schema.object({
  dataFile: Schema.string().description("\u9762\u677F\u5B58\u50A8\u6587\u4EF6\uFF0C\u9ED8\u8BA4 $DSH_HOME/dsh-pad/panels.json"),
  autoApprove: Schema.boolean().default(false).description("\u65B0\u5EFA\u6216\u4FEE\u6539\u6570\u636E\u6E90\u65F6\u4E0D\u518D\u8BE2\u95EE\uFF0C\u76F4\u63A5\u8FD0\u884C"),
  minIntervalSec: Schema.natural().min(1).default(2).description("\u76F4\u63A5\u6570\u636E\u6E90\u7684\u6700\u77ED\u5237\u65B0\u95F4\u9694\uFF08\u79D2\uFF09"),
  agentRefresh: Schema.boolean().default(true).description("\u5141\u8BB8\u7531\u540E\u53F0 AI \u5B9A\u65F6\u5237\u65B0\u7684\u9762\u677F"),
  minAgentMinutes: Schema.natural().min(1).default(15).description("AI \u5237\u65B0\u7684\u6700\u77ED\u95F4\u9694\uFF08\u5206\u949F\uFF09"),
  agentTimeoutSec: Schema.natural().min(30).default(300).description("\u4E00\u6B21 AI \u5237\u65B0\u6700\u591A\u7528\u591A\u4E45\uFF08\u79D2\uFF09"),
  agentConcurrency: Schema.natural().min(1).default(1).description("\u540C\u65F6\u8FDB\u884C\u7684 AI \u5237\u65B0\u6570"),
  agentRetryMinutes: Schema.natural().min(1).default(15).description("AI \u5237\u65B0\u5931\u8D25\u540E\u591A\u4E45\u91CD\u8BD5\uFF08\u5206\u949F\uFF09"),
  interactiveModel: Schema.boolean().default(true).description("\u5141\u8BB8\u9762\u677F\u91CC\u7684\u6309\u94AE\u901A\u8FC7 dsh.run \u8C03\u7528\u8FD9\u5F20\u9762\u677F\u7684\u6A21\u578B"),
  runTimeoutSec: Schema.natural().min(5).max(300).default(120).description("\u4E00\u6B21 dsh.run \u6700\u591A\u7528\u591A\u4E45\uFF08\u79D2\uFF09"),
  runMaxTokens: Schema.natural().min(128).default(2048).description("\u4E00\u6B21 dsh.run \u6700\u591A\u751F\u6210\u591A\u5C11 token"),
  runConcurrency: Schema.natural().min(1).max(8).default(2).description("\u540C\u4E00\u5F20\u9762\u677F\u540C\u65F6\u8FDB\u884C\u7684 dsh.run \u6570\u91CF"),
  updateCheck: Schema.boolean().default(true).description("\u542F\u52A8\u540E\u5728\u540E\u53F0\u68C0\u67E5 dsh-pad \u7684 GitHub \u6700\u65B0 Release"),
  updateCheckHours: Schema.natural().min(1).max(168).default(6).description("\u81EA\u52A8\u68C0\u67E5\u66F4\u65B0\u7684\u95F4\u9694\uFF08\u5C0F\u65F6\uFF09")
});
function defaultDataFile() {
  const home = process.env["DSH_HOME"] || join2(homedir(), ".dsh");
  return join2(home, "dsh-pad", "panels.json");
}
async function apply(ctx, config) {
  try {
    await start(ctx, config);
  } catch (error) {
    console.error("[dsh-pad] \u63D2\u4EF6\u542F\u52A8\u5931\u8D25\uFF0C\u9762\u677F\u575E\u5DF2\u7981\u7528\uFF0Cdsh \u7EE7\u7EED\u542F\u52A8\u3002\u5728\u63D2\u4EF6\u76EE\u5F55\u8FD0\u884C `node scripts/doctor.mjs` \u81EA\u68C0\uFF1A", error);
  }
}
async function start(ctx, config) {
  const dataFile = config.dataFile ?? defaultDataFile();
  const store = new PanelStore(dataFile, config.autoApprove);
  await store.load();
  const cache = new ReadingCache(join2(dirname4(dataFile), "readings.json"));
  const restored = await cache.load(store.list());
  const resolveSecret = async (name2) => {
    const credentials = ctx.get("credentials");
    if (credentials !== void 0) {
      try {
        const resolved = await credentials.resolve(name2);
        if (resolved !== void 0) return resolved.value;
      } catch {
      }
    }
    return process.env[name2];
  };
  let refresher;
  const hub = new DataHub(store, resolveSecret, (panelId) => refresher?.request(panelId), { restored, cache });
  if (config.agentRefresh) {
    refresher = new AgentRefresher(ctx, store, {
      timeoutMs: config.agentTimeoutSec * 1e3,
      concurrency: config.agentConcurrency,
      retryMinutes: config.agentRetryMinutes,
      workDir: join2(dirname4(dataFile), "refresh")
    }, (panelId) => hub.pushData(panelId));
  }
  ctx.effect(() => store.onChange(() => hub.storeChanged()), "dsh-pad: store observer");
  ctx.effect(() => {
    refresher?.start();
    return () => {
      refresher?.stop();
      hub.dispose();
      cache.dispose();
    };
  }, "dsh-pad: schedulers");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const update = new UpdateService({
    current: await readPluginVersion(root),
    root,
    enabled: config.updateCheck,
    checkHours: config.updateCheckHours
  });
  ctx.effect(() => {
    update.start();
    return () => update.dispose();
  }, "dsh-pad: updater");
  registerRoutes({
    ctx,
    store,
    hub,
    refresher,
    update,
    runOptions: {
      enabled: config.interactiveModel,
      timeoutMs: config.runTimeoutSec * 1e3,
      maxTokens: config.runMaxTokens,
      concurrency: config.runConcurrency,
      maxPromptChars: 24e3,
      maxSystemChars: 8e3,
      maxOutputChars: 32e3,
      minIntervalMs: 1e3
    }
  });
  registerTools({
    ctx,
    store,
    hub,
    refresher,
    limits: { minIntervalSec: config.minIntervalSec, minAgentMinutes: config.minAgentMinutes },
    autoApprove: config.autoApprove,
    resolveSecret
  });
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
