/** Bounded foreground observation, not a benchmark or a process monitor. */
export const STARTUP_OBSERVATION = {
  warmupMs: 10_000,
  observeMs: 60_000,
  frameSampleMs: 1000,
  maxFrameSamples: 3,
  sampleGapMs: 5000,
  longTaskMs: 200,
  slowFrameMs: 50,
} as const

/** Observe once after startup; the caller owns prompt eligibility and decisions. */
export function observeStartupResponsiveness(onStall: () => void): () => void {
  const policy = STARTUP_OBSERVATION
  let disposed = false
  let elapsed = 0
  let previous = performance.now()
  let acceptAfter = previous
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame = 0
  let samples = 0
  let poorSamples = 0
  let lastSample = -Infinity
  let longTasks = 0
  const blockedWindows = new Set<number>()
  const visible = (): boolean => document.visibilityState !== 'hidden' && document.hasFocus()
  const observing = (): boolean => !disposed && visible() && elapsed >= policy.warmupMs
  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    observer?.disconnect()
    for (const type of ['keydown', 'pointerdown', 'wheel']) document.removeEventListener(type, sample)
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('dsh:render-resume', visibility)
    window.removeEventListener('focus', visibility)
    window.removeEventListener('blur', visibility)
  }
  const detected = (): void => { cleanup(); onStall() }
  const resetEvidence = (): void => { longTasks = 0; poorSamples = 0; blockedWindows.clear() }
  const heartbeat = (): void => {
    const now = performance.now()
    const delta = now - previous
    previous = now
    elapsed += delta
    if (elapsed >= policy.warmupMs + policy.observeMs) { cleanup(); return }
    timer = setTimeout(heartbeat, 1000)
  }
  const visibility = (): void => {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    frame = 0
    observer?.takeRecords()
    resetEvidence()
    previous = performance.now()
    acceptAfter = previous
    if (visible() && !disposed) timer = setTimeout(heartbeat, 1000)
  }
  const sample = (): void => {
    const now = performance.now()
    if (!observing() || frame !== 0 || samples >= policy.maxFrameSamples || now - lastSample < policy.sampleGapMs) return
    samples += 1
    lastSample = now
    let first = 0
    let last = 0
    let total = 0
    let slow = 0
    const tick = (time: number): void => {
      if (!observing()) { frame = 0; return }
      if (last !== 0) {
        // Large discontinuities are suspension, not evidence about rendering.
        if (time - last > 2500) { frame = 0; return }
        total += 1
        if (time - last > policy.slowFrameMs) slow += 1
      } else first = time
      last = time
      if (time - first < policy.frameSampleMs) { frame = requestAnimationFrame(tick); return }
      frame = 0
      if (total >= 8 && slow >= 3 && slow / total >= 0.2) poorSamples += 1
      if (poorSamples >= 2) detected()
    }
    frame = requestAnimationFrame(tick)
  }
  const observer = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => {
      if (!observing()) return
      const now = performance.now()
      for (const entry of list.getEntries()) {
        const ended = entry.startTime + entry.duration
        if (entry.startTime < acceptAfter || now - ended > 1500 || entry.duration < policy.longTaskMs) continue
        longTasks += 1
        blockedWindows.add(Math.floor(elapsed / policy.sampleGapMs))
      }
      if (longTasks >= 3 && blockedWindows.size >= 2) detected()
    }) : undefined
  observer?.observe({ type: 'longtask', buffered: false })
  for (const type of ['keydown', 'pointerdown', 'wheel']) document.addEventListener(type, sample, { passive: true })
  document.addEventListener('visibilitychange', visibility)
  document.addEventListener('dsh:render-resume', visibility)
  window.addEventListener('focus', visibility)
  window.addEventListener('blur', visibility)
  visibility()
  return cleanup
}
