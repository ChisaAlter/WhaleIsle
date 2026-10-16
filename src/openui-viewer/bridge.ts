import {
  OPENUI_CHANNEL,
  OPENUI_FRAME_PREFIX,
  OPENUI_VERSION,
  isHostMessage,
  type OpenUiApiPath,
  type OpenUiHostMessage,
  type OpenUiViewerEvent,
} from "./protocol";

const API_PATHS = new Set<OpenUiApiPath>(["/api/wiki", "/api/image-search", "/api/street-route"]);
type ApiResponse = Extract<OpenUiHostMessage, { type: "api-response" }>;
type ClipboardResponse = Extract<OpenUiHostMessage, { type: "clipboard-response" }>;
type Pending<Response> = { resolve: (response: Response) => void; reject: (error: Error) => void };

/** A single iframe talks only to its exact parent and its fixed instance id. */
export function createHostBridge(onRender: (message: Extract<OpenUiHostMessage, { type: "render" }>) => void) {
  const instanceId = window.name.startsWith(OPENUI_FRAME_PREFIX) ? window.name.slice(OPENUI_FRAME_PREFIX.length) : "";
  if (!instanceId || window.parent === window) throw new Error("OpenUI viewer must be embedded by WhaleIsle.");
  let parentOrigin = "*";
  let sequence = 0;
  const apiPending = new Map<string, Pending<ApiResponse>>();
  const clipboardPending = new Map<string, Pending<ClipboardResponse>>();

  const post = (event: OpenUiViewerEvent) => {
    window.parent.postMessage({ channel: OPENUI_CHANNEL, version: OPENUI_VERSION, instanceId, ...event }, parentOrigin);
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || !isHostMessage(event.data, instanceId)) return;
    if (parentOrigin !== "*" && event.origin !== parentOrigin) return;
    if (event.origin !== "null") parentOrigin = event.origin;
    const message = event.data;
    if (message.type === "render") onRender(message);
    else if (message.type === "api-response") {
      const pending = apiPending.get(message.requestId);
      if (pending) { apiPending.delete(message.requestId); pending.resolve(message); }
    } else if (message.type === "clipboard-response") {
      const pending = clipboardPending.get(message.requestId);
      if (pending) { clipboardPending.delete(message.requestId); pending.resolve(message); }
    }
  };
  window.addEventListener("message", onMessage);

  const clipboard = async (text: string) => {
    const requestId = `${instanceId}:clipboard:${++sequence}`;
    const response = await new Promise<ClipboardResponse>((resolve, reject) => {
      clipboardPending.set(requestId, { resolve, reject });
      post({ type: "clipboard", requestId, text });
    });
    if (!response.ok) throw new Error(response.error || "Could not copy to the clipboard.");
  };

  /** Keep the upstream fetch call sites, but authenticate the three JSON helpers in the parent. */
  const installBrowserAdapters = () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // srcDoc has an opaque origin. A fixed parse base is used only to split these relative helper paths.
      const url = new URL(rawUrl, "https://openui-viewer.invalid");
      if (!rawUrl.startsWith("/") || !API_PATHS.has(url.pathname as OpenUiApiPath)) return originalFetch(input, init);
      const requestId = `${instanceId}:api:${++sequence}`;
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => {
          apiPending.delete(requestId);
          reject(new DOMException("The request was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        apiPending.set(requestId, {
          resolve: (response) => {
            signal?.removeEventListener("abort", onAbort);
            const body = response.status === 204 || response.status === 205 || response.status === 304 ? null : JSON.stringify(response.body);
            resolve(new Response(body, { status: response.status, headers: { "Content-Type": "application/json" } }));
          },
          reject,
        });
        post({ type: "api-request", requestId, path: url.pathname as OpenUiApiPath, query: Object.fromEntries(url.searchParams) });
      });
    };
    // The upstream Code component uses this browser API directly; both copy entry points use the same host action.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    window.open = (url?: string | URL) => {
      openUrl(String(url ?? ""));
      return null;
    };
    document.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link) return;
      event.preventDefault();
      openUrl(link.getAttribute("href") || "");
    });
  };

  const openUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") post({ type: "open-url", url: url.href });
    } catch { /* Model-written non-web URLs are not navigation requests. */ }
  };

  window.addEventListener("pagehide", () => {
    const error = new Error("OpenUI viewer was closed.");
    for (const pending of apiPending.values()) pending.reject(error);
    for (const pending of clipboardPending.values()) pending.reject(error);
    apiPending.clear();
    clipboardPending.clear();
    window.removeEventListener("message", onMessage);
  }, { once: true });

  return { instanceId, post, clipboard, openUrl, installBrowserAdapters };
}
