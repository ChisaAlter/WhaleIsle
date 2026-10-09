/** Shared, environment-independent Visual reply wire contract. */
export interface HtmlPreviewRequest {
  html: string
  width: number
  appearance: 'light' | 'dark'
}

export interface HtmlPreviewCapture {
  png: string
  width: number
  contentHeight: number
  capturedHeight: number
  consoleMessages: { level: 'log' | 'info' | 'warning' | 'error'; text: string }[]
}
