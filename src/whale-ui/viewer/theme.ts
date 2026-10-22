import type { WhaleTheme } from './protocol.ts';

const TOKENS: Record<string, readonly string[]> = {
  '--whale-fg': ['--dsw-alias-label-primary', '--text'],
  '--whale-fg-muted': ['--dsw-alias-label-secondary', '--text-secondary'],
  '--whale-bg': ['--dsw-alias-bg-base', '--background', '--bg'],
  '--whale-surface': ['--dsw-alias-interactive-bg-hover', '--surface'],
  '--whale-panel': ['--dsw-alias-bg-layer-1', '--surface'],
  '--whale-fg-faint': ['--dsw-alias-label-tertiary'],
  '--whale-hover': ['--dsw-alias-interactive-bg-hover'],
  '--whale-active': ['--dsw-alias-interactive-bg-active'],
  '--whale-border': ['--dsw-alias-border-l2', '--border'],
  '--whale-accent': ['--dsw-alias-state-business-primary', '--accent'],
  '--whale-on-accent': ['--dsw-alias-label-primary-foreground'],
  '--whale-button': ['--dsw-alias-button-primary-fill', '--dsw-alias-brand-primary'],
  '--whale-button-hover': ['--dsw-alias-button-primary-hover'],
  '--whale-on-button': ['--dsw-alias-label-primary-foreground'],
  '--whale-ok': ['--dsw-alias-state-success-primary', '--dsw-static-green-500'],
  '--whale-warn': ['--dsw-alias-state-warn-primary', '--dsw-static-amber-500'],
  '--whale-danger': ['--dsw-alias-state-error-primary', '--dsw-static-red-500'],
  '--whale-font': ['--dsw-font-family-base', '--dsw-font-family'],
  '--whale-mono': ['--ds-font-family-code', '--dsw-font-family-code', '--dsw-font-family-mono'],
  '--whale-radius': ['--dsw-radius-sm'],
  '--whale-radius-surface': ['--dsw-radius-md'],
};

/** A document follows the host's semantic palette and font without remounting its content. */
export function applyTheme(theme: WhaleTheme, previous: string[]): string[] {
  const root = document.documentElement;
  root.dataset.theme = theme.appearance;
  root.style.colorScheme = theme.appearance;
  document.body.toggleAttribute('data-ds-dark-theme', theme.appearance === 'dark');
  for (const key of previous) { root.style.removeProperty(key); document.body.style.removeProperty(key); }
  const values = { ...theme.variables };
  if (values['--whale-mono']?.trim()) values['--ds-font-family-code'] = values['--whale-mono'];
  for (const [target, candidates] of Object.entries(TOKENS)) {
    const source = candidates.find(key => values[key]?.trim());
    if (source) values[target] = values[source];
  }
  for (const [key, value] of Object.entries(values)) if (key.startsWith('--') && typeof value === 'string' && value.length < 4096) {
    root.style.setProperty(key, value);
    document.body.style.setProperty(key, value);
  }
  return Object.keys(values).filter(key => key.startsWith('--'));
}
