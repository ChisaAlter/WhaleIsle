import '../components/styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, type OpenUIError, type ParseResult, type ActionEvent } from '../language/index.ts';
import { Renderer } from '../react/index.ts';
import { createWhaleLibrary } from '../library.ts';
import { compileDocument, genuiComponents } from '../runtime/genui-adapter.tsx';
import { RenderDiagnosticsContext } from '../runtime/render-diagnostics.ts';
import { createPersistentStore, documentState, restoreDocumentState } from '../runtime/state.ts';
import { setGenuiAssetLoader, setGenuiBundleLoader, setGenuiDownloadHandler, setGenuiLocale } from '../genui/embed.ts';
import { createHostBridge } from './bridge.ts';
import { applyTheme } from './theme.ts';
import type { HostMessage, Diagnostic } from './protocol.ts';

declare const __WHALE_MAP_WORKER_SOURCE__: string;
declare global { var __WHALE_OPENUI_MAP_WORKER_URL__: string | undefined; }
globalThis.__WHALE_OPENUI_MAP_WORKER_URL__ = `data:text/javascript;charset=utf-8,${encodeURIComponent(__WHALE_MAP_WORKER_SOURCE__)}`;
const library = createWhaleLibrary(genuiComponents);
type RenderMessage = Extract<HostMessage, { type: 'render' }>;

class RenderBoundary extends Component<{ program: string; children: ReactNode; onError: (message: string) => void }, { error: string | null; program: string }> {
  state = { error: null as string | null, program: this.props.program };
  static getDerivedStateFromProps(props: { program: string }, state: { program: string }) { return props.program !== state.program ? { error: null, program: props.program } : null; }
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error) { this.props.onError(error.message); }
  render() { return this.state.error ? <p role="alert" className="whale-viewer-error">{this.state.error}</p> : this.props.children; }
}

function Viewer() {
  const [message, setMessage] = useState<RenderMessage | null>(null);
  const [runtimeResult, setRuntimeResult] = useState<{ key: string; errors: Diagnostic[] } | null>(null);
  const [parseResult, setParseResult] = useState<{ key: string; result: ParseResult | null } | null>(null);
  const [hostFault, setHostFault] = useState<{ key: string; error: Diagnostic } | null>(null);
  const [renderDiagnostics, setRenderDiagnostics] = useState<Record<string, { key: string; errors: Diagnostic[] }>>({});
  const [bridge] = useState(() => createHostBridge(setMessage));
  const [store] = useState(() => createPersistentStore(createStore));
  const initialState = useRef<{ values: Record<string, unknown>; error?: Diagnostic } | null>(null);
  const root = useRef<HTMLElement>(null);
  const variables = useRef<string[]>([]);
  const reported = useRef('');
  const panelSource = useRef('');
  const compiled = useMemo(() => message ? compileDocument(message.program, message.language, message.streaming) : null, [message?.program, message?.language, message?.streaming]);
  const sourceKey = JSON.stringify([compiled?.program, message?.streaming]);
  const currentKey = useRef(sourceKey);
  currentKey.current = sourceKey;
  const reportRenderDiagnostics = useCallback((owner: string, key: string, errors: Diagnostic[]) => {
    if (key !== currentKey.current) return;
    setRenderDiagnostics(previous => {
      if (errors.length === 0 && !previous[owner]) return previous;
      if (previous[owner]?.key === key && JSON.stringify(previous[owner].errors) === JSON.stringify(errors)) return previous;
      const next = Object.fromEntries(Object.entries(previous).filter(([id, value]) => id !== owner && value.key === key));
      return errors.length ? { ...next, [owner]: { key, errors } } : next;
    });
  }, []);
  const renderDiagnosticsOwner = useMemo(() => ({ sourceId: sourceKey, report: reportRenderDiagnostics }), [sourceKey, reportRenderDiagnostics]);
  const fault = useCallback((error: unknown, phase: Diagnostic['phase'] = 'render') => {
    setHostFault({ key: currentKey.current, error: { phase, code: 'runtime-error', message: error instanceof Error ? error.message : String(error) } });
  }, []);

  useEffect(() => {
    const uninstall = bridge.installBrowserAdapters(error => fault(error, 'action'));
    const onError = (event: ErrorEvent) => fault(event.error ?? event.message);
    const onPromise = (event: PromiseRejectionEvent) => fault(event.reason, 'action');
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onPromise);
    const assets = new Map<string, Promise<Uint8Array>>();
    const bytes = (name: string) => {
      let task = assets.get(name);
      if (!task) { task = bridge.bundle(name); assets.set(name, task); }
      return task;
    };
    setGenuiBundleLoader(bytes);
    setGenuiAssetLoader(async name => {
      const data = await bytes(`${name}.js`);
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'text/javascript' }));
      try {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.onload = () => { script.remove(); resolve(); };
          script.onerror = () => { script.remove(); reject(new Error(`The ${name} rendering engine could not start.`)); };
          document.head.append(script);
        });
        const key = name.replace(/-(\w)/g, (_match, character: string) => character.toUpperCase());
        const engine = (window as Window & { __GenuiAssets__?: Record<string, unknown> }).__GenuiAssets__?.[key];
        if (!engine) throw new Error(`The ${name} rendering engine did not register.`);
        return engine;
      } finally { URL.revokeObjectURL(url); }
    });
    setGenuiDownloadHandler(async (blob, filename) => { await bridge.action({ action: 'download', filename, mime: blob.type, content: await blob.text() }); });
    const unsubscribe = store.subscribePersisted(state => bridge.post({ type: 'state', state: documentState(state) }));
    return () => {
      unsubscribe(); uninstall(); bridge.dispose(); store.dispose();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onPromise);
    };
  }, [bridge, store, fault]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    let lastHeight = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = Math.ceil(element.getBoundingClientRect().height);
        if (height !== lastHeight) { lastHeight = height; bridge.post({ type: 'height', height }); }
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    bridge.post({ type: 'ready' });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [bridge]);

  useEffect(() => {
    if (!message) return;
    variables.current = applyTheme(message.theme, variables.current);
    document.documentElement.lang = message.locale === 'zh' ? 'zh-CN' : 'en';
    setGenuiLocale(message.locale);
  }, [message?.theme, message?.locale]);

  const onError = useCallback((errors: OpenUIError[]) => {
    setRuntimeResult({ key: sourceKey, errors: errors.filter(error => error.severity !== 'warning').map(error => ({ phase: error.source === 'parser' ? 'parse' : 'evaluate', code: error.code, message: error.message, path: error.path })) });
  }, [sourceKey]);
  const onParseResult = useCallback((result: ParseResult | null) => { setParseResult({ key: sourceKey, result }); }, [sourceKey]);
  const parse = parseResult?.key === sourceKey ? parseResult.result : null;
  const runtimeErrors = runtimeResult?.key === sourceKey ? runtimeResult.errors : [];
  if (message && initialState.current === null) {
    try { initialState.current = { values: restoreDocumentState(message.state) }; }
    catch (error) { initialState.current = { values: {}, error: { phase: 'state', code: 'invalid-state', message: error instanceof Error ? error.message : String(error) } }; }
  }
  const stateError = initialState.current?.error;
  const parseDiagnostics: Diagnostic[] = !message?.streaming && parse ? [
    ...(parse.meta.incomplete ? [{ phase: 'parse' as const, code: 'incomplete-input', message: 'The completed program contains an incomplete statement.' }] : []),
    ...(parse.meta.unresolved.length ? [{ phase: 'parse' as const, code: 'unresolved-reference', message: `Undefined references: ${parse.meta.unresolved.join(', ')}.` }] : []),
    ...(parse.queryStatements.length || parse.mutationStatements.length ? [{ phase: 'evaluate' as const, code: 'unsupported-business-provider', message: 'This interface has no business-tool provider. Obtain data using the conversation tools first.' }] : []),
  ] : [];
  const diagnostics = [...(compiled?.diagnostics ?? []), ...runtimeErrors, ...parseDiagnostics, ...(stateError ? [stateError] : []), ...(hostFault?.key === sourceKey ? [hostFault.error] : []), ...Object.values(renderDiagnostics).filter(value => value.key === sourceKey).flatMap(value => value.errors)];
  const complete = !!message && !message.streaming && compiled?.complete === true && !!parse && runtimeResult?.key === sourceKey
    && !parse.meta.incomplete && parse.meta.unresolved.length === 0 && parse.meta.errors.every(error => error.severity === 'warning') && diagnostics.length === 0;
  useEffect(() => {
    if (!message) return;
    const signature = JSON.stringify([message.program, complete, diagnostics]);
    if (signature === reported.current) return;
    reported.current = signature;
    bridge.post({ type: 'diagnostics', program: message.program, complete, diagnostics });
  }, [message?.program, complete, JSON.stringify(diagnostics), bridge]);
  useEffect(() => {
    if (!message || message.streaming || message.panel || !compiled?.panel || !complete) return;
    const signature = JSON.stringify(compiled.panel);
    if (signature === panelSource.current) return;
    panelSource.current = signature;
    bridge.post({ type: 'panel', operation: { sourceId: bridge.instanceId, order: [], append: compiled.panel.append, spec: compiled.panel.spec as unknown as Record<string, unknown> } });
  }, [compiled, message?.streaming, message?.panel, bridge, complete]);

  const onAction = useCallback(async (event: ActionEvent) => {
    setHostFault(null);
    if (event.type === 'continue_conversation') await bridge.action({ action: 'assistant', message: event.humanFriendlyMessage, formState: event.formState, context: event.params?.context });
    else if (event.type === 'open_url' && typeof event.params?.url === 'string') await bridge.action({ action: 'open-url', url: event.params.url });
    else if (event.type === 'CopyToClipboard' && typeof event.params?.text === 'string') await bridge.action({ action: 'clipboard', text: event.params.text });
    else throw new Error(`Whale UI does not provide the ${event.type} host action.`);
    return { ok: true };
  }, [bridge]);
  return <main ref={root} className="whale-viewer-root">
    {message && compiled && !stateError && <RenderDiagnosticsContext.Provider value={renderDiagnosticsOwner}>
      <RenderBoundary program={compiled.program} onError={fault}>
        <Renderer response={compiled.program} library={library} isStreaming={message.streaming} store={store}
          initialState={initialState.current?.values ?? {}} onAction={onAction} onError={onError} onParseResult={onParseResult} />
      </RenderBoundary>
    </RenderDiagnosticsContext.Provider>}
    {!message?.streaming && diagnostics.length > 0 && <details className="whale-viewer-diagnostics" open>
      <summary>{message?.locale === 'zh' ? '界面诊断' : 'Interface diagnostics'}</summary>
      <ul>{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}:${index}`}>{diagnostic.path ? `${diagnostic.path}: ` : ''}{diagnostic.message}</li>)}</ul>
    </details>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Viewer />);
