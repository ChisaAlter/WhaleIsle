export const SETTINGS_CSS = `
/* ACP Master-Detail Provider & Account Settings */
.dsh-acp-settings {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 980px;
  padding: 6px 0 32px;
  color: var(--dsw-alias-label-primary);
  gap: 14px;
}
.dsh-acp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-header-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dsh-acp-banner {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 90;
  max-width: 360px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 18px;
  background: var(--dsw-alias-bg-layer-2, rgba(24,24,27,0.96));
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-banner[data-error="true"] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
  border-color: rgba(239, 68, 68, 0.35);
}
.dsh-acp-store-issue {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary, #ef4444);
  font-size: 14px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

/* Top 2-Column Agent Switcher Grid + Full-Width Selected Agent Detail Stack (fits 564px Settings .options) */
.dsh-acp-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}

.dsh-acp-rail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}
@media (max-width: 520px) {
  .dsh-acp-header { flex-wrap: wrap; }
  .dsh-acp-header-copy { flex-basis: 100%; }
  .dsh-acp-header-actions { flex-wrap: wrap; }
  .dsh-acp-rail {
    grid-template-columns: 1fr;
  }
}
.dsh-acp-rail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08));
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02));
  text-align: left;
  min-width: 0;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.dsh-acp-rail-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-rail-item[data-selected="true"] {
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.07));
  border-color: var(--dsw-alias-label-primary, rgba(255,255,255,0.45));
  box-shadow: 0 0 0 0.5px var(--dsw-alias-label-primary, rgba(255,255,255,0.25));
}
.dsh-acp-rail-item-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-rail-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dsh-acp-rail-name {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-rail-sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Full-Width Detail Stack */
.dsh-acp-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}
.dsh-acp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02));
  min-width: 0;
  box-sizing: border-box;
}
.dsh-acp-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.dsh-acp-card-header-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  flex: 1;
}
.dsh-acp-card-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-acp-card-title {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh-acp-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.dsh-acp-actions-slot {
  display: inline-flex;
  align-items: center;
}
.dsh-acp-card-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-cmd-bar {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.22);
  border: 0.5px solid var(--dsw-alias-border-l2);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-acp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06));
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-badge[data-tone="success"] {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.28);
}
.dsh-acp-badge[data-tone="warning"] {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.28);
}
.dsh-acp-badge[data-tone="plan"] {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
}

/* Account Info Grid */
.dsh-acp-account-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.03));
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-acp-account-user {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-account-email {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  border: 0.5px dashed var(--dsw-alias-border-l2);
}
.dsh-acp-account-email:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-account-msg {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
}

/* Auth method tabs */
.dsh-acp-auth-methods {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}
.dsh-acp-auth-method-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease;
}
.dsh-acp-auth-method-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-auth-method-card[data-active="true"] {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.06));
}
.dsh-acp-auth-method-title {
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-auth-method-desc {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
}

/* Live OAuth Flow Box */
.dsh-acp-flow-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.06);
}
.dsh-acp-flow-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-acp-flow-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-flow-code {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-flow-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-flow-url {
  flex: 1;
  min-width: 180px;
  padding: 5px 8px;
  border-radius: 6px;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  background: rgba(0, 0, 0, 0.2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-flow-logs {
  max-height: 90px;
  overflow-y: auto;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.dsh-acp-flow-terminal {
  max-height: 160px;
  overflow-y: auto;
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 0.5px solid var(--dsw-alias-border-l2);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
}
.dsh-acp-flow-callback {
  display: grid;
  gap: 6px;
}
.dsh-acp-field {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-field input.dsh-acp-raw-input {
  padding: 5px 8px;
  border-radius: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: rgba(0, 0, 0, 0.2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}

/* Models Manager */
.dsh-acp-models-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-models-toolbar-input {
  flex: 1;
  min-width: 180px;
}
.dsh-acp-models-list {
  display: flex;
  flex-direction: column;
  max-height: 290px;
  overflow-y: auto;
  border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  divide-y: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-model-row:last-child {
  border-bottom: none;
}
.dsh-acp-model-row[data-hidden="true"] {
  opacity: 0.52;
}
.dsh-acp-model-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-star-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-star-btn[data-fav="true"] {
  color: #f59e0b;
}
.dsh-acp-model-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-model-id {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-model-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Form fields & Env table */
.dsh-acp-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.dsh-acp-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dsh-acp-field-label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-settings-select {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
}
.dsh-acp-settings-select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh-acp-settings-select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.dsh-acp-env-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-acp-env-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(160px, 1.5fr) auto;
  gap: 8px;
  align-items: center;
}
.dsh-acp-meta-line {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}
.dsh-acp-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* ACP runtime Add-provider card picker */
.dsh-acp-provider-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.dsh-acp-provider-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  transition: background 120ms ease, border-color 120ms ease;
}
.dsh-acp-provider-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-provider-card[data-selected="true"] {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.06));
}
.dsh-acp-provider-icon {
  position: relative;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.06));
  overflow: hidden;
}
.dsh-acp-provider-icon-letter {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-provider-icon img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--dsw-alias-bg-primary, transparent);
}
.dsh-acp-provider-name {
  font-size: 12.5px;
  line-height: 17px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-provider-check {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-showmore {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 2px 0;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-acp-showmore:hover {
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-showmore[data-open="true"] svg {
  transform: rotate(180deg);
}
.dsh-acp-registry {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-acp-registry-grid {
  max-height: 224px;
  overflow-y: auto;
  padding-right: 2px;
}
.dsh-acp-registry-hint {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  padding: 8px 2px;
}

.dsh-acp-session-options { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 6px; }
.dsh-acp-session-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 20px; }
.dsh-acp-session-option > select { width: auto; max-width: 60%; }
.dsh-acp-session-option > input { accent-color: var(--dsw-alias-state-business-primary); }

`;
