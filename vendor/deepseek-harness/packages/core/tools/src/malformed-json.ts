/**
 * Format an actionable violation message when a tool call supplies raw text
 * instead of a parsed JSON object (either unrecoverable JSON syntax or a bare
 * JSON string literal).
 */
export function malformedJsonViolation(raw: string): string {
  try {
    JSON.parse(raw)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    return `malformed JSON arguments (${reason}); expected a valid JSON object matching the tool schema`
  }
  return 'arguments must be an object'
}
