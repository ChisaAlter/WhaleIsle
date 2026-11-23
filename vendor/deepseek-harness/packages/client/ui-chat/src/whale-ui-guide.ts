import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { OPENUI_GUIDE } from './openui-guide.ts'

/**
 * Compact static Whale UI summary injected into the default system prompt
 * (1,435 chars vs 43,730 chars full guide) to avoid large first-turn token tax
 * while keeping rules deterministic for KV prefix caching.
 */
export const WHALE_UI_COMPACT_GUIDE = [
  '## Whale UI (`openui` / `whale-ui` fences)',
  '',
  '- **When to use**: Emit an `openui` (or `whale-ui`) code fence when interactive UI, dashboards, forms, charts, diagrams, comparisons, or guided steps improve clarity over plain prose. Use `render_ui` to validate complex OpenUI source before publishing.',
  '- **Core format**: Declarative `root = Component(...)` assignments (out-of-order definitions hoist cleanly) with `$state` bindings; put brief prose outside the fence.',
  '- **Component categories**:',
  '  - **Layout**: Col, Row, Box, Grid, Card, Carousel, Popover, Details, Divider, Spacer',
  '  - **Text**: Title, Text, Caption, Label, Badge, Link, List, ListItem, Markdown, Quote, Code, Math, Progress',
  '  - **Inputs**: Button, IconButton, Pressable, Input, TextArea, Select, SegmentedControl, Slider, Checkbox, RadioGroup, DatePicker, Timer, Form',
  '  - **Media and data**: SearchImage, Image, Icon, Table, Chart, Map, MapMarker, YouTube',
  '  - **Play & Drawing**: Flashcard, Celebration, Svg, Circle, Ellipse, Rect, Line, Path, Polyline, Polygon, SvgText, HtmlView',
  '  - **Other**: Genui, Plot, Mermaid, Scene3D, EChart, Diagram, Blocks, Quiz, FileTree, Timeline, Steps, KeyValue, Diff, Json, Tabs, Accordion',
  '- **Full specification**: When building complex OpenUI layouts or needing exact component signatures, syntax rules, built-in functions, button Action behavior, or hoisting/streaming rules, call `whale_ui_guide` first to retrieve the complete spec.',
].join('\n')

interface ParsedSection {
  readonly level: 2 | 3
  readonly title: string
  readonly headingLine: string
  readonly body: string
  readonly raw: string
}

export interface WhaleUiGuideResult {
  readonly guide: string
  readonly totalLength: number
  readonly filtered: boolean
  readonly sections: string[]
  readonly matchedSections: string[]
}

function parseGuideSections(guide: string): ParsedSection[] {
  const lines = guide.split('\n')
  const headers: { index: number; level: 2 | 3; title: string; line: string }[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined) continue
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    const hashes = match?.[1]
    const title = match?.[2]
    if (hashes !== undefined && title !== undefined) {
      headers.push({
        index: i,
        level: hashes.length as 2 | 3,
        title,
        line,
      })
    }
  }

  return headers.map((header, idx) => {
    let end = lines.length
    for (let next = idx + 1; next < headers.length; next += 1) {
      const candidate = headers[next]
      if (candidate !== undefined && candidate.level <= header.level) {
        end = candidate.index
        break
      }
    }
    const raw = lines.slice(header.index, end).join('\n').trimEnd()
    const body = lines.slice(header.index + 1, end).join('\n').trim()
    return {
      level: header.level,
      title: header.title,
      headingLine: header.line,
      body,
      raw,
    }
  })
}

function splitSearchBlocks(body: string): string[] {
  const lines = body.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (!inFence && current.length > 0) {
        blocks.push(current.join('\n'))
        current = []
      }
      current.push(line)
      if (inFence) {
        blocks.push(current.join('\n'))
        current = []
      }
      inFence = !inFence
      continue
    }
    if (inFence) {
      current.push(line)
      continue
    }
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'))
        current = []
      }
      continue
    }
    if (current.length > 0 && (/^[A-Z][A-Za-z0-9]*\(/.test(line) || /^[-*]\s/.test(line))) {
      blocks.push(current.join('\n'))
      current = [line]
      continue
    }
    current.push(line)
  }

  if (current.length > 0) blocks.push(current.join('\n'))
  return blocks
}

function normalizeSectionFilter(sections: ParsedSection[], sectionQuery: string): ParsedSection[] {
  const needle = sectionQuery.trim().toLowerCase()
  const exact = sections.filter(s => s.title.toLowerCase() === needle)
  if (exact.length > 0) return exact
  return sections.filter(s => s.title.toLowerCase().includes(needle))
}

/**
 * Filter `OPENUI_GUIDE` by optional heading `section` and/or keyword `query`.
 * When both arguments are omitted or blank, returns the verbatim `OPENUI_GUIDE`.
 */
export function filterOpenUiGuide(args?: { section?: string | undefined; query?: string | undefined }): WhaleUiGuideResult {
  const parsed = parseGuideSections(OPENUI_GUIDE)
  const sectionTitles = parsed.map(s => s.title)
  const sectionFilter = typeof args?.section === 'string' ? args.section.trim() : ''
  const queryFilter = typeof args?.query === 'string' ? args.query.trim() : ''

  if (!sectionFilter && !queryFilter) {
    return {
      guide: OPENUI_GUIDE,
      totalLength: OPENUI_GUIDE.length,
      filtered: false,
      sections: sectionTitles,
      matchedSections: sectionTitles,
    }
  }

  let candidates = sectionFilter ? normalizeSectionFilter(parsed, sectionFilter) : parsed
  // Avoid repeating `###` subsections when a parent `##` section is already selected without a keyword filter.
  if (sectionFilter && !queryFilter) {
    const selectedLevel2 = new Set(candidates.filter(s => s.level === 2).map(s => s.raw))
    candidates = candidates.filter(s => s.level === 2 || ![...selectedLevel2].some(parent => parent.includes(s.headingLine)))
  }

  if (candidates.length === 0) {
    return {
      guide: [
        `No Whale UI guide section matched "${sectionFilter}".`,
        'Available sections:',
        ...sectionTitles.map(title => `- ${title}`),
      ].join('\n'),
      totalLength: OPENUI_GUIDE.length,
      filtered: true,
      sections: sectionTitles,
      matchedSections: [],
    }
  }

  if (!queryFilter) {
    return {
      guide: candidates.map(s => s.raw).join('\n\n'),
      totalLength: OPENUI_GUIDE.length,
      filtered: true,
      sections: sectionTitles,
      matchedSections: candidates.map(s => s.title),
    }
  }

  const needle = queryFilter.toLowerCase()
  // Prefer leaf sections when scanning with a query to avoid duplicating `## Component Signatures` + `### ...`.
  const searchPool = sectionFilter
    ? candidates
    : candidates.filter((section, idx) => {
      if (section.level === 3) return true
      const next = candidates[idx + 1]
      return next === undefined || next.level === 2
    })

  const matchedBlocks: string[] = []
  const matchedTitles: string[] = []
  for (const section of searchPool) {
    const headingMatches = section.title.toLowerCase().includes(needle)
    const blocks = splitSearchBlocks(section.body).filter(block => block.toLowerCase().includes(needle))
    if (headingMatches && blocks.length === 0) {
      matchedBlocks.push(section.raw)
      matchedTitles.push(section.title)
    } else if (blocks.length > 0) {
      matchedBlocks.push(`${section.headingLine}\n\n${blocks.join('\n\n')}`)
      matchedTitles.push(section.title)
    }
  }

  if (matchedBlocks.length === 0) {
    return {
      guide: [
        `No Whale UI guide entries matched query "${queryFilter}"${sectionFilter ? ` in section "${sectionFilter}"` : ''}.`,
        'Available sections:',
        ...sectionTitles.map(title => `- ${title}`),
      ].join('\n'),
      totalLength: OPENUI_GUIDE.length,
      filtered: true,
      sections: sectionTitles,
      matchedSections: [],
    }
  }

  return {
    guide: matchedBlocks.join('\n\n'),
    totalLength: OPENUI_GUIDE.length,
    filtered: true,
    sections: sectionTitles,
    matchedSections: matchedTitles,
  }
}

/** Read-only tool returning either filtered sections/matches or the full `OPENUI_GUIDE`. */
export const whaleUiGuideTool: ToolDefinition = {
  name: 'whale_ui_guide',
  description: 'Read the full Whale UI / OpenUI component specification, syntax rules, built-in functions, Action expressions, hoisting/streaming rules, and examples. Omit section and query to receive the complete guide, or filter by section heading or component/keyword query.',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description: 'Optional heading filter (e.g. "Syntax Rules", "Layout", "Text", "Inputs", "Media and data", "Drawing", "Other", "Built-in Functions", "Hoisting & Streaming (CRITICAL)", "Examples").',
      },
      query: {
        type: 'string',
        description: 'Optional case-insensitive keyword or component name filter (e.g. "Table", "Chart", "Form", "Button", "EChart").',
      },
    },
    required: [],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        guide: { type: 'string' },
        totalLength: { type: 'integer' },
        filtered: { type: 'boolean' },
        sections: { type: 'array', items: { type: 'string' } },
        matchedSections: { type: 'array', items: { type: 'string' } },
      },
      required: ['guide', 'totalLength', 'filtered', 'sections', 'matchedSections'],
      additionalProperties: false,
    },
    render(_args: unknown, value: unknown) {
      const text = typeof (value as { guide?: unknown } | null)?.guide === 'string'
        ? (value as { guide: string }).guide
        : ''
      return [{ type: 'text', text }]
    },
  },
  isConcurrencySafe: () => true,
  execute(args: unknown) {
    try {
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        throw new Error('whale_ui_guide expects a JSON object with optional "section" and "query" string arguments')
      }
      const raw = (args ?? {}) as Record<string, unknown>
      for (const key of Object.keys(raw)) {
        if (key !== 'section' && key !== 'query') {
          throw new Error(`whale_ui_guide received unknown argument "${key}"`)
        }
        if (raw[key] !== undefined && typeof raw[key] !== 'string') {
          throw new Error(`whale_ui_guide argument "${key}" must be a string`)
        }
      }
      return Promise.resolve(filterOpenUiGuide({
        ...(typeof raw.section === 'string' ? { section: raw.section } : {}),
        ...(typeof raw.query === 'string' ? { query: raw.query } : {}),
      }))
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  },
}
