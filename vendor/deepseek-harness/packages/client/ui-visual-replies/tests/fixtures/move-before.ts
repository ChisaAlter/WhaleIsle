/** jsdom can prove node identity, but cannot prove iframe browsing-context retention. */
import { afterAll, beforeAll } from 'vitest'

/** Simulate only DOM relocation where jsdom lacks the native atomic-move API. */
export function emulateMoveBeforeInJsdom(): void {
  const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore')
  beforeAll(() => {
    if (typeof Element.prototype.moveBefore === 'function') return
    Object.defineProperty(Element.prototype, 'moveBefore', {
      configurable: true,
      writable: true,
      value(this: Element, node: Node, child: Node | null): void { this.insertBefore(node, child) },
    })
  })
  afterAll(() => {
    if (previous === undefined) Reflect.deleteProperty(Element.prototype, 'moveBefore')
    else Object.defineProperty(Element.prototype, 'moveBefore', previous)
  })
}
