/** Desktop-owned marketplace settings section (id `market`). */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { desktopShell, hasMarketApi } from './desktop-shell.ts'
import { MarketSection, type MarketSectionInjected } from './MarketSection.tsx'
import { en, zh, type MarketLocaleKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export type { MarketSectionInjected, MarketSectionProps } from './MarketSection.tsx'
export type { MarketLocaleKey } from './locales.ts'
export type {
  InstalledPlugin,
  MarketCatalog,
  MarketCategory,
  MarketItem,
  MarketplaceUpdateStatus,
  MarketplaceUpdatesPayload,
  PluginOpResult,
  PluginProgress,
} from './desktop-shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Marketplace section copy. */
    'settings.market': MarketLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.market'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale']

/**
 * Contribute the marketplace section only when the desktop shell exposes the
 * curated catalog/install APIs. In a plain browser (`dsh web` without the
 * desktop preload) nothing registers.
 * @param ctx - client context with slots and locale.
 * @returns nothing; slot registration is an effect when the desktop API is present.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-market: dictionaries')

  const shell = desktopShell()
  if (!hasMarketApi(shell)) return

  const t = ctx.locale.bind(NS)
  const activeLocale = (): string => ctx.locale.getLocale().active
  const injected = (): MarketSectionInjected => ({
    getDetails: (id, options) => shell.getMarketplaceDetails(id, options),
    getMarketState: () => shell.getMarketplaceState(),
    setFavorite: (id, favorite) => shell.setMarketplaceFavorite(id, favorite),
    updateMany: ids => shell.updateMarketplacePlugins(ids),
    listCatalog: async options => shell.listMarketplace({ ...options, locale: activeLocale() }),
    listInstalled: async () => {
      const payload = await shell.listInstalledPlugins()
      if (payload.ok !== true) throw new Error(t('installedReadFailed'))
      return payload.plugins ?? []
    },
    checkUpdates: options => shell.checkMarketplaceUpdates(options),
    install: (id, options) => shell.installMarketplacePlugin(id, options),
    update: (id, options) => shell.updateMarketplacePlugin(id, options),
    uninstall: name => shell.uninstallPlugin(name),
    onProgress: listener => shell.onPluginProgress(listener),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'market',
    order: 17,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MarketSection))
}
