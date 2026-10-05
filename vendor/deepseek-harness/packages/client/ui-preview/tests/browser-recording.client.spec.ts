// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  frameSubscription,
  onPreviewRecordingFrame,
  previewSaveRecording,
  previewStartRecording,
  previewStopRecording,
} = vi.hoisted(() => {
  type Frame = {
    readonly id: string
    readonly data: string
    readonly width: number
    readonly height: number
  }
  const frameSubscription: { listener: ((frame: Frame) => void) | null } = { listener: null }
  return {
    frameSubscription,
    onPreviewRecordingFrame: vi.fn((listener: (frame: Frame) => void) => {
      frameSubscription.listener = listener
      return () => {
        if (frameSubscription.listener === listener) frameSubscription.listener = null
      }
    }),
    previewSaveRecording: vi.fn(async () => ({ ok: true, path: '/tmp/recording-test.webm' })),
    previewStartRecording: vi.fn(async (id: string) => {
      frameSubscription.listener?.({
        id,
        data: 'initial-frame',
        width: 800,
        height: 600,
      })
      return { ok: true }
    }),
    previewStopRecording: vi.fn(async () => ({ ok: true })),
  }
})

import {
  startBrowserRecording,
  stopBrowserRecording,
} from '../src/client/browserRecording.ts'

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true
  }

  state: RecordingState = 'inactive'
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    for (const listener of this.listeners.get('stop') ?? []) {
      if (typeof listener === 'function') listener(new Event('stop'))
      else listener.handleEvent(new Event('stop'))
    }
  }
}

function recordingBridge() {
  return {
    previewStartRecording,
    previewStopRecording,
    onPreviewRecordingFrame,
    previewSaveRecording,
  }
}

describe('browser recording', () => {
  beforeEach(() => {
    frameSubscription.listener = null
    vi.clearAllMocks()
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder as unknown as typeof MediaRecorder)
    class ImmediateImage {
      private loadListener: EventListenerOrEventListenerObject | undefined

      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type === 'load') this.loadListener = listener
      }

      set src(_value: string) {
        const event = new Event('load')
        if (typeof this.loadListener === 'function') this.loadListener(event)
        else this.loadListener?.handleEvent(event)
      }
    }
    vi.stubGlobal('Image', ImmediateImage as unknown as typeof Image)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws the first frame and saves an artifact on stop', async () => {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      captureStream: () => ({}),
      getContext: () => ({ drawImage, fillRect, fillStyle: '' }),
    }
    const nativeCreateElement = Document.prototype.createElement
    const htmlDocument: { createElement(tag: string, options?: ElementCreationOptions): HTMLElement } = document
    vi.spyOn(htmlDocument, 'createElement').mockImplementation(function createElement(
      this: Document,
      tag: string,
      options?: ElementCreationOptions,
    ) {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement
      return Reflect.apply(nativeCreateElement, this, [tag, options]) as HTMLElement
    })

    const started = await startBrowserRecording('pv-1', recordingBridge())
    expect(started.ok).toBe(true)
    expect(previewStartRecording).toHaveBeenCalledWith('pv-1')
    expect(canvas).toMatchObject({ width: 800, height: 600 })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600)
    expect(fillRect).toHaveBeenCalledWith(0, 0, 800, 600)

    await stopBrowserRecording('pv-1')
    expect(previewStopRecording).toHaveBeenCalled()
    expect(previewSaveRecording).toHaveBeenCalledWith('pv-1', expect.objectContaining({
      mimeType: expect.stringContaining('webm'),
      data: expect.any(ArrayBuffer),
    }))
  })
})
