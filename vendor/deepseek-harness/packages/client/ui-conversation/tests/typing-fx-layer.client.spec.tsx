// @vitest-environment jsdom
/**
 * TypingFxLayer: the composer overlay spawns bounded echoes for user
 * keystrokes only, swaps the caret when a custom cursor is configured, and
 * drops every listener on unmount or editor replacement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { LexicalEditor, NodeKey } from 'lexical'
import {
  $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $isTextNode,
  $setCompositionKey, COMPOSITION_END_TAG, COMPOSITION_START_TAG, createEditor, PASTE_TAG,
} from 'lexical'
import { TypingFxLayer } from '../src/client/TypingFxLayer.tsx'
import { MAX_TYPING_FX_ECHOES } from '../src/client/input/editor/typing-fx.ts'
import { DEFAULT_TYPING_FX_STYLE, type TypingFxStyle } from '../src/submission-settings.ts'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-dsh-minimal')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeEditor(): LexicalEditor {
  const editor = createEditor({ namespace: 'typing-fx-spec', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  editor.setRootElement(root)
  return editor
}

/** Pin a collapsed DOM selection inside the editor root at a fixed caret box. */
function mockCaret(editor: LexicalEditor, collapsed = true) {
  const anchor = editor.getRootElement()
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    isCollapsed: collapsed,
    anchorNode: anchor,
    getRangeAt: () => ({ getBoundingClientRect: () => new DOMRect(12, 24, 0, 18) }) as unknown as Range,
    setBaseAndExtent: () => {},
    addRange: () => {},
    removeAllRanges: () => {},
  } as unknown as Selection)
}

function type(editor: LexicalEditor, char: string, tag?: string) {
  act(() => {
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(char))
      $getRoot().append(paragraph)
    }, { discrete: true, ...(tag === undefined ? {} : { tag }) })
  })
}

function mount(opts: { enabled?: boolean; style?: Partial<TypingFxStyle> } = {}) {
  const editor = makeEditor()
  const style: TypingFxStyle = { ...DEFAULT_TYPING_FX_STYLE, ...opts.style }
  const view = render(
    <TypingFxLayer editor={editor} enabled={opts.enabled ?? true} style={style} />,
    { container: document.body.appendChild(document.createElement('div')) },
  )
  return { editor, view }
}

describe('TypingFxLayer', () => {
  it('removes the live overlay and selection listener in Minimal mode without changing editor content', () => {
    const { editor, view } = mount({ style: { cursor: 'block' } })
    mockCaret(editor)
    type(editor, 'A')
    expect(view.container.querySelector('[data-typing-fx-echo]')).not.toBeNull()
    const remove = vi.spyOn(document, 'removeEventListener')
    act(() => {
      document.documentElement.setAttribute('data-dsh-minimal', '')
      document.dispatchEvent(new Event('dsh:render-mode'))
    })
    expect(view.container.querySelector('[data-typing-fx]')).toBeNull()
    expect(remove).toHaveBeenCalledWith('selectionchange', expect.any(Function))
    type(editor, 'B')
    expect(editor.getRootElement()?.textContent).toContain('B')
    act(() => {
      document.documentElement.removeAttribute('data-dsh-minimal')
      document.dispatchEvent(new Event('dsh:render-mode'))
    })
    expect(view.container.querySelector('[data-typing-fx]')).not.toBeNull()
    expect(view.container.querySelector('[data-typing-fx-echo]')).toBeNull()
  })

  it('renders nothing while disabled or editor-less', () => {
    const disabled = mount({ enabled: false })
    expect(disabled.view.container.querySelector('[data-typing-fx]')).toBeNull()
    cleanup()
    const bare = render(
      <TypingFxLayer editor={null} enabled style={DEFAULT_TYPING_FX_STYLE} />,
      { container: document.body.appendChild(document.createElement('div')) },
    )
    expect(bare.container.querySelector('[data-typing-fx]')).toBeNull()
  })

  it('echoes a keystroke at the caret box and retires the ghost on animationend', () => {
    const { editor, view } = mount()
    mockCaret(editor)
    type(editor, 'a')
    const echo = view.container.querySelector('[data-typing-fx-echo]') as HTMLElement
    expect(echo).not.toBeNull()
    expect(echo.textContent).toBe('a')
    expect(echo.style.left).toBe('12px')
    expect(echo.style.top).toBe('24px')
    act(() => fireEvent.animationEnd(echo))
    expect(view.container.querySelector('[data-typing-fx-echo]')).toBeNull()
  })

  it('never echoes paste-tagged updates', () => {
    const { editor, view } = mount()
    mockCaret(editor)
    type(editor, 'pasted text', PASTE_TAG)
    expect(view.container.querySelector('[data-typing-fx-echo]')).toBeNull()
  })

  it('echoes the committed span once when an IME composition ends', () => {
    const { editor, view } = mount()
    mockCaret(editor)
    let nodeKey: NodeKey | null = null
    act(() => {
      editor.update(() => {
        const paragraph = $createParagraphNode()
        const text = $createTextNode('n')
        paragraph.append(text)
        $getRoot().append(paragraph)
        nodeKey = text.getKey()
        $setCompositionKey(nodeKey)
      }, { discrete: true, tag: COMPOSITION_START_TAG })
    })
    act(() => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey as NodeKey)
        if ($isTextNode(node)) node.setTextContent('nihao')
      }, { discrete: true })
    })
    expect(view.container.querySelector('[data-typing-fx-echo]')).toBeNull()
    act(() => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey as NodeKey)
        if ($isTextNode(node)) node.setTextContent('你好')
        $setCompositionKey(null)
      }, { discrete: true, tag: COMPOSITION_END_TAG })
    })
    const echo = view.container.querySelector('[data-typing-fx-echo]') as HTMLElement
    expect(echo).not.toBeNull()
    expect(echo.textContent).toBe('你好')
  })

  it('caps the live echo pool', () => {
    const { editor, view } = mount()
    mockCaret(editor)
    for (let index = 0; index < MAX_TYPING_FX_ECHOES + 3; index += 1) type(editor, `${index % 10}`)
    expect(view.container.querySelectorAll('[data-typing-fx-echo]')).toHaveLength(MAX_TYPING_FX_ECHOES)
  })

  it('stops spawning under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList)
    const { editor, view } = mount()
    mockCaret(editor)
    type(editor, 'a')
    expect(view.container.querySelector('[data-typing-fx-echo]')).toBeNull()
  })

  it('draws a custom caret only for non-native cursors, and hides it on ranged selection', () => {
    const block = mount({ style: { cursor: 'block' } })
    mockCaret(block.editor)
    type(block.editor, 'a')
    expect(block.view.container.querySelector('[data-typing-fx-caret="block"]')).not.toBeNull()
    cleanup()

    const native = mount({ style: { cursor: 'native' } })
    type(native.editor, 'b')
    expect(native.view.container.querySelector('[data-typing-fx-caret]')).toBeNull()
    cleanup()

    vi.restoreAllMocks()
    const ranged = mount({ style: { cursor: 'underline' } })
    mockCaret(ranged.editor, false)
    type(ranged.editor, 'c')
    expect(ranged.view.container.querySelector('[data-typing-fx-caret]')).toBeNull()
  })

  it('reflects speed and blink on the layer root', () => {
    const { view } = mount({ style: { speed: 160, cursorBlink: false, cursor: 'block' } })
    const root = view.container.querySelector('[data-typing-fx]') as HTMLElement
    expect(root.dataset.effect).toBe('drop')
    expect(root.dataset.blink).toBeUndefined()
    expect(root.style.getPropertyValue('--dsh-typing-fx-speed')).toBe('160')
  })

  it('publishes resolved colors as CSS vars and leaves them unset for theme', () => {
    const custom = mount({ style: { colors: { kind: 'custom', echo: '#aabbcc', caret: '#ddeeff', text: '#334455' } } })
    const customRoot = custom.view.container.querySelector('[data-typing-fx]') as HTMLElement
    expect(customRoot.style.getPropertyValue('--dsh-typing-fx-echo-color')).toBe('#aabbcc')
    expect(customRoot.style.getPropertyValue('--dsh-typing-fx-caret-color')).toBe('#ddeeff')
    cleanup()

    const preset = mount({ style: { colors: { kind: 'preset', id: 'ocean' } } })
    const presetRoot = preset.view.container.querySelector('[data-typing-fx]') as HTMLElement
    expect(presetRoot.style.getPropertyValue('--dsh-typing-fx-echo-color')).toBe('#7dd3fc')
    cleanup()

    const themed = mount()
    const themedRoot = themed.view.container.querySelector('[data-typing-fx]') as HTMLElement
    expect(themedRoot.style.getPropertyValue('--dsh-typing-fx-echo-color')).toBe('')
    expect(themedRoot.style.getPropertyValue('--dsh-typing-fx-caret-color')).toBe('')
  })

  it('drops listeners on unmount so later updates cannot spawn echoes', () => {
    const { editor, view } = mount()
    mockCaret(editor)
    view.unmount()
    expect(() => type(editor, 'z')).not.toThrow()
    expect(view.container.querySelector('[data-typing-fx-echo]')).toBeNull()
  })
})
