import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonIfExists } from "../src/config/paths.js";
import {
  mergeUiPrefs,
  prefsFile,
  readUiPrefs,
  SETUP_CHOICE_PROMPT,
} from "../src/config/ui-prefs.js";
import { cleanup, isolateStateDir } from "./helpers.js";

describe("ui prefs", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) cleanup(dir);
    dirs.length = 0;
    delete process.env.D2C_STATE_DIR;
  });

  it("starts empty and is not bound to a workspace", () => {
    dirs.push(isolateStateDir());
    const prefs = readUiPrefs();
    expect(prefs.developerModeEnabled).toBe(false);
    expect(prefs.setupMode).toBeNull();
    expect(prefs.remembered).toEqual({ developerMode: false, setupMode: false });
    expect(prefs.setupChoicePrompt).toBe(SETUP_CHOICE_PROMPT);
    expect(prefs.setupChoicePrompt).toContain("AI 自动化配置（预览版）");
    expect(prefs.setupChoicePrompt).toContain("手动教学配置");
    expect(prefs.setupChoicePrompt).toContain("请回复「1」或「2」");
  });

  it("remembers developer mode as on only, never as off", () => {
    dirs.push(isolateStateDir());
    const saved = mergeUiPrefs({ developerModeEnabled: true });
    expect(saved.developerModeEnabled).toBe(true);
    const raw = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) as { developerModeEnabled?: boolean };
    expect(raw.developerModeEnabled).toBe(true);
    expect(JSON.stringify(raw)).not.toMatch(/token|pairing|secret/i);
  });

  it("saves setup mode without dropping developer mode", () => {
    dirs.push(isolateStateDir());
    mergeUiPrefs({ developerModeEnabled: true });
    const next = mergeUiPrefs({ setupMode: "manual" });
    expect(next.developerModeEnabled).toBe(true);
    expect(next.setupMode).toBe("manual");
    const auto = mergeUiPrefs({ setupMode: "auto" });
    expect(auto.setupMode).toBe("auto");
    expect(auto.developerModeEnabled).toBe(true);
  });

  it("rejects an unknown setup mode", () => {
    dirs.push(isolateStateDir());
    expect(() => mergeUiPrefs({ setupMode: "browser" as "auto" })).toThrow(/setup-mode/);
    expect(readUiPrefs().setupMode).toBeNull();
  });

  it("ignores a hand-edited developerModeEnabled false", () => {
    dirs.push(isolateStateDir());
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(
      prefsFile(),
      JSON.stringify({ developerModeEnabled: false, setupMode: "auto", updatedAt: "2026-01-01T00:00:00.000Z" }),
      { mode: 0o600 }
    );
    expect(readUiPrefs().developerModeEnabled).toBe(false);
    expect(readUiPrefs().remembered.developerMode).toBe(false);
    expect(readUiPrefs().setupMode).toBe("auto");
  });

  it("does not overwrite malformed saved preferences", () => {
    dirs.push(isolateStateDir());
    const original = '{"developerModeEnabled": true,';
    fs.writeFileSync(prefsFile(), original);

    expect(() => mergeUiPrefs({ setupMode: "manual" })).toThrow(SyntaxError);
    expect(fs.readFileSync(prefsFile(), "utf8")).toBe(original);
  });

  it("only returns null when a JSON file is absent", () => {
    dirs.push(isolateStateDir());
    expect(readJsonIfExists(prefsFile())).toBeNull();
    fs.mkdirSync(prefsFile());
    expect(() => readJsonIfExists(prefsFile())).toThrow();
    expect(fs.statSync(prefsFile()).isDirectory()).toBe(true);
  });

  it("propagates a file access failure instead of treating it as absent", () => {
    const failure = Object.assign(new Error("read denied"), { code: "EACCES" });
    const read = vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => { throw failure; });
    try {
      expect(() => readJsonIfExists("denied.json")).toThrow(failure);
    } finally {
      read.mockRestore();
    }
  });
});
