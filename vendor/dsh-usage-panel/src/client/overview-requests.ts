// A settings-page owner keeps late overview results only for its latest load.

/** Own request identity across refreshes and effect disposal. */
export function createOverviewRequests(): { begin(): () => boolean; invalidate(): void } {
  let generation = 0
  return {
    begin(): () => boolean {
      const request = ++generation
      return () => generation === request
    },
    invalidate(): void {
      generation += 1
    },
  }
}
