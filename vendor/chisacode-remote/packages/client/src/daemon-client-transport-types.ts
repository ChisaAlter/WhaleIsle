export type TransportMode = "lan" | "p2p" | "turn" | "relay";

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RtcSessionDescriptionLike {
  type: string;
  sdp?: string;
}

export interface RtcIceCandidateInitLike {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface RtcDataChannelLike {
  label?: string;
  readyState: string;
  binaryType: string;
  bufferedAmount?: number;
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(): void;
  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface RtcPeerConnectionLike {
  iceConnectionState?: string;
  connectionState?: string;
  signalingState?: string;
  createDataChannel(label: string, options?: { ordered?: boolean }): RtcDataChannelLike;
  createOffer(): Promise<RtcSessionDescriptionLike>;
  setLocalDescription(desc: RtcSessionDescriptionLike): Promise<void>;
  setRemoteDescription(desc: RtcSessionDescriptionLike): Promise<void>;
  addIceCandidate(candidate: RtcIceCandidateInitLike | null): Promise<void>;
  close(): void;
  onicecandidate: ((event: { candidate: RtcIceCandidateInitLike | null }) => void) | null;
  oniceconnectionstatechange?: (() => void) | null;
  onconnectionstatechange?: (() => void) | null;
}

export type RtcPeerConnectionFactory = (config: {
  iceServers: IceServerConfig[];
}) => RtcPeerConnectionLike;

export interface DaemonTransport {
  send: (data: string | Uint8Array | ArrayBuffer) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (handler: (data: unknown) => void) => () => void;
  onOpen: (handler: () => void) => () => void;
  onClose: (handler: (event?: unknown) => void) => () => void;
  onError: (handler: (event?: unknown) => void) => () => void;
  getRelaySecurityContext?: () => RelaySecurityContext | null;
  getTransportMode?: () => TransportMode | null;
  onTransportModeChange?: (handler: (mode: TransportMode) => void) => () => void;
}

/** Values from the encrypted relay handshake used to bind device authentication. */
export interface RelaySecurityContext {
  clientPublicKeyB64: string;
  authChallenge?: string;
}

export type DaemonTransportFactory = (options: {
  url: string;
  headers?: Record<string, string>;
  protocols?: string[];
}) => DaemonTransport;

export type WebSocketFactory = (
  url: string,
  options?: { headers?: Record<string, string>; protocols?: string[] },
) => WebSocketLike;

export interface WebSocketLike {
  readyState: number;
  send: (data: string | Uint8Array | ArrayBuffer) => void;
  close: (code?: number, reason?: string) => void;
  binaryType?: string;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  addEventListener?: (event: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (event: string, listener: (event: unknown) => void) => void;
  onopen?: ((event: unknown) => void) | null;
  onclose?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onmessage?: ((event: unknown) => void) | null;
}

export interface TransportLogger {
  warn(obj: object, msg?: string): void;
}
