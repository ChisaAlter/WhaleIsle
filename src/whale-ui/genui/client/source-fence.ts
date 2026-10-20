import { fromMarkdown } from 'mdast-util-from-markdown'
import { normalizeFenceLanguage } from '../shared/fence-language.ts'

export interface SourceFence {
  lang: string | null
  value: string
  openingLineComplete: boolean
  /** Exact source offset, so the host can bind its own stable block identity. */
  offset: number | undefined
}
interface MarkdownNode {
  type: string; lang?: string | null; value?: string; children?: MarkdownNode[]
  position?: { start: { offset?: number } }
}
export type HostCodeBlockPredicate = (fence: SourceFence) => boolean
/** Matches this host's Markdown renderer, where math is rendered directly. */
export const isHostCodeBlock: HostCodeBlockPredicate = fence => fence.lang !== 'math'
export function sourceFencesOf(markdown: string): SourceFence[] {
  const fences: SourceFence[] = []
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'code') {
      const offset = node.position?.start.offset
      const rawLang = node.lang ?? null
      fences.push({ lang: rawLang === null ? null : normalizeFenceLanguage(rawLang), value: node.value ?? '', openingLineComplete: offset !== undefined && markdown.indexOf('\n', offset) >= 0, offset })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(fromMarkdown(markdown) as unknown as MarkdownNode)
  return fences
}
/** Explicit mapping, with no session lookup or DOM scanning. */
export function sourceCodeBlocksOf(markdown: string, predicate: HostCodeBlockPredicate = isHostCodeBlock): SourceFence[] {
  return sourceFencesOf(markdown).filter(predicate)
}
export function sourceLanguageAt(markdown: string, codeBlockIndex: number, predicate: HostCodeBlockPredicate = isHostCodeBlock): string | null | undefined {
  return sourceCodeBlocksOf(markdown, predicate)[codeBlockIndex]?.lang
}
export function sourceFencesOfAssistant(blocks: readonly { kind: string; text?: string }[]): SourceFence[] {
  return blocks.flatMap(block => block.kind === 'text' && typeof block.text === 'string' ? sourceFencesOf(block.text) : [])
}
