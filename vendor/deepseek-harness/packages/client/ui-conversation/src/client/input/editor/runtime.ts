/** The Composer model's private Lexical editor, projections, and node operations. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LexicalEditor, NodeKey } from 'lexical'
import {
  $addUpdateTag, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $nodesOfType, $setSelection,
  BLUR_COMMAND, CLEAR_HISTORY_COMMAND, COMMAND_PRIORITY_CRITICAL, createEditor, DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, HISTORY_MERGE_TAG, PASTE_TAG,
  RootNode, SELECTION_CHANGE_COMMAND, SKIP_DOM_SELECTION_TAG, SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { mergeRegister } from '@lexical/utils'
import type { DraftReference, ReferenceInsert } from '../../contract/draft-editor.ts'
import type { CommandClaim } from '../../contract/input.ts'
import { registerReferenceActivation } from './reference-activation.ts'
import { ReferenceChipNode, $createReferenceChipNode } from './chip-node.tsx'
import { CommandChipNode, $createCommandChipNode, registerCommandChipSeat } from './command-chip-node.tsx'
import { registerCommandChipSelection } from './command-chip-selection.ts'
import { registerTextRefDecoration, rescanTextRefs, TextRefNode } from './text-ref.ts'
import type { EditorProjection } from './projection.ts'
import { $composerLayout, $detectOffsetOfPoint, $projectComposer, detectOffsetOfClipboardOffset } from './projection.ts'
import { $replaceDetectSpanWithNodes, $replaceDetectSpanWithText, $selectDetectPoints } from './span-map.ts'
import type { DetectSpan } from './span-map.ts'

type Lexicon = ReadonlyMap<'/' | '@', readonly string[]>

/** Model callbacks read at the same editor registration and update points. */
interface DraftEditorRuntimeDeps {
  readonly onUpdate: () => void
  readonly openReference: (source: string | undefined, reference: Pick<ReferenceInsert, 'ref' | 'appearance'>) => boolean
  readonly lexicon: () => Lexicon
  readonly resolveLexicon: () => ObservableSnapshot<Lexicon> | undefined
  readonly commandsAllowed: () => boolean
}

/**
 * Detect-projection and legacy reference placeholders stripped from every
 * external text entering the document (paste, persisted-draft seed): a chip
 * is the only legitimate source of U+FFFC in the detect projection, so a
 * literal one in text would forge chip positions.
 */
const REFERENCE_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu

/**
 * Append one paragraph per line of `text` to the editor root and move the caret
 * to the end. Must run inside an editor update.
 * @param text - sanitized plain text.
 */
function $appendParagraphs(text: string): void {
  const root = $getRoot()
  for (const line of text.split('\n')) {
    const paragraph = $createParagraphNode()
    if (line !== '') paragraph.append($createTextNode(line))
    root.append(paragraph)
  }
  root.selectEnd()
}

/** Undo merge window for contiguous typing, in ms (the old machine's mergeWindowMs). */
const HISTORY_MERGE_DELAY_MS = 1000

/**
 * Keep the caret visible inside the draft's own scrollport only. Lexical's
 * built-in scroll-into-view walks every scrolling ancestor, and the composer
 * seat renders inside the conversation scroller while sitting below its box,
 * so each edit scrolled a reader-scrolled transcript down toward the latest
 * turn. Composer updates opt out of it and land the caret here instead.
 * @param root - the editor's contenteditable root.
 */
function keepCaretInDraft(root: HTMLElement): void {
  const doc = root.ownerDocument
  if (!root.contains(doc.activeElement)) return
  const selection = doc.getSelection()
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  // Layout-free documents (jsdom) have ranges without client rects.
  if (!root.contains(range.startContainer) || typeof range.getBoundingClientRect !== 'function') return
  let caret = range.getBoundingClientRect()
  if (caret.height === 0) {
    // A collapsed range on an empty line has no box; its line element does.
    const container = range.startContainer
    const line = container instanceof Element ? container : container.parentElement
    if (line === null) return
    caret = line.getBoundingClientRect()
  }
  const scrollport = root.closest<HTMLElement>('[data-input-scroll]') ?? root
  const box = scrollport.getBoundingClientRect()
  if (caret.bottom > box.bottom) scrollport.scrollTop += caret.bottom - box.bottom
  else if (caret.top < box.top) scrollport.scrollTop -= box.top - caret.top
}

/** One model-owned editor; registration and disposal remain with its model. */
export class DraftEditorRuntime {
  /** The editor bound by the Composer's contenteditable host. */
  readonly editor: LexicalEditor
  private projected: EditorProjection = {
    detectText: '', clipboardText: '', occurrences: [], selection: null, caret: null, command: undefined,
  }
  /** Stable occurrence ids per chip NodeKey (undo restores keys, so ids survive it too). */
  private readonly occurrenceIds = new Map<NodeKey, number>()
  private occurrenceSeq = 0
  /** Live lexicon subscription disposer; undefined until the controller resolves. */
  private lexiconOff: (() => void) | undefined
  private lexiconSource: ObservableSnapshot<Lexicon> | undefined

  /** @param deps - model callbacks used by editor listeners and transforms. */
  constructor(private readonly deps: DraftEditorRuntimeDeps) {
    this.editor = createEditor({
      namespace: 'dsh-composer',
      nodes: [ReferenceChipNode, CommandChipNode, TextRefNode],
      onError: (error) => { throw error },
    })
  }

  /**
   * Install editor behavior after the model holds this runtime.
   * @returns unregister callback that also detaches the editor root.
   */
  register(): () => void {
    // A retained draft selection must not move keyboard focus back from another control.
    const preserveExternalSelection = (): false => {
      const root = this.editor.getRootElement()
      if (root !== null && !root.contains(root.ownerDocument.activeElement)) {
        $addUpdateTag(SKIP_DOM_SELECTION_TAG)
      }
      return false
    }
    const scrollOnlyDraft = (): false => {
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG)
      return false
    }
    const unregister = mergeRegister(
      registerPlainText(this.editor),
      // Content edits mark the root dirty; caret moves arrive as selection changes.
      this.editor.registerNodeTransform(RootNode, scrollOnlyDraft),
      this.editor.registerCommand(SELECTION_CHANGE_COMMAND, scrollOnlyDraft, COMMAND_PRIORITY_CRITICAL),
      // Each command commits its own update: a deletion that changes neither
      // the text nor the caret (Backspace in an empty draft) still commits one
      // with a selection, which would scroll the transcript too.
      this.editor.registerCommand(DELETE_CHARACTER_COMMAND, scrollOnlyDraft, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerCommand(DELETE_WORD_COMMAND, scrollOnlyDraft, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerCommand(DELETE_LINE_COMMAND, scrollOnlyDraft, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, prevEditorState, editorState }) => {
        const root = this.editor.getRootElement()
        if (root === null) return
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0
          && prevEditorState._selection?.is(editorState._selection ?? null) === true) return
        keepCaretInDraft(root)
      }),
      this.editor.registerCommand(BLUR_COMMAND, () => {
        // Finish this batch before an explicit focus can restore its updated selection.
        this.editor.update(preserveExternalSelection, { discrete: true })
        return false
      }, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerCommand(SELECTION_CHANGE_COMMAND, preserveExternalSelection, COMMAND_PRIORITY_CRITICAL),
      this.editor.registerNodeTransform(RootNode, preserveExternalSelection),
      registerReferenceActivation(this.editor, (source, reference) =>
        this.deps.openReference(source, reference)),
      registerHistory(this.editor, createEmptyHistoryState(), HISTORY_MERGE_DELAY_MS),
      this.editor.registerUpdateListener(({ editorState }) => {
        // History installs an EditorState without running node transforms.
        // Normalize a restored claim before publishing it into an edit session;
        // the follow-up commit preserves both literal text and ordinary undo.
        if (!this.deps.commandsAllowed()) {
          const chips = editorState.read(() => $nodesOfType(CommandChipNode))
          if (chips.length > 0) {
            this.editor.update(() => { for (const chip of chips) chip.markDirty() }, {
              discrete: true, tag: HISTORY_MERGE_TAG,
            })
            return
          }
        }
        this.deps.onUpdate()
      }),
      registerCommandChipSeat(this.editor, this.deps.commandsAllowed),
      registerCommandChipSelection(this.editor),
      registerTextRefDecoration(this.editor, () => this.deps.lexicon()),
      () => {
        this.lexiconOff?.()
        this.lexiconOff = undefined
        this.lexiconSource = undefined
      },
    )
    return () => {
      unregister()
      this.editor.setRootElement(null)
    }
  }

  /** The latest committed editor projection. */
  get projection(): EditorProjection {
    return this.projected
  }

  /**
   * Run one editor edit whose result is observable on return. At the top
   * level this is a discrete update. Inside this editor's own update —
   * command handlers land here synchronously (space/enter picks, paste) —
   * $-functions are already legal, and wrapping them in update() would DEFER
   * them past the synchronous bail answer (and a nested discrete throws);
   * the body runs directly and the outer update commits it.
   * @param fn - the $-edit body.
   */
  private applyEdit(fn: () => void, tag?: string): void {
    if (this.editor._updating) {
      // Nested application joins the enclosing update (the PASTE_COMMAND
      // dispatch path always lands here), so the tag attaches to that update.
      if (tag !== undefined) $addUpdateTag(tag)
      fn()
      return
    }
    this.editor.update(fn, { discrete: true, ...(tag === undefined ? {} : { tag }) })
  }

  /**
   * Reconnect decorations when the optional trigger provider changes.
   * The rescan reads the current editor and does not replace its content.
   */
  refreshLexiconSubscription(): void {
    const lexicon = this.deps.resolveLexicon()
    if (lexicon === this.lexiconSource) return
    this.lexiconOff?.()
    this.lexiconSource = lexicon
    this.lexiconOff = lexicon?.subscribe(() => { rescanTextRefs(this.editor) })
    rescanTextRefs(this.editor)
  }

  /**
   * Re-project inside the existing editor update callback.
   * @returns the projection preceding this read.
   */
  refreshProjection(): EditorProjection {
    const prev = this.projected
    this.projected = this.editor.getEditorState().read(() =>
      $projectComposer(key => this.occurrenceIdOf(key)))
    return prev
  }

  private occurrenceIdOf(key: NodeKey): number {
    const existing = this.occurrenceIds.get(key)
    if (existing !== undefined) return existing
    this.occurrenceSeq += 1
    this.occurrenceIds.set(key, this.occurrenceSeq)
    return this.occurrenceSeq
  }

  /**
   * Replace the whole draft (persisted-draft seed and programmatic writes).
   * Placeholder-sanitized; newlines split paragraphs; the caret lands at the
   * end. Merged into history so a seed is not an undoable step of its own.
   * @param text - the full next draft.
   */
  setDraft(text: string): void {
    const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '')
    if (clean === this.projection.clipboardText && this.projection.occurrences.length === 0
      && this.projection.command === undefined) return
    this.editor.update(() => {
      $getRoot().clear()
      $appendParagraphs(clean)
    }, { discrete: true, tag: HISTORY_MERGE_TAG })
  }

  /**
   * Add plain text after the current draft as new paragraphs, keeping its text
   * and references; an empty draft takes the text as its whole content.
   * Placeholder-sanitized; the caret lands at the end; merged into history
   * like {@link setDraft}.
   * @param text - plain text to add.
   */
  appendDraft(text: string): void {
    const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '')
    if (clean === '') return
    if (this.projection.clipboardText === '' && this.projection.occurrences.length === 0) {
      this.setDraft(clean)
      return
    }
    this.editor.update(() => { $appendParagraphs(clean) }, { discrete: true, tag: HISTORY_MERGE_TAG })
  }

  /**
   * Insert pasted plain text over the current editor selection
   * (placeholder-sanitized). The paste event's own default is suppressed by
   * the caller; PASTE_TAG makes the paste its own history boundary, so one
   * undo never removes both the paste and typing inside the merge window.
   * @param text - pasted plain text.
   */
  paste(text: string): void {
    const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '')
    if (clean === '') return
    this.applyEdit(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        selection.insertText(clean)
        return
      }
      // No selection yet (never-focused surface): land at the document end,
      // growing the first paragraph when the tree is empty.
      const root = $getRoot()
      if (root.getChildrenSize() === 0) root.append($createParagraphNode())
      root.selectEnd().insertText(clean)
    }, PASTE_TAG)
  }

  /**
   * The live selection as a detect-coordinate span (menu-launcher synthetic
   * hits replace it on pick); an absent selection answers a collapsed span at
   * the document end.
   * @returns the ordered [start, end) span in detect coordinates.
   */
  caretSpan(): { start: number; end: number } {
    if (this.projection.selection !== null) return this.projection.selection
    const at = this.projection.detectText.length
    return { start: at, end: at }
  }

  /**
   * Replace a mapped span without applying the model's phase or revision guards.
   * @param span - detect-coordinate range.
   * @param text - inserted text.
   * @returns whether the range mapped and the edit applied.
   */
  replaceText(span: DetectSpan, text: string): boolean {
    let applied = false
    this.applyEdit(() => {
      applied = $replaceDetectSpanWithText(span, text)
    })
    return applied
  }

  /**
   * Insert an asynchronous text result as one independent undo operation.
   * @param span - owner-validated insertion range.
   * @param text - text sanitized with the same rules as paste.
   * @returns whether the range mapped and the edit applied.
   */
  insertAsyncText(span: DetectSpan, text: string): boolean {
    let applied = false
    const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '')
    this.applyEdit(() => { applied = $replaceDetectSpanWithText(span, clean) }, PASTE_TAG)
    return applied
  }

  /**
   * Insert a reference chip with the existing trailing-space rule.
   * @param span - detect-coordinate range.
   * @param ref - reference fields.
   * @param tail - the character following the range before editing.
   * @returns whether the range mapped and the edit applied.
   */
  insertReference(span: DetectSpan, ref: ReferenceInsert, tail: string): boolean {
    let applied = false
    this.applyEdit(() => {
      const nodes = tail === ' '
        ? [$createReferenceChipNode(ref)]
        : [$createReferenceChipNode(ref), $createTextNode(' ')]
      applied = $replaceDetectSpanWithNodes(span, nodes)
    })
    return applied
  }

  /**
   * Replace a span with a command chip followed by the claim token's
   * argument separator, unless the separator already follows.
   * @param span - detect-coordinate range.
   * @param claim - the command claim the chip anchors.
   * @param tail - the character following the range before editing.
   * @param restoring - rebuild a saved chip without changing its separator,
   * merged into the seed's history entry rather than a new undoable step.
   * @returns whether the range mapped and the edit applied.
   */
  insertCommand(span: DetectSpan, claim: CommandClaim, tail: string, restoring = false): boolean {
    const separator = restoring ? '' : claim.token.slice(claim.token.trimEnd().length)
    let applied = false
    this.applyEdit(() => {
      // Catalog resolution changes representation, not the user's selection.
      // Read it now: selection-only moves while awaiting resolution do not change draftRev.
      const selection = restoring ? $getSelection() : null
      const layout = restoring && $isRangeSelection(selection) ? $composerLayout() : undefined
      const anchor = layout !== undefined && $isRangeSelection(selection) ? $detectOffsetOfPoint(layout, selection.anchor) : null
      const focus = layout !== undefined && $isRangeSelection(selection) ? $detectOffsetOfPoint(layout, selection.focus) : null
      const retained = selection?.clone() ?? null
      const nodes = separator === '' || tail === separator.charAt(0)
        ? [$createCommandChipNode(claim)]
        : [$createCommandChipNode(claim), $createTextNode(separator)]
      applied = $replaceDetectSpanWithNodes(span, nodes)
      if (!restoring || !applied) return
      if (anchor === null || focus === null) {
        $setSelection(retained)
        return
      }
      // An atomic chip replaces the literal token. A range crossing its
      // interior expands to the chip edge; a caret inside lands after it.
      const remap = (offset: number, towardEnd: boolean): number => {
        if (offset <= span.start) return offset
        if (offset >= span.end) return offset + 1 - (span.end - span.start)
        return span.start + (towardEnd ? 1 : 0)
      }
      $selectDetectPoints(remap(anchor, anchor >= focus), remap(focus, focus >= anchor))
    }, restoring ? HISTORY_MERGE_TAG : undefined)
    return applied
  }

  /**
   * Insert an ordered file-reference batch after the live selection without deleting it.
   * @param references - validated references in source order.
   * @returns whether the live insertion position accepted the batch.
   */
  insertFileReferences(references: readonly ReferenceInsert[]): boolean {
    if (references.length === 0) return true
    let applied = false
    this.applyEdit(() => {
      const projection = $projectComposer(key => this.occurrenceIdOf(key))
      const at = projection.selection?.end ?? projection.detectText.length
      const before = projection.detectText.slice(0, at)
      const nodes = references.flatMap(ref => [$createReferenceChipNode(ref), $createTextNode(' ')])
      if (before !== '' && !/\s$/u.test(before)) nodes.unshift($createTextNode(' '))
      applied = $replaceDetectSpanWithNodes({ start: at, end: at }, nodes)
    }, PASTE_TAG)
    return applied
  }

  /**
   * Clear committed content using the model's suffix decision inside the editor update.
   * @param prefixLength - returns the clipboard-prefix length to remove, or null to clear the root.
   */
  clearCommittedDraft(prefixLength: (clipboardText: string) => number | null): void {
    this.editor.update(() => {
      const layout = $composerLayout()
      const length = prefixLength(layout.clipboardText)
      if (length !== null) {
        $replaceDetectSpanWithText(
          { start: 0, end: detectOffsetOfClipboardOffset(layout, length) }, '',
        )
        return
      }
      const root = $getRoot()
      root.clear()
      root.selectEnd()
    }, { discrete: true, tag: HISTORY_MERGE_TAG })
  }

  /**
   * Import semantic content or a model-selected failure snapshot with fresh reference nodes.
   * @param draft - clipboard text.
   * @param occurrences - reference occurrences in clipboard order.
   */
  restoreDraft(draft: string, occurrences: readonly DraftReference[]): void {
    this.editor.update(() => {
      const root = $getRoot()
      root.clear()
      let paragraph = $createParagraphNode()
      root.append(paragraph)
      const appendText = (text: string): void => {
        const lines = text.replace(REFERENCE_PLACEHOLDER_RE, '').split('\n')
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]
          if (line !== '') paragraph.append($createTextNode(line))
          if (i < lines.length - 1) {
            paragraph = $createParagraphNode()
            root.append(paragraph)
          }
        }
      }
      let cursor = 0
      for (const occurrence of occurrences) {
        appendText(draft.slice(cursor, occurrence.offset))
        paragraph.append(new ReferenceChipNode({
          source: occurrence.source,
          ref: occurrence.ref,
          label: occurrence.label,
          ...(occurrence.appearance === undefined ? {} : { appearance: occurrence.appearance }),
          clipboardText: occurrence.clipboardText,
        }, occurrence.invalid === true))
        cursor = occurrence.offset + occurrence.length
      }
      appendText(draft.slice(cursor))
      root.selectEnd()
    }, { discrete: true, tag: HISTORY_MERGE_TAG })
  }

  /** Cut the editor's undo history after a committed clear or restoration. */
  clearHistory(): void {
    this.editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
  }
}
