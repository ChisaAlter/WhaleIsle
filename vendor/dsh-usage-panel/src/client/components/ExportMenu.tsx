// dsh-usage-panel · export menu (P1-⑧).
// JSON / daily CSV / model CSV; CSV cells are formula-injection-guarded,
// RFC 4180 escaped, and files carry a UTF-8 BOM. Cost columns (estimate, ¥
// cents) are per-model priced with the user's current custom prices.
import { useState } from 'react'
import { Button, Menu, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Overview } from '../../shared/contract.ts'
import { buildDailyCsv, buildJson, buildModelCsv, download } from '../export.ts'
import { useBillingSettings } from '../hooks.ts'
import type { RpcLike } from '../ctx.ts'
import type { I18n } from '../locales.ts'
import * as React from 'react'

interface ExportMenuProps {
  overview: Overview
  i18n: I18n
  rpc: RpcLike
}

export function ExportMenu({ overview, i18n, rpc }: ExportMenuProps): JSX.Element {
  const t = i18n.t
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<{ id: number; text: string } | null>(null)
  const failureId = React.useRef(0)
  const billing = useBillingSettings(rpc)
  const prices = billing === null ? {} : billing.prices
  const peakValley = billing === null ? true : billing.peakValleyEnabled
  const modelProviders = Object.fromEntries(overview.allTime.byModel.map((m) => [m.model, m.provider]))

  const run = (kind: 'json' | 'daily' | 'models'): void => {
    setFailure(null)
    try {
      if (kind === 'json') download(t('export.file.json'), buildJson(overview), 'application/json')
      else if (kind === 'daily') download(t('export.file.daily'), buildDailyCsv(overview.days, prices, peakValley, modelProviders), 'text/csv')
      else download(t('export.file.models'), buildModelCsv(overview.byModel, prices, peakValley), 'text/csv')
    } catch (err) {
      setFailure({ id: ++failureId.current, text: t('export.failed', { msg: String((err as Error)?.message ?? err) }) })
    } finally {
      setOpen(false)
    }
  }

  return (
    <>
      <Menu
        open={open}
        align="end"
        portal
        anchor={
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {t('export.button')}
          </Button>
        }
        items={[
          { id: 'json', label: t('export.json') },
          { id: 'daily', label: t('export.daily') },
          { id: 'models', label: t('export.models') },
        ]}
        onSelect={(id) => {
          if (id === 'json' || id === 'daily' || id === 'models') run(id)
        }}
        onClose={() => setOpen(false)}
      />
      {failure !== null && (
        <Toast
          key={failure.id}
          text={failure.text}
          holdMs={null}
          dismissLabel={t('billing.close')}
          onDone={() => setFailure(null)}
        />
      )}
    </>
  )
}
