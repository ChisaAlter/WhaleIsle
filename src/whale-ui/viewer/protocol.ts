export const WHALE_CHANNEL = 'whale-ui' as const;
export const WHALE_VERSION = 2 as const;
export const WHALE_FRAME_PREFIX = 'whale-ui:';
export type SourceLanguage = 'whale-ui' | 'openui' | 'openui-lang' | 'dsh-ui';
export type InteractionState = Record<string, unknown>;
export type WhaleTheme = { appearance: 'light' | 'dark'; variables: Record<string, string> };
export type ResourcePath = '/api/wiki' | '/api/image-search' | '/api/street-route';
export type ActionResult = { ok: true } | { ok: false; error: string };
export type Diagnostic = { phase: 'parse' | 'evaluate' | 'render' | 'action' | 'state'; code: string; message: string; path?: string };
export type PanelOperation = { sourceId: string; order: number[]; append: boolean; spec: Record<string, unknown> };

type Envelope = { channel: typeof WHALE_CHANNEL; version: typeof WHALE_VERSION; instanceId: string };
export type HostMessage = Envelope & (
  | { type: 'render'; program: string; language: SourceLanguage; streaming: boolean; state: InteractionState; theme: WhaleTheme; locale: 'zh' | 'en'; panel?: boolean }
  | { type: 'resource-response'; requestId: string; status: number; body: unknown }
  | { type: 'action-response'; requestId: string; result: ActionResult }
  | { type: 'bundle-response'; requestId: string; name: string; base64?: string; error?: string }
);
export type ViewerMessage = Envelope & (
  | { type: 'ready' }
  | { type: 'height'; height: number }
  | { type: 'title'; title: string }
  | { type: 'state'; state: InteractionState }
  | { type: 'action'; requestId: string; action: 'assistant'; message: string; formState?: unknown; context?: unknown }
  | { type: 'action'; requestId: string; action: 'open-url'; url: string }
  | { type: 'action'; requestId: string; action: 'clipboard'; text: string }
  | { type: 'action'; requestId: string; action: 'download'; filename: string; mime: string; content: string }
  | { type: 'diagnostics'; program: string; complete: boolean; diagnostics: Diagnostic[] }
  | { type: 'panel'; operation: PanelOperation }
  | { type: 'resource'; requestId: string; path: ResourcePath; query: Record<string, string> }
  | { type: 'bundle'; requestId: string; name: string }
);
export type ViewerEvent = ViewerMessage extends infer Message ? Message extends Envelope ? Omit<Message, keyof Envelope> : never : never;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isHostMessage(value: unknown, instanceId: string): value is HostMessage {
  if (!isRecord(value) || value.channel !== WHALE_CHANNEL || value.version !== WHALE_VERSION || value.instanceId !== instanceId) return false;
  if (value.type === 'render') {
    return typeof value.program === 'string' && typeof value.streaming === 'boolean'
      && ['whale-ui', 'openui', 'openui-lang', 'dsh-ui'].includes(String(value.language))
      && isRecord(value.state) && isRecord(value.theme) && isRecord(value.theme.variables)
      && (value.theme.appearance === 'light' || value.theme.appearance === 'dark')
      && (value.locale === 'zh' || value.locale === 'en');
  }
  if (typeof value.requestId !== 'string') return false;
  if (value.type === 'resource-response') return Number.isInteger(value.status) && Number(value.status) >= 200 && Number(value.status) <= 599;
  if (value.type === 'action-response') return isRecord(value.result) && typeof value.result.ok === 'boolean';
  return value.type === 'bundle-response' && typeof value.name === 'string'
    && (typeof value.base64 === 'string' || typeof value.error === 'string');
}
