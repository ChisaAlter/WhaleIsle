import { SETTINGS_CSS } from './styles-settings.js';
import { PICKER_CSS, DELEGATION_CSS } from './styles-picker.js';

const STYLE_ELEMENT_ID = 'dsh-acp-agents-styles';
let styleRefCount = 0;

export function injectCss() {
  if (typeof document === 'undefined') return () => {};
  let style = document.getElementById(STYLE_ELEMENT_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = SETTINGS_CSS + PICKER_CSS + DELEGATION_CSS;
  styleRefCount += 1;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    styleRefCount = Math.max(0, styleRefCount - 1);
    if (styleRefCount === 0) {
      const node = document.getElementById?.(STYLE_ELEMENT_ID) ?? style;
      if (typeof node?.remove === 'function') node.remove();
      else node?.parentNode?.removeChild?.(node);
    }
  };
}
