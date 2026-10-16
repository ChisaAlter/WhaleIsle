import "@openuidev/react-ui/styles/index.css";
import "./viewer.css";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BuiltinActionType, Renderer, type ActionEvent, type OpenUIError, type ParseResult } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import { library } from "../../vendor/open-intelligent-ui/src/lib/library";
import { createHostBridge } from "./bridge";
import type { OpenUiHostMessage, OpenUiState } from "./protocol";
import { subscribePersistedViewerState } from "./state-store";

declare const __OPENUI_MAP_WORKER_SOURCE__: string;
declare global { var __WHALE_OPENUI_MAP_WORKER_URL__: string | undefined; }

// Chromium rejects module workers at blob:null URLs from an opaque srcDoc.
// A data module keeps the bundled worker self-contained and the sandbox opaque.
const mapWorkerUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(__OPENUI_MAP_WORKER_SOURCE__)}`;
globalThis.__WHALE_OPENUI_MAP_WORKER_URL__ = mapWorkerUrl;

type RenderMessage = Extract<OpenUiHostMessage, { type: "render" }>;
let receiveRender: (message: RenderMessage) => void;
let activeProgram = "";
let failedProgram: string | null = null;
const bridge = createHostBridge((message) => { activeProgram = message.program; receiveRender(message); });
bridge.installBrowserAdapters();

function reportError(error: unknown, code?: string) {
  failedProgram = activeProgram;
  bridge.post({ type: "error", message: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) });
}
window.addEventListener("error", (event) => reportError(event.error ?? event.message, "runtime"));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "promise"));

class RenderBoundary extends Component<{ program: string; children: ReactNode }, { error: string | null; program: string }> {
  state = { error: null as string | null, program: this.props.program };
  static getDerivedStateFromProps(props: { program: string }, state: { program: string; error: string | null }) {
    return props.program !== state.program ? { program: props.program, error: null } : null;
  }
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { reportError(error, "render"); void info; }
  render() {
    return this.state.error ? <p className="openui-viewer-error" role="alert">{this.state.error}</p> : this.props.children;
  }
}

function onAction(event: ActionEvent) {
  if (event.type === BuiltinActionType.ContinueConversation) {
    bridge.post({ type: "assistant", message: event.humanFriendlyMessage, formState: event.formState, context: event.params?.context });
  } else if (event.type === BuiltinActionType.OpenUrl) {
    if (typeof event.params?.url === "string") bridge.openUrl(event.params.url);
  } else if (event.type === "CopyToClipboard" && typeof event.params?.text === "string") {
    void bridge.clipboard(event.params.text).catch((error) => reportError(error, "clipboard"));
  }
}

function Viewer() {
  const [message, setMessage] = useState<RenderMessage | null>(null);
  const root = useRef<HTMLElement>(null);
  const lastHeight = useRef(0);
  const previousVariables = useRef<string[]>([]);
  const latestState = useRef<OpenUiState | null>(null);
  const validation = useRef<{ program: string; parsed: boolean; errors: OpenUIError[] }>({ program: "", parsed: false, errors: [] });
  const resolvedProgram = useRef<string | null>(null);
  if (message && validation.current.program !== message.program) validation.current = { program: message.program, parsed: false, errors: validation.current.errors };
  receiveRender = setMessage;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Upstream Popover portals are fixed in body, outside the normal-flow
        // answer. Include their extent so a short inline answer cannot clip them.
        const overlays = Array.from(document.querySelectorAll<HTMLElement>(".iui-popover"));
        const height = Math.ceil(Math.max(element.getBoundingClientRect().height,
          ...overlays.map((overlay) => overlay.getBoundingClientRect().bottom + 12)));
        if (height !== lastHeight.current) { lastHeight.current = height; bridge.post({ type: "height", height }); }
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const portals = new MutationObserver(measure);
    portals.observe(document.body, { childList: true, subtree: true });
    measure();
    bridge.post({ type: "ready" });
    return () => { observer.disconnect(); portals.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!message) return;
    const html = document.documentElement;
    html.dataset.theme = message.theme.appearance;
    html.dataset.openuiTheme = message.theme.appearance;
    html.style.colorScheme = message.theme.appearance;
    for (const key of previousVariables.current) html.style.removeProperty(key);
    const inherited = message.theme.variables;
    // Host text follows the chat. Keep the SDK foreground opaque: upstream
    // also uses it as inverse text on solid buttons, not just as a surface.
    const mapped = {
      ...inherited,
      ...(inherited["--text"] ? { "--openui-text-neutral-primary": inherited["--text"] } : {}),
      ...(inherited["--text-secondary"] ? { "--openui-text-neutral-secondary": inherited["--text-secondary"] } : {}),
    };
    const variables = Object.entries(mapped).filter(([key, value]) => key.startsWith("--") && typeof value === "string");
    for (const [key, value] of variables) html.style.setProperty(key, value);
    previousVariables.current = variables.map(([key]) => key);
  }, [message?.theme]);

  useEffect(() => {
    if (!message || message.streaming) return;
    // Child Renderer effects publish parse and runtime errors before this frame.
    // A state/theme update alone cannot clear a failure for the same program.
    const frame = requestAnimationFrame(() => {
      const current = validation.current;
      if (current.program === message.program && current.parsed && current.errors.length === 0
        && failedProgram !== message.program && resolvedProgram.current !== message.program) {
        resolvedProgram.current = message.program;
        bridge.post({ type: "resolved", program: message.program });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [message?.program, message?.streaming]);

  useEffect(() => subscribePersistedViewerState((state) => {
    // The SDK's full snapshot includes pristine partial streamed defaults;
    // its ordinary change callback also omits same-value dirty transitions.
    latestState.current = state;
    bridge.post({ type: "state", state });
  }), []);
  const onError = (errors: OpenUIError[]) => {
    validation.current.errors = errors;
    if (!message?.streaming) for (const error of errors) reportError(error.message, error.code);
  };
  const onParseResult = (result: ParseResult | null) => {
    validation.current.parsed = !!result && result.meta.errors.length === 0;
  };

  return (
    <main ref={root} className="openui-viewer-root">
      {message && <ThemeProvider mode={message.theme.appearance} cssSelector="html">
        <RenderBoundary program={message.program}>
          <Renderer response={message.program} library={library} isStreaming={message.streaming}
            initialState={latestState.current ?? message.state} onAction={onAction}
            onError={onError} onParseResult={onParseResult} />
        </RenderBoundary>
      </ThemeProvider>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Viewer />);
