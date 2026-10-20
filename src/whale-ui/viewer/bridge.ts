import { isHostMessage, WHALE_CHANNEL, WHALE_FRAME_PREFIX, WHALE_VERSION, type HostMessage, type ViewerEvent } from './protocol.ts';

type RenderMessage = Extract<HostMessage, { type: 'render' }>;
type Pending = { resolve: (value: HostMessage) => void; reject: (error: Error) => void };
type ActionPayload =
  | { action: 'assistant'; message: string; formState?: unknown; context?: unknown }
  | { action: 'clipboard'; text: string }
  | { action: 'open-url'; url: string }
  | { action: 'download'; filename: string; mime: string; content: string };

/** An iframe has one parent, one instance, and one pending-operation owner. */
export function createHostBridge(onRender: (message: RenderMessage) => void) {
  const instanceId = window.name.startsWith(WHALE_FRAME_PREFIX) ? window.name.slice(WHALE_FRAME_PREFIX.length) : '';
  if (!instanceId || window.parent === window) throw new Error('Whale UI requires its conversation host.');
  let parentOrigin = '*';
  let sequence = 0;
  let sourceRevision = 0;
  let source = '';
  let disposed = false;
  const pending = new Map<string, Pending>();
  const post = (event: ViewerEvent) => {
    window.parent.postMessage({ channel: WHALE_CHANNEL, version: WHALE_VERSION, instanceId, ...event }, parentOrigin);
  };
  const request = (event: Omit<Extract<ViewerEvent, { requestId: string }>, 'requestId'>, signal?: AbortSignal | null) => {
    if (disposed) return Promise.reject(new Error('The Whale UI document was closed.'));
    const requestId = `${instanceId}:${++sequence}`;
    if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    return new Promise<HostMessage>((resolve, reject) => {
      const abort = () => { pending.delete(requestId); reject(new DOMException('The operation was aborted.', 'AbortError')); };
      pending.set(requestId, {
        resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); },
        reject: error => { signal?.removeEventListener('abort', abort); reject(error); },
      });
      signal?.addEventListener('abort', abort, { once: true });
      post({ ...event, requestId } as ViewerEvent);
    });
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent || !isHostMessage(event.data, instanceId)) return;
    if (parentOrigin !== '*' && event.origin !== parentOrigin) return;
    if (event.origin !== 'null') parentOrigin = event.origin;
    const message = event.data;
    if (message.type === 'render') {
      const next = JSON.stringify([message.language, message.program, message.streaming]);
      if (next !== source) { source = next; sourceRevision++; }
      onRender(message); return;
    }
    const operation = pending.get(message.requestId);
    if (!operation) return;
    pending.delete(message.requestId);
    operation.resolve(message);
  };
  window.addEventListener('message', receive);
  const action = async (payload: ActionPayload) => {
    const response = await request({ type: 'action', ...payload } as Omit<Extract<ViewerEvent, { requestId: string }>, 'requestId'>);
    if (response.type !== 'action-response') throw new Error('Whale UI action response is invalid.');
    if (!response.result.ok) throw new Error(response.result.error);
  };
  const openUrl = async (value: string) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) links can be opened.');
    await action({ action: 'open-url', url: url.href });
  };
  const bundle = async (name: string) => {
    const response = await request({ type: 'bundle', name } as Omit<Extract<ViewerEvent, { requestId: string }>, 'requestId'>);
    if (response.type !== 'bundle-response' || response.name !== name) throw new Error('Whale UI asset response is invalid.');
    if (response.error || !response.base64) throw new Error(response.error ?? `Whale UI asset ${name} is empty.`);
    return Uint8Array.from(atob(response.base64), character => character.charCodeAt(0));
  };
  const installBrowserAdapters = (onError: (error: unknown) => void) => {
    const originalFetch = window.fetch.bind(window);
    const originalOpen = window.open;
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const resourcePaths = new Set(['/api/wiki', '/api/image-search', '/api/street-route']);
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'https://whale-ui.invalid');
      if (!raw.startsWith('/') || !resourcePaths.has(url.pathname)) return originalFetch(input, init);
      const response = await request({ type: 'resource', path: url.pathname, query: Object.fromEntries(url.searchParams) } as Omit<Extract<ViewerEvent, { requestId: string }>, 'requestId'>, init?.signal ?? (input instanceof Request ? input.signal : undefined));
      if (response.type !== 'resource-response') throw new Error('Whale UI resource response is invalid.');
      return new Response([204, 205, 304].includes(response.status) ? null : JSON.stringify(response.body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => action({ action: 'clipboard', text }) } });
    const openCurrentUrl = (url: string) => {
      const revision = sourceRevision;
      void openUrl(url).catch(error => { if (sourceRevision === revision) onError(error); });
    };
    window.open = (url?: string | URL) => { openCurrentUrl(String(url ?? '')); return null; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link) return;
      event.preventDefault();
      openCurrentUrl(link.getAttribute('href') ?? '');
    };
    document.addEventListener('click', click);
    return () => {
      window.fetch = originalFetch;
      window.open = originalOpen;
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
      document.removeEventListener('click', click);
    };
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    sourceRevision++;
    const error = new Error('The Whale UI document was closed.');
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return { instanceId, post, action, bundle, installBrowserAdapters, dispose };
}
