'use strict';

/** Open the official Plugins panel and its Discover tab in the existing page. */
function buildMarketplaceScript() {
  return `
    (() => {
      document.querySelector('[data-dsh-settings-close]')?.click();
      const panel = document.querySelector('[data-dsh-panel="plugins"]');
      if (!panel) return false;
      panel.click();
      const pick = () => document.querySelector('[data-plugin-panel] [role="tab"][id$="-discover"]');
      const found = pick();
      if (found) { found.click(); return true; }
      return new Promise(resolve => {
        const cap = setTimeout(() => { observer.disconnect(); resolve(false); }, 5000);
        const select = () => {
          const tab = pick();
          if (tab) {
            observer.disconnect(); clearTimeout(cap); tab.click(); resolve(true);
          } else {
            document.querySelector('[data-plugin-panel] [data-plugin-back]')?.click();
          }
        };
        const observer = new MutationObserver(select);
        observer.observe(document.body, { childList: true, subtree: true });
        select();
      });
    })()
  `;
}

module.exports = { buildMarketplaceScript };
