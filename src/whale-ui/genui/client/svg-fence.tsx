import { useState, type Key } from 'react'
import { CodeBlock } from './primitive-adapter.ts'
import { SvgNode } from './blocks/svg.tsx'
import { codeBlockLabels } from './primitive-labels.ts'
import { useT } from './i18n/index.ts'
import css from './GenuiBlock.module.css'

/** SVG preview consumes explicit streaming state; no ancestor DOM inspection. */
export function SvgFence({ raw, streaming = false }: { raw: string; streaming?: boolean }) {
  const t = useT()
  const [source, setSource] = useState(false)
  return <div data-genui-svg-fence className={`${css.block} ${css.tabs}`}>
    {!streaming && <div role="group" aria-label={t('block.svgLabel')} className={css.tabBar}>
      <button type="button" className={`${css.tab} ${!source ? css.tabActive : ''}`} aria-pressed={!source} onClick={() => setSource(false)}>{t('block.svgPreview')}</button>
      <button type="button" className={`${css.tab} ${source ? css.tabActive : ''}`} aria-pressed={source} onClick={() => setSource(true)}>{t('block.svgSource')}</button>
    </div>}
    {streaming || source ? <CodeBlock {...codeBlockLabels()} code={raw} lang="svg" /> : <SvgNode node={{ type: 'svg', code: raw }} />}
  </div>
}
export function renderSvgFence(raw: string, key: Key, streaming = false) { return <SvgFence key={key} raw={raw} streaming={streaming} /> }
