import { SETTINGS_CSS } from './styles-settings.js';
import { PICKER_CSS, DELEGATION_CSS } from './styles-picker.js';

export function injectCss() {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('dsh-acp-agents-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dsh-acp-agents-styles';
    document.head.appendChild(style);
  }
  style.textContent = SETTINGS_CSS + PICKER_CSS + DELEGATION_CSS;
}
