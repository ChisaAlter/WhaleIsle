export const OPENUI_CHANNEL = "whale-openui" as const;
export const OPENUI_VERSION = 1 as const;
export const OPENUI_FRAME_PREFIX = "whale-openui:";

export type OpenUiState = Record<string, unknown>;
export type OpenUiTheme = {
  appearance: "light" | "dark";
  variables: Record<string, string>;
};
export type OpenUiApiPath = "/api/wiki" | "/api/image-search" | "/api/street-route";

type Envelope = {
  channel: typeof OPENUI_CHANNEL;
  version: typeof OPENUI_VERSION;
  instanceId: string;
};

export type OpenUiHostMessage = Envelope & (
  | { type: "render"; program: string; streaming: boolean; state: OpenUiState; theme: OpenUiTheme }
  | { type: "api-response"; requestId: string; status: number; body: unknown }
  | { type: "clipboard-response"; requestId: string; ok: boolean; error?: string }
);

export type OpenUiViewerMessage = Envelope & (
  | { type: "ready" }
  | { type: "height"; height: number }
  | { type: "state"; state: OpenUiState }
  | { type: "assistant"; message: string; formState?: unknown; context?: unknown }
  | { type: "open-url"; url: string }
  | { type: "clipboard"; requestId: string; text: string }
  | { type: "error"; message: string; code?: string }
  | { type: "resolved"; program: string }
  | { type: "api-request"; requestId: string; path: OpenUiApiPath; query: Record<string, string> }
);

export type OpenUiViewerEvent = OpenUiViewerMessage extends infer Message
  ? Message extends Envelope ? Omit<Message, keyof Envelope> : never
  : never;

export function isHostMessage(value: unknown, instanceId: string): value is OpenUiHostMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== OPENUI_CHANNEL || message.version !== OPENUI_VERSION || message.instanceId !== instanceId) return false;
  if (message.type === "render") {
    const theme = message.theme as Partial<OpenUiTheme> | undefined;
    return typeof message.program === "string" && typeof message.streaming === "boolean"
      && !!message.state && typeof message.state === "object" && !Array.isArray(message.state)
      && !!theme && (theme.appearance === "light" || theme.appearance === "dark")
      && !!theme.variables && typeof theme.variables === "object" && !Array.isArray(theme.variables);
  }
  if (message.type === "api-response") {
    return typeof message.requestId === "string" && Number.isInteger(message.status)
      && Number(message.status) >= 200 && Number(message.status) <= 599;
  }
  if (message.type === "clipboard-response") return typeof message.requestId === "string" && typeof message.ok === "boolean";
  return false;
}
