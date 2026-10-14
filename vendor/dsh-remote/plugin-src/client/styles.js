// Stylesheet for the remote-workspace UI. Tags are claimed by the module
// loader's HMR bookkeeping through data-plugin, and data-plugin-css dedupes
// repeat installs.
const STYLE_ID = 'dsh-remote'

const CSS = `
.dshr-page { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dshr-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshr-cardTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px; }
.dshr-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshr-rowBetween { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dshr-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshr-grow { flex: 1; min-width: 0; }
.dshr-muted { color: var(--dsw-alias-label-tertiary); }
.dshr-secondary { color: var(--dsw-alias-label-secondary); }
.dshr-caption { color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); font-size: 12px; }
.dshr-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.5; }
.dshr-ok { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
.dshr-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshr-mono { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dshr-mono input { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dshr-iconBtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.dshr-iconBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshr-iconBtn:disabled { opacity: 0.4; cursor: not-allowed; }
.dshr-miniSpinner { display: inline-block; width: 10px; height: 10px; box-sizing: border-box; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dshr-feedback-spin .8s linear infinite; }
@keyframes dshr-feedback-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dshr-miniSpinner { animation: none; } }

.dshr-machineList { display: flex; flex-direction: column; gap: 6px; }
.dshr-machine { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dshr-machine[data-current="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.dshr-machineMeta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dshr-machineName { font-weight: 600; font-size: 13px; }
.dshr-machineSub { font-size: 12px; color: var(--dsw-alias-label-tertiary); display: flex; gap: 8px; flex-wrap: wrap; }

.dshr-form { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.dshr-formLabel { font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: right; }
.dshr-formFull { grid-column: 1 / -1; }
.dshr-checkRow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }

.dshr-flow { display: flex; flex-direction: column; min-height: 0; min-width: 0; flex: 1; color: var(--dsw-alias-label-primary); }
.dshr-flowContent { display: flex; flex-direction: column; gap: 12px; flex: 1 1 0; min-height: 0; overflow: auto; padding: 16px 24px; }
.dshr-flowContent > .dshr-row { flex: none; }
.dshr-flowContent .dshr-formLabel { flex: none; }
.dshr-flowContent .dshr-iconBtn { flex: none; }
.dshr-flowContent .dshr-list { min-height: 80px; max-height: none; }
.dshr-flowContent .dshr-emptyState { flex: 1; justify-content: center; }
.dshr-flowStatus { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 16px; text-align: center; overflow-wrap: anywhere; }
.dshr-flowFooter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: none; padding: 16px 24px; border-top: 0.5px solid var(--dsw-alias-border-l3); }
.dshr-flowActions { display: flex; gap: 8px; margin-left: auto; }
.dshr-flowActions > button { min-width: 72px; }
.dshr-crumbs { display: flex; align-items: center; gap: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; }
.dshr-crumb { cursor: pointer; padding: 1px 3px; border: none; background: transparent; color: inherit; font: inherit; border-radius: 4px; }
.dshr-crumb:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshr-crumbLast { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dshr-list { flex: 1; min-height: 140px; max-height: 280px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 4px; }
.dshr-listItem { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left; cursor: pointer; }
.dshr-listItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshr-listItem:disabled { cursor: default; }
.dshr-listItem[data-kind="file"] { color: var(--dsw-alias-label-tertiary); }
.dshr-listEmpty { padding: 18px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.dshr-tree { height: 100%; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column; }
.dshr-treeRow { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 4px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12.5px; text-align: left; cursor: pointer; }
.dshr-treeRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshr-treeRow[data-kind="file"] { color: var(--dsw-alias-label-secondary); }
.dshr-treeToggle { width: 14px; flex-shrink: 0; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dshr-treeName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshr-treeBadge { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); flex-shrink: 0; }

.dshr-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
.dshr-editorHead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 12px; }
.dshr-editorBody { flex: 1; overflow: auto; min-height: 0; display: flex; flex-direction: column; }
.dshr-editorText { flex: 1; width: 100%; box-sizing: border-box; border: none; outline: none; resize: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
.dshr-editorView { font-size: 13px; line-height: 1.55; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }

.dshr-audit { max-height: 220px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.dshr-emptyState { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dshr-warn { color: var(--dsw-alias-state-warn-primary); }
`

export function installRemoteStyles() {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-remote'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => style.remove()
}
