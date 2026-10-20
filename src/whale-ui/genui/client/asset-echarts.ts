/**
 * ECharts FULL asset-bundle entry: the complete engine, fetched only when a
 * spec needs a chart type outside the core set or ships a raw `option`.
 * Registers on `window.__GenuiAssets__.echartsFull`. Built as a standalone IIFE into
 * `echarts-full.js`, delivered by the host asset bridge and loaded on demand
 * by echarts-lazy when a spec needs the full engine.
 * @module @changfenhuang/dsh-genui/client/asset-echarts
 */
import { init as echartsInit, type EChartsType, type EChartsCoreOption } from 'echarts'
import 'echarts-wordcloud'

/** The engine surface registered by the echarts asset bundle. */
export interface EChartsAssetApi {
  /** Create an ECharts instance on `el`, apply `option`, return the instance. */
  createChart: (el: HTMLElement, option: EChartsCoreOption, opts?: { height?: number }) => EChartsType
}

function createChart(el: HTMLElement, option: EChartsCoreOption, opts?: { height?: number }): EChartsType {
  const initOpts = opts !== undefined && opts.height !== undefined ? { height: opts.height } : undefined
  const instance = echartsInit(el, undefined, initOpts)
  instance.setOption(option)
  return instance
}

const win = globalThis as unknown as { __GenuiAssets__?: Record<string, unknown> }
const assets = win.__GenuiAssets__ ?? (win.__GenuiAssets__ = {})
assets.echartsFull = { createChart }
