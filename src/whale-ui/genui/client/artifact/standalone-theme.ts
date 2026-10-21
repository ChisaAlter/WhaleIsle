/** standalone 页面使用的基础颜色和版面样式。 */
export const STANDALONE_THEME_CSS = `
:root {
  color-scheme: light;
  --dsh-font-family-text-default: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --dsw-font-family: var(--dsh-font-family-text-default);
  --dsh-font-family-code-default: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
  --ds-font-family-code: var(--dsh-font-family-code-default);
  --dsw-radius-xs: 4px;
  --dsw-radius-sm: 8px;
  --dsw-radius-md: 12px;
  --dsw-radius-button-sm: 14px;
  --dsw-radius-button: 18px;
  --ds-transition-duration: 0.2s;
  --ds-transition-duration-fast: 0.1s;
  --ds-transition-duration-slow: 0.3s;
  --dsw-shadow-lv1: 0 2px 4px 0 rgba(0, 0, 0, 0.05);
  --dsw-shadow-lv2: 0 4px 12px 0 rgba(0, 0, 0, 0.02), 0 2px 8px 0 rgba(0, 0, 0, 0.04);
  --dsw-shadow-lv3: 0 0 1px 0 rgba(0, 0, 0, 0.2), 0 0 4px 0 rgba(0, 0, 0, 0.02), 0 12px 32px 0 rgba(0, 0, 0, 0.08);
  --dsw-static-neutral-bluish-00: rgb(255, 255, 255);
  --dsw-static-neutral-bluish-50: rgb(249, 250, 251);
  --dsw-static-neutral-bluish-300: rgb(207, 211, 214);
  --dsw-static-neutral-bluish-400: rgb(173, 178, 184);
  --dsw-static-neutral-bluish-600: rgb(129, 133, 140);
  --dsw-static-neutral-bluish-700: rgb(97, 102, 107);
  --dsw-static-neutral-bluish-800: rgb(53, 54, 56);
  --dsw-static-neutral-bluish-850: rgb(44, 44, 46);
  --dsw-static-neutral-bluish-875: rgb(35, 35, 36);
  --dsw-static-neutral-bluish-900: rgb(27, 27, 28);
  --dsw-static-neutral-bluish-950: rgb(21, 21, 23);
  --dsw-static-neutral-bluish-1000: rgb(15, 17, 21);
  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-bg-layer-1: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-bg-layer-2: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-bg-layer-3: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);
  --dsw-alias-border-l3: rgba(0, 0, 0, 0.12);
  --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);
  --dsw-alias-interactive-bg-active: rgba(38, 49, 72, 0.1);
  --dsw-alias-fill-hover: var(--dsw-alias-interactive-bg-hover);
  --dsw-alias-bg-module-platform: rgb(245, 246, 247);
  --dsw-alias-bg-mask-photo: rgba(0, 0, 0, 0.88);
  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-1000);
  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);
  --dsw-alias-button-primary-hover: rgb(67, 69, 74);
  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-switch-thumb: var(--dsw-static-neutral-bluish-00);
  --dsw-specific-input-major: var(--dsw-alias-bg-layer-1);
  --dsw-specific-menu: var(--dsw-alias-bg-layer-2);
  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-1000);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-700);
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-600);
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-400);
  --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-markdown-hr: var(--dsw-alias-border-l2);
  --dsw-alias-link: var(--dsw-alias-state-business-primary);
  /* DSH 静态调色板供语义状态别名使用。 */
  --dsw-static-deepseek-100: rgb(228, 237, 253);
  --dsw-static-deepseek-400: rgb(122, 170, 255);
  --dsw-static-deepseek-500: rgb(65, 118, 230);
  --dsw-static-deepseek-800: rgb(52, 65, 91);
  --dsw-static-green-100: rgb(230, 250, 237);
  --dsw-static-green-400: rgb(78, 209, 126);
  --dsw-static-green-500: rgb(34, 197, 94);
  --dsw-static-green-900: rgb(35, 60, 44);
  --dsw-static-amber-100: rgb(254, 245, 231);
  --dsw-static-amber-400: rgb(247, 173, 49);
  --dsw-static-amber-500: rgb(245, 158, 11);
  --dsw-static-amber-600: rgb(221, 134, 41);
  --dsw-static-amber-900: rgb(39, 36, 31);
  --dsw-static-red-400: rgb(242, 90, 90);
  --dsw-static-red-600: rgb(236, 19, 19);

  /* DSH 浅色主题语义状态别名。 */
  --dsw-alias-state-business-primary: var(--dsw-static-deepseek-500);
  --dsw-alias-state-business-tertiary: var(--dsw-static-deepseek-100);
  --dsw-alias-state-success-primary: var(--dsw-static-green-500);
  --dsw-alias-state-success-secondary: var(--dsw-static-green-400);
  --dsw-alias-state-success-tertiary: var(--dsw-static-green-100);
  --dsw-alias-state-warn-label: var(--dsw-static-amber-600);
  --dsw-alias-state-warn-primary: var(--dsw-static-amber-500);
  --dsw-alias-state-warn-secondary: var(--dsw-static-amber-400);
  --dsw-alias-state-warn-tertiary: var(--dsw-static-amber-100);
  --dsw-alias-state-error-primary: var(--dsw-static-red-600);
  --dsw-alias-state-error-secondary: var(--dsw-static-red-400);
  --dsw-static-deepseek-300: rgb(183, 200, 254);
  --dsw-static-deepseek-450: rgb(86, 134, 254);
  --dsw-static-blue-450: rgb(77, 147, 248);
}
body[data-ds-dark-theme] {
  color-scheme: dark;
  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950);
  --dsw-alias-bg-layer-1: var(--dsw-static-neutral-bluish-875);
  --dsw-alias-bg-layer-2: var(--dsw-static-neutral-bluish-850);
  --dsw-alias-bg-layer-3: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.14);
  --dsw-alias-fill-hover: var(--dsw-alias-interactive-bg-hover);
  --dsw-alias-bg-module-platform: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);
  --dsw-alias-button-primary-hover: rgb(235, 238, 242);
  --dsw-specific-input-major: var(--dsw-alias-bg-layer-1);
  --dsw-specific-menu: var(--dsw-alias-bg-layer-2);
  --dsw-alias-link: var(--dsw-alias-state-business-primary);
  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-1000);
  --dsw-alias-switch-thumb: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-300);
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-400);
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-600);
  --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-900);
  --dsw-alias-markdown-hr: var(--dsw-alias-border-l2);
  /* DSH 深色主题语义状态别名。 */
  --dsw-alias-state-business-primary: var(--dsw-static-deepseek-400);
  --dsw-alias-state-business-tertiary: var(--dsw-static-deepseek-800);
  --dsw-alias-state-success-primary: var(--dsw-static-green-500);
  --dsw-alias-state-success-secondary: var(--dsw-static-green-400);
  --dsw-alias-state-success-tertiary: var(--dsw-static-green-900);
  --dsw-alias-state-warn-label: var(--dsw-static-amber-600);
  --dsw-alias-state-warn-primary: var(--dsw-static-amber-500);
  --dsw-alias-state-warn-secondary: var(--dsw-static-amber-400);
  --dsw-alias-state-warn-tertiary: var(--dsw-static-amber-900);
  --dsw-alias-state-error-primary: var(--dsw-static-red-400);
  --dsw-alias-state-error-secondary: var(--dsw-static-red-400);
}
html { min-height: 100%; }
body { margin: 0; min-height: 100vh; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 400 14px/22px var(--dsw-font-family); }
#genui-root { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0; }
`
