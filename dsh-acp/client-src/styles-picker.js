export const PICKER_CSS = `
/* ACP ProviderModelPicker Composer Selector */
.dsh-acp-ms-root {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.dsh-acp-ms-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: 360px;
  padding: 0 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}
.dsh-acp-ms-trigger:hover:not(:disabled),
.dsh-acp-ms-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-ms-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-acp-ms-trigger-agent {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.14);
  border: 0.5px solid rgba(59, 130, 246, 0.32);
}
.dsh-acp-ms-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-trigger-effort {
  display: inline-grid;
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.05));
}
.dsh-acp-ms-effort-reserve,
.dsh-acp-ms-effort-caption {
  grid-area: 1 / 1;
}
.dsh-acp-ms-effort-reserve {
  visibility: hidden;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}
.dsh-acp-ms-trigger-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
}
.dsh-acp-ms-chevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 160ms ease;
}
.dsh-acp-ms-chevron-open {
  transform: rotate(180deg);
}
.dsh-acp-ms-initial-label {
  display: inline-grid;
}
.dsh-acp-ms-initial-reserve {
  grid-area: 1 / 1;
  visibility: hidden;
  pointer-events: none;
  height: 0;
  overflow: hidden;
}
.dsh-acp-ms-initial-caption {
  grid-area: 1 / 1;
}
.dsh-acp-ms-menu {
  position: fixed;
  z-index: 1200;
  width: 620px;
  max-width: calc(100vw - 24px);
  height: 480px;
  max-height: calc(100vh - 24px);
  padding: 0;
  display: flex;
  flex-direction: row;
  gap: 0;
  overflow: hidden;
}

/* Left Agent Rail (replaces horizontal tabs) */
.dsh-acp-ms-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 46px;
  flex-shrink: 0;
  padding: 8px 6px;
  border-right: 0.5px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  overflow-x: hidden;
}
.dsh-acp-ms-rail-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.2px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
.dsh-acp-ms-rail-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-ms-rail-btn[data-active="true"] {
  background: rgba(59, 130, 246, 0.15);
  box-shadow: inset 0 0 0 0.5px rgba(59, 130, 246, 0.45);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-ms-rail-btn[data-enabled="false"] {
  opacity: 0.5;
}
.dsh-acp-ms-rail-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.45;
}
.dsh-acp-ms-rail-dot[data-enabled="true"] {
  background: #10b981;
  opacity: 1;
}

/* Center Column: Search + Flat Model List */
.dsh-acp-ms-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 10px 10px 8px;
}
.dsh-acp-ms-groups {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  gap: 1px;
  padding-right: 2px;
}
.dsh-acp-ms-cat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dsh-acp-ms-cat[data-disabled="true"] {
  opacity: 0.72;
}
.dsh-acp-ms-cat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 3px;
}
.dsh-acp-ms-cat-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-ms-cat-kind {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
  background: rgba(255, 255, 255, 0.08);
}
.dsh-acp-ms-cat-kind[data-acp="true"] {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.16);
}
.dsh-acp-ms-cat-title {
  font-size: 12.5px;
  line-height: 17px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-cat-vendor {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-cat-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.dsh-acp-ms-cat-enable-slot {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}
.dsh-acp-ms-cat-enable {
  border: 0.5px solid rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.14);
  color: #60a5fa;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  cursor: pointer;
  min-width: 62px;
  text-align: center;
}
.dsh-acp-ms-cat-enable:hover {
  background: rgba(59, 130, 246, 0.24);
}
.dsh-acp-ms-cat-count {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}

.dsh-acp-ms-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.dsh-acp-ms-option:hover,
.dsh-acp-ms-option:focus-visible,
.dsh-acp-ms-option[data-active="true"] {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-ms-option[aria-checked="true"] {
  background: rgba(59, 130, 246, 0.1);
}
.dsh-acp-ms-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh-acp-ms-option-copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-ms-option-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-option-sub {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 10.5px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 140px;
}
.dsh-acp-ms-kbd {
  flex-shrink: 0;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  padding: 1px 5px;
  border-radius: 4px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.04));
}
.dsh-acp-ms-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #60a5fa;
}
.dsh-acp-ms-divider {
  height: 0.5px;
  margin: 2px 4px;
  background: var(--dsw-alias-border-l2);
}
.dsh-acp-ms-search-row {
  position: relative;
  display: flex;
  align-items: center;
}
.dsh-acp-ms-search {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.dsh-acp-ms-search-with-query {
  padding-right: 26px;
}
.dsh-acp-ms-search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  padding: 2px;
  border-radius: 4px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  display: inline-flex;
}
.dsh-acp-ms-search-clear:hover,
.dsh-acp-ms-search-clear:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-ms-empty {
  padding: 12px 8px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

/* Right Aside: Current Selection + Effort Options + Manage */
.dsh-acp-ms-aside {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 216px;
  box-sizing: border-box;
  flex-shrink: 0;
  padding: 10px 12px;
  border-left: 0.5px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.dsh-acp-ms-aside > * {
  flex-shrink: 0;
}
.dsh-acp-ms-aside-title {
  font-size: 11px;
  line-height: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-ms-aside-model {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-aside-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-ms-aside-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dsh-acp-ms-boolean-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
}
.dsh-acp-ms-aside-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 17px;
  text-align: left;
  cursor: pointer;
}
.dsh-acp-ms-aside-option:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-ms-aside-option[data-active="true"] {
  background: rgba(59, 130, 246, 0.1);
}
.dsh-acp-ms-aside-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh-acp-ms-aside-option-check {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #60a5fa;
}
.dsh-acp-ms-aside-divider {
  height: 0.5px;
  background: var(--dsw-alias-border-l2);
}
.dsh-acp-ms-aside-foot {
  margin-top: auto;
  padding-top: 8px;
}
.dsh-acp-ms-manage-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 16px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.dsh-acp-ms-manage-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
@media (max-width: 560px) {
  .dsh-acp-ms-menu {
    flex-direction: column;
    height: min(620px, calc(100vh - 24px));
  }
  .dsh-acp-ms-rail {
    flex-direction: row;
    width: 100%;
    height: 48px;
    box-sizing: border-box;
    border-right: 0;
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
    overflow-x: auto;
  }
  .dsh-acp-ms-main {
    flex: 1 1 auto;
    min-height: 130px;
    max-height: 200px;
  }
  .dsh-acp-ms-aside {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    padding: 10px 8px;
    border-left: 0;
    border-top: 0.5px solid var(--dsw-alias-border-l2);
  }
}
`;

export const DELEGATION_CSS = `
.dsh-acp-child { margin: 4px 0; min-width: 0; color: var(--dsw-alias-label-primary); container-type: inline-size; }
.dsh-acp-child-open { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; height: 40px; padding: 4px 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 400; line-height: 20px; white-space: nowrap; }
.dsh-acp-child-open:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-acp-child-open:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 2px; }
.dsh-acp-child-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
.dsh-acp-child-icon img { display: block; width: 16px; height: 16px; object-fit: contain; filter: brightness(0); }
html[data-ds-theme-source="dark"] .dsh-acp-child-icon img { filter: brightness(0) invert(1); }
.dsh-acp-child-identity { display: flex; flex-direction: column; justify-content: center; flex: 0 1 176px; min-width: 0; }
.dsh-acp-child-agent { overflow: hidden; text-overflow: ellipsis; font-weight: 500; line-height: 17px; }
.dsh-acp-child-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 14px; }
.dsh-acp-child-task { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); }
.dsh-acp-child-status { display: inline-flex; align-items: center; flex-shrink: 0; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-acp-child-elapsed { flex-shrink: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.dsh-acp-child[data-status="failed"] .dsh-acp-child-status, .dsh-acp-child[data-status="failed"] .dsh-acp-child-task { color: var(--dsw-alias-state-error-primary); }
.dsh-acp-child-open > svg { flex-shrink: 0; color: var(--dsw-alias-label-secondary); }
@container (max-width: 480px) {
  .dsh-acp-child-identity { flex: 1; }
  .dsh-acp-child-task, .dsh-acp-child-elapsed, .dsh-acp-child-open > svg { display: none; }
}
`;
