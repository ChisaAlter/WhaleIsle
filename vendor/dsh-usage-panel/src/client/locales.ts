// dsh-usage-panel · zh/en dictionaries + tiny i18n runtime.
//
// Uses the DSH locale service when available (register + bind, lookup chain
// active → zh fallback → key); otherwise falls back to a self-contained zh
// dictionary so the panel still renders in older runtimes. Host errors are
// machine-readable codes — translation happens HERE, never in the host.
import type { Locale } from '../shared/format.ts'

export const NS = 'usage-panel'

export const zhCN: Record<string, string> = {
  'nav.label': '用量与费用',
  'nav.subtitle': '只读重算会话日志 · 永不写回',
  'kpi.total': 'Token 总用量',
  'kpi.total.detail': '输入 {input} · 输出 {output} · 缓存读 {cacheRead}',
  'kpi.sessions': '总会话数量',
  'kpi.sessions.detail': '总会话 {total} · 有用量会话：主 {main} · 子代理 {subagent}',
  'kpi.topModel': '最常用模型',
  'kpi.topModel.detail': '占比 {pct}%',
  'kpi.hitRate': '缓存命中率',
  'kpi.hitRate.detail': '读 {read} · 写 {write}',
  'kpi.hitRate.none': '暂无缓存数据',
  'kpi.cost': '费用合计(估算)',
  'kpi.cost.detail': '峰段 {peak} · 谷段 {idle}',
  'kpi.cost.none': '暂无已定价模型',
  'sessions.cost.none': '该会话模型未定价',
  'heat.title': '活跃热力图',
  'heat.sub.fallback': '最近 182 天 · UTC',
  'heat.window': '{tokens} Tokens · 活跃 {active} 天',
  'heat.range': '{range}：{tokens} Tokens · 活跃 {active}/{total} 天',
  'heat.clear': '清除选择',
  'heat.hint': '单击选中日期，Shift+单击扩展范围',
  'heat.less': '少',
  'heat.more': '多',
  'heat.day': '{date} · {tokens} Tokens',
  'heat.cost': '当日费用合计',
  'heat.costNone': '未定价',
  'bar.title': '每日 Token 用量',
  'bar.sub': '按模型堆叠',
  'bar.day': '{date} · 共 {tokens} Tokens',
  'donut.title': '模型用量',
  'donut.model': '模型',
  'donut.tokens': '用量',
  'donut.cap': 'Token 总用量',
  'donut.other': '其他',
  'donut.share': '占比',
  'donut.hitRate': '命中率',
  'sessions.title': '会话用量排行',
  'sessions.sub': '按全部历史用量',
  'sessions.untitled': '未命名会话',
  'sessions.main': '主会话',
  'sessions.subagent': '子代理',
  'sessions.tokens': '{tokens} Tokens',
  'sessions.lastActive': '最近活跃 {date}',
  'sessions.hSession': '会话',
  'sessions.hType': '类型',
  'sessions.hActive': '最近活跃',
  'sessions.hCost': '费用',
  'sessions.hTokens': 'Token 用量',
  'sessions.more': '显示更多…',
  'sessions.moreLoading': '加载中…',
  'sort.by': '按',
  'sort.tokens': 'Token 排序',
  'sort.cost': '费用排序',
  'projects.title': '项目用量排行',
  'projects.sub': '按会话工作目录聚合',
  'projects.hProject': '项目',
  'projects.hCost': '费用合计',
  'projects.hTokens': 'Token 用量',
  'projects.empty': '暂无项目用量数据',
  'projects.loading': '正在加载项目用量…',
  'providers.title': '服务商用量',
  'export.button': '导出',
  'export.json': '导出 JSON',
  'export.daily': '导出每日 CSV',
  'export.models': '导出模型 CSV',
  'export.file.daily': 'dsh-usage-panel-daily.csv',
  'export.file.models': 'dsh-usage-panel-models.csv',
  'export.file.json': 'dsh-usage-panel-overview.json',
  'export.failed': '导出失败：{msg}',
  'refresh.button': '刷新',
  'refresh.loading': '刷新中…',
  'refresh.title': '重新拉取最新统计',
  'status.loading': '正在统计会话日志…',
  'status.loading.hint': '插件加载时已开始预热，通常只需等待片刻',
  'status.fresh': '数据更新于 {time} · UTC',
  'status.stale': '数据更新于 {time} · 后台更新中…',
  'status.fallback': '显示缓存数据（更新失败于 {time}）',
  'status.error': '加载失败：{msg}',
  'status.repair': '修复',
  'status.repairLoading': '修复中…',
  'status.repairHint': '{count} 个会话日志读取失败',
  'status.repairDone': '已修复并恢复 {count} 条事件（原件已备份）',
  'status.repairRefreshFailed': '已修复并恢复 {count} 条事件（原件已备份）；统计刷新失败，请刷新重试',
  'status.repairStill': '修复已生效(文件已重写);若提示仍显示,请重启 dsh 清除宿主内存状态',
  'status.repairFailed': '修复失败：{msg}',
  'source.magpie': '总计口径：Magpie 网关用量（{calls} 次调用 · {from} – {to} UTC）· 输入+输出',
  'source.logs': '总计口径：会话日志（输入+输出，fork 继承前缀已去重）',
  'empty.title': '暂无统计数据',
  'empty.hint': '开始使用 DeepSeek Harness 后，这里会展示 Token 消耗情况',
  'error.title': '统计面板崩溃了',
  'error.reset': '清空缓存并重试',
  'error.detail': '错误信息：{msg}',
  'unit.tokens': '{n} Tokens',
  'date.today': '今天',
  'strip.estimate': '估算费用，非账单',
  'billing.button': '设置',
  'billing.title': '计费设置',
  'billing.loading': '正在加载计费设置…',
  'billing.close': '关闭',
  'billing.save': '保存',
  'billing.saving': '保存中…',
  'billing.idleToggleNote': '开启：高峰与空闲两行分别计价;关闭：只填一个价格，两时段都按它计费',
  // Inserted next to the switch note it describes (peak row + single price row).
  'billing.periodSingle': '价格',
  'billing.peakValleyLabel': '峰谷计价（按高峰/谷段分别计费）',
  'billing.peakHint': '单位：¥ / 百万 tokens；空闲价默认 = 高峰价的一半',
  // With 峰谷计价 OFF the entered price is written into BOTH columns, so the
  // note may state plainly that both periods bill it.
  'billing.flatHint': '峰谷计价已关闭：两时段均按所填价格计费（保存后高峰与空闲两列同价）',
  'billing.modelsNone': '暂无可用模型（provider 目录为空）',
  'billing.modelsTitle': '模型选择',
  'billing.providerLabel': '供应商',
  'billing.modelLabel': '模型',
  'billing.commit': '添加/更新',
  'billing.updated': '已更新：{model}',
  'billing.configuredTitle': '已配置价格',
  'billing.badgeOfficial': '官方',
  'billing.badgeCustom': '自定义',
  'billing.edit': '编辑',
  'billing.remove': '删除',
  'billing.err.pickModel': '请先选择模型',
  'billing.filterPlaceholder': '搜索模型…',
  'billing.filterNone': '没有匹配的模型',
  'billing.editorTitle': '价格输入',
  'billing.defaultHint': '默认采用官方价格；如与实际不符可修改后保存（将覆盖为自定义价）',
  'billing.unknownHint': '该模型无官方价，请自行设置价格（保存后按此价计费）',
  'billing.editorEmpty': '先从上方选择要设置价格的模型',
  'billing.hit': '缓存命中',
  'billing.miss': '未命中',
  'billing.out': '输出',
  'billing.flat': '该模型关闭峰谷计价',
  'billing.flatShort': '关闭峰谷',
  'billing.idle': '显式空闲价',
  'billing.idleShort': '空闲价',
  'billing.idleToggle': '峰谷计价',
  'billing.periodPeak': '高峰价格',
  'billing.periodIdle': '空闲价格',
  'billing.addModel': '添加',
  'billing.addModelPlaceholder': '手动输入模型 ID',
  'billing.saveError': '保存失败：{msg}',
  'billing.loadError': '设置加载失败：{msg}',
  'billing.retry': '重试',
  'billing.err.invalidPrice': '「{key}」价格无效：三个价格都必须是非负数字',
  'billing.err.invalidIdle': '「{key}」空闲价无效：三个价格都必须是非负数字',
  'billing.err.invalidSingle': '「{key}」价格无效：三个价格都必须是非负数字',
}

export const enUS: Record<string, string> = {
  'nav.label': 'Usage & costs',
  'nav.subtitle': 'Read-only session log stats · never writes back',
  'kpi.total': 'Total tokens',
  'kpi.total.detail': 'In {input} · Out {output} · Cache read {cacheRead}',
  'kpi.sessions': 'Sessions',
  'kpi.sessions.detail': 'Total {total} · with usage: main {main} · subagent {subagent}',
  'kpi.topModel': 'Top model',
  'kpi.topModel.detail': 'Share {pct}%',
  'kpi.hitRate': 'Cache hit rate',
  'kpi.hitRate.detail': 'Read {read} · Write {write}',
  'kpi.hitRate.none': 'No cache data yet',
  'kpi.cost': 'Estimated cost',
  'kpi.cost.detail': 'Peak {peak} · Off-peak {idle}',
  'kpi.cost.none': 'No priced models yet',
  'sessions.cost.none': 'This session has unpriced models',
  'heat.title': 'Activity heatmap',
  'heat.sub.fallback': 'Last 182 days · UTC',
  'heat.window': '{tokens} tokens · {active} active days',
  'heat.range': '{range}: {tokens} tokens · {active}/{total} active days',
  'heat.clear': 'Clear selection',
  'heat.hint': 'Click a day · Shift+click for a range',
  'heat.less': 'Less',
  'heat.more': 'More',
  'heat.day': '{date} · {tokens} tokens',
  'heat.cost': 'Day cost',
  'heat.costNone': 'Not priced',
  'bar.title': 'Daily token usage',
  'bar.sub': 'Stacked by model',
  'bar.day': '{date} · {tokens} tokens total',
  'donut.title': 'Model usage',
  'donut.model': 'Model',
  'donut.tokens': 'Tokens',
  'donut.cap': 'Total tokens',
  'donut.other': 'Other',
  'donut.share': 'Share',
  'donut.hitRate': 'Hit rate',
  'sessions.title': 'Top sessions',
  'sessions.sub': 'By all-time usage',
  'sessions.untitled': 'Untitled session',
  'sessions.main': 'Main',
  'sessions.subagent': 'Subagent',
  'sessions.tokens': '{tokens} tokens',
  'sessions.lastActive': 'Active {date}',
  'sessions.hSession': 'Session',
  'sessions.hType': 'Type',
  'sessions.hActive': 'Last active',
  'sessions.hCost': 'Cost',
  'sessions.hTokens': 'Tokens',
  'sessions.more': 'Show more…',
  'sessions.moreLoading': 'Loading…',
  'sort.by': 'Sort by',
  'sort.tokens': 'Tokens',
  'sort.cost': 'Cost',
  'projects.title': 'Project usage',
  'projects.sub': 'Grouped by session working directory',
  'projects.hProject': 'Project',
  'projects.hCost': 'Cost',
  'projects.hTokens': 'Tokens',
  'projects.empty': 'No project usage yet',
  'projects.loading': 'Loading project usage…',
  'providers.title': 'Providers',
  'export.button': 'Export',
  'export.json': 'Export JSON',
  'export.daily': 'Export daily CSV',
  'export.models': 'Export model CSV',
  'export.file.daily': 'dsh-usage-panel-daily.csv',
  'export.file.models': 'dsh-usage-panel-models.csv',
  'export.file.json': 'dsh-usage-panel-overview.json',
  'export.failed': 'Export failed: {msg}',
  'refresh.button': 'Refresh',
  'refresh.loading': 'Refreshing…',
  'refresh.title': 'Fetch the latest statistics',
  'status.loading': 'Scanning session logs…',
  'status.loading.hint': 'A warm-up scan started when the plugin loaded; this usually takes a moment',
  'status.fresh': 'Updated at {time} · UTC',
  'status.stale': 'Updated at {time} · refreshing in background…',
  'status.fallback': 'Showing cached data (last refresh failed at {time})',
  'status.error': 'Failed to load: {msg}',
  'status.repair': 'Repair',
  'status.repairLoading': 'Repairing…',
  'status.repairHint': '{count} session log(s) failed to read',
  'status.repairDone': 'Repaired and restored {count} events (original backed up)',
  'status.repairRefreshFailed': 'Repaired and restored {count} events (original backed up); statistics failed to refresh. Please refresh again.',
  'status.repairStill': 'Repair is durable; if the hint persists, restart dsh to clear host in-memory state',
  'status.repairFailed': 'Repair failed: {msg}',
  'source.magpie': 'Totals: Magpie gateway ledger ({calls} calls · {from} – {to} UTC) · input + output',
  'source.logs': 'Totals: session logs (input + output, fork prefix excluded)',
  'empty.title': 'No statistics yet',
  'empty.hint': 'Start using DeepSeek Harness and token usage will show up here',
  'error.title': 'The usage panel crashed',
  'error.reset': 'Clear cache and retry',
  'error.detail': 'Error: {msg}',
  'unit.tokens': '{n} tokens',
  'date.today': 'Today',
  'strip.estimate': 'Estimate, not a bill',
  'billing.button': 'Settings',
  'billing.title': 'Billing settings',
  'billing.loading': 'Loading billing settings…',
  'billing.close': 'Close',
  'billing.save': 'Save',
  'billing.saving': 'Saving…',
  'billing.idleToggleNote': 'On: peak and off-peak rows bill separately; off: one price bills both periods',
  // Inserted next to the switch note it describes (peak row + single price row).
  'billing.periodSingle': 'Price',
  'billing.peakValleyLabel': 'Peak/valley pricing (period-based billing)',
  'billing.peakHint': 'Unit: CNY / million tokens; off-peak defaults to half of the peak price',
  // With 峰谷计价 OFF the entered price is written into BOTH columns, so the
  // note may state plainly that both periods bill it.
  'billing.flatHint': 'Peak/valley pricing off: both periods bill the entered price (peak and off-peak columns are saved equal)',
  'billing.modelsNone': 'No models available (empty provider directory)',
  'billing.modelsTitle': 'Model selection',
  'billing.providerLabel': 'Provider',
  'billing.modelLabel': 'Model',
  'billing.commit': 'Add / update',
  'billing.updated': 'Updated: {model}',
  'billing.configuredTitle': 'Configured prices',
  'billing.badgeOfficial': 'Official',
  'billing.badgeCustom': 'Custom',
  'billing.edit': 'Edit',
  'billing.remove': 'Remove',
  'billing.err.pickModel': 'Pick a model first',
  'billing.filterPlaceholder': 'Filter models…',
  'billing.filterNone': 'No matching models',
  'billing.editorTitle': 'Price editor',
  'billing.defaultHint': 'Defaults to the official price; edit and save to override',
  'billing.unknownHint': 'No official price for this model — set your own (saved as custom)',
  'billing.editorEmpty': 'Pick a model above to set its price',
  'billing.hit': 'Cache hit',
  'billing.miss': 'Cache miss',
  'billing.out': 'Output',
  'billing.flat': 'Disable peak/valley for this model',
  'billing.flatShort': 'Flat',
  'billing.idleToggle': 'Peak/valley',
  'billing.periodPeak': 'Peak prices',
  'billing.periodIdle': 'Off-peak prices',
  'billing.idle': 'Explicit off-peak price',
  'billing.idleShort': 'Off-peak',
  'billing.addModel': 'Add',
  'billing.addModelPlaceholder': 'Type a model id',
  'billing.saveError': 'Save failed: {msg}',
  'billing.loadError': 'Settings failed to load: {msg}',
  'billing.retry': 'Retry',
  'billing.err.invalidPrice': 'Invalid price for "{key}": all three prices must be non-negative numbers',
  'billing.err.invalidIdle': 'Invalid off-peak price for "{key}": all three prices must be non-negative numbers',
  'billing.err.invalidSingle': 'Invalid price for "{key}": all three prices must be non-negative numbers',
}

export const dictionaries: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

export interface I18n {
  t(key: string, params?: Record<string, string | number>): string
  locale: Locale
  subscribe(cb: () => void): () => void
  getSnapshot(): Locale
  /** Re-read the active locale; called by the caller on 'locale/change'. */
  update(): void
  /** Release runtime subscriptions (plugin dispose). */
  dispose(): void
}

export interface LocaleRuntimeLike {
  /**
   * DSH locale ids are `'zh'` / `'en'` (LOCALE_IDS) — NOT 'zh-CN'/'en-US'.
   * Object form mirrors the framework's own registration convention.
   */
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  getSnapshot(): { active: string }
  /** LocaleFace subscribe: fires on locale switches AND dict registrations. */
  subscribe?(fn: () => void): () => void
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    return v === undefined ? '{' + name + '}' : String(v)
  })
}

const DICTS: Record<Locale, Record<string, string>> = { 'zh-CN': zhCN, 'en-US': enUS }

function lookup(locale: Locale, key: string): string {
  const dict = DICTS[locale]
  if (dict && dict[key]) return dict[key]
  return DICTS['zh-CN']![key] || key
}

/** Build the i18n instance; uses the DSH locale runtime when present. */
export function createI18n(runtime?: LocaleRuntimeLike): I18n {
  if (!runtime) {
    return {
      t: (key, params) => interpolate(lookup('zh-CN', key), params),
      locale: 'zh-CN',
      subscribe: () => () => {},
      getSnapshot: () => 'zh-CN',
      update: () => {},
      dispose: () => {},
    }
  }
  const rt = runtime // const narrowing survives into closures
  const listeners = new Set<() => void>()
  let active: Locale = normalizeLocale(rt.getSnapshot().active)
  try {
    rt.register(NS, { zh: zhCN, en: enUS })
  } catch {
    // Best-effort: local dictionaries remain the fallback either way.
  }
  const translated = rt.bind(NS)
  const resolve = (key: string, params?: Record<string, string | number>): string => {
    let text: string | undefined
    try {
      // No params here: the runtime fails loud by returning the KEY ITSELF,
      // and interpolation is our single source below.
      text = translated(key)
    } catch {
      text = undefined
    }
    // A truthy-but-unresolved key must NOT bypass the local dictionary.
    if (!text || text === key) text = lookup(active, key)
    return interpolate(text, params)
  }
  function update(): void {
    const next = normalizeLocale(rt.getSnapshot().active)
    if (next !== active) {
      active = next
      for (const cb of listeners) cb()
    }
  }
  // Ride the runtime's own snapshot subscription: covers locale switches AND
  // late dictionary registrations (both bump its revision).
  const disposeRuntimeSub = rt.subscribe ? rt.subscribe(update) : null
  return {
    t: resolve,
    // Getter: `locale` must track switches (the field itself would be a
    // creation-time snapshot).
    get locale(): Locale {
      return active
    },
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot: () => active,
    update,
    dispose: () => {
      if (disposeRuntimeSub) disposeRuntimeSub()
    },
  }
}

export function normalizeLocale(id: string): Locale {
  return id && id.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}
