/// <reference lib="dom" />
/**
 * Encrypted channel that wraps a WebSocket-like transport.
 *
 * Handles ECDH handshake and encrypts/decrypts all messages.
 * Works identically for daemon and client sides.
 */

import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptToBytes,
  decryptFromBytes,
  extractSeqFromBundle,
  ensurePrng,
  type KeyPair,
  type SharedKey,
  SALT_LENGTH,
} from "./crypto.js";
import nacl from "tweetnacl";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import {
  type BinaryDataChannelTransport,
  RTC_DRAIN_TIMEOUT_MS,
  RTC_UPGRADED_CLOSE_CODE,
  RTC_UPGRADED_CLOSE_REASON,
  RelayReorderBuffer,
  RelayRtcChunkReassembler,
  RelayRtcChunker,
  decodeDshuFrame,
  encodeDshuFrame,
} from "./rtc-leg.js";

export type { BinaryDataChannelTransport } from "./rtc-leg.js";

export interface ActivateWebRtcLegParams {
  dcTransport: BinaryDataChannelTransport;
  buildFinalPrimaryLegMessage?: (seq: bigint) => string | ArrayBuffer;
  peerPreviousLegEndSeq?: bigint | number | null;
  drainTimeoutMs?: number;
}

export interface Transport {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onmessage: ((data: string | ArrayBuffer) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
  onerror: ((error: Error) => void) | null;
}

export interface EncryptedChannelEvents {
  onopen?: () => void;
  onmessage?: (data: string | ArrayBuffer) => void;
  onclose?: (code: number, reason: string) => void;
  onerror?: (error: Error) => void;
}

type ChannelState = "connecting" | "handshaking" | "open" | "closed";

interface EncryptedChannelOptions {
  /**
   * If set, the channel can validate repeated plaintext `{type:"e2ee_hello"}`
   * messages even after it is open.
   *
   * This is useful for robustness when the client retries the handshake
   * (e.g., it didn't observe the daemon's `{type:"e2ee_ready"}` yet). In that case,
   * the daemon should re-send `{type:"e2ee_ready"}` without changing keys.
   */
  daemonKeyPair?: KeyPair;
  securityContext?: EncryptedChannelSecurityContext;
}

/** Channel-bound values used by the higher-level relay device-auth handshake. */
export interface EncryptedChannelSecurityContext {
  clientPublicKeyB64: string;
  authChallenge?: string;
}

interface E2EEHelloMessage {
  type: "e2ee_hello";
  key: string;
}

interface E2EEReadyMessage {
  type: "e2ee_ready";
  authChallenge?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isE2EEHelloMessage(value: unknown): value is E2EEHelloMessage {
  return (
    isRecord(value) &&
    value.type === "e2ee_hello" &&
    typeof value.key === "string" &&
    value.key.trim().length > 0
  );
}

function isE2EEReadyMessage(value: unknown): value is E2EEReadyMessage {
  return (
    isRecord(value) &&
    value.type === "e2ee_ready" &&
    (value.authChallenge === undefined ||
      (typeof value.authChallenge === "string" && value.authChallenge.trim().length > 0))
  );
}

function createAuthChallenge(): string {
  ensurePrng();
  const bytes = nacl.randomBytes(32);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return arrayBufferToBase64(copy.buffer);
}

function buildInvalidHelloError(rawText: string, parsed?: unknown): Error {
  const parsedRecord = isRecord(parsed) ? parsed : null;
  const rawType = parsedRecord?.type;
  function describeType(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    return typeof value;
  }
  const receivedType = describeType(rawType);
  const hasKey = typeof parsedRecord?.key === "string" && parsedRecord.key.trim().length > 0;
  const compact = rawText.replace(/\s+/g, " ").trim();
  const preview = compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
  return new Error(
    `Invalid hello message (receivedType=${receivedType}, hasKey=${hasKey}, preview=${JSON.stringify(preview)})`,
  );
}

const HANDSHAKE_RETRY_MS = 1000;
const MAX_PENDING_SENDS = 200;
const REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE = 1008;
const REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON = "E2EE re-handshake key mismatch";
// Fatal close used when a received frame violates replay protection (replayed
// or out-of-order seq, or a salt that differs from the first frame's salt).
const REPLAY_PROTECTION_CLOSE_CODE = 1011;
const REPLAY_PROTECTION_CLOSE_REASON = "E2EE replay protection violation";

interface TimeoutWithUnref {
  unref(): void;
}

function hasUnref(timeout: unknown): timeout is TimeoutWithUnref {
  return (
    typeof timeout === "object" &&
    timeout !== null &&
    "unref" in timeout &&
    typeof (timeout as Record<string, unknown>).unref === "function"
  );
}

/**
 * Creates an encrypted channel as the initiator (client).
 *
 * The client:
 * 1. Receives daemon's public key via QR code
 * 2. Generates own keypair
 * 3. Sends e2ee_hello with own public key
 * 4. Derives shared key and starts encrypted communication
 */
export async function createClientChannel(
  transport: Transport,
  daemonPublicKeyB64: string,
  events: EncryptedChannelEvents = {},
): Promise<EncryptedChannel> {
  const keyPair = generateKeyPair();
  const daemonPublicKey = importPublicKey(daemonPublicKeyB64);
  const sharedKey = deriveSharedKey(keyPair.secretKey, daemonPublicKey);

  const ourPublicKeyB64 = exportPublicKey(keyPair.publicKey);
  const channel = new EncryptedChannel(transport, sharedKey, events, {
    securityContext: { clientPublicKeyB64: ourPublicKeyB64 },
  });

  // Send e2ee_hello with our public key
  const hello: E2EEHelloMessage = { type: "e2ee_hello", key: ourPublicKeyB64 };
  const helloText = JSON.stringify(hello);

  let retry: ReturnType<typeof setInterval> | null = null;
  const emitSendError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    events.onerror?.(err);
  };
  const sendHello = () => {
    try {
      transport.send(helloText);
      return true;
    } catch (error) {
      // This can happen during daemon restarts while the socket transitions
      // through CLOSING/CLOSED states. Report it but do not throw from timers.
      emitSendError(error);
      return false;
    }
  };
  const clearRetry = () => {
    if (retry) {
      clearInterval(retry);
      retry = null;
    }
  };

  channel.onTransitionToOpen(() => clearRetry());
  channel.onClose(() => clearRetry());

  sendHello();
  try {
    retry = setInterval(() => {
      if (channel.isOpen()) {
        clearRetry();
        return;
      }
      sendHello();
    }, HANDSHAKE_RETRY_MS);
    // Avoid keeping Node processes alive (e.g. tests) if the handshake is stuck.
    if (hasUnref(retry)) {
      retry.unref();
    }
    return channel;
  } catch (error) {
    clearRetry();
    throw error;
  }
}

/**
 * Creates an encrypted channel as the responder (daemon).
 *
 * The daemon:
 * 1. Has pre-generated keypair (public key was in QR)
 * 2. Waits for client's e2ee_hello with their public key
 * 3. Derives shared key and starts encrypted communication
 */
export async function createDaemonChannel(
  transport: Transport,
  daemonKeyPair: KeyPair,
  events: EncryptedChannelEvents = {},
): Promise<EncryptedChannel> {
  return new Promise((resolve, reject) => {
    const bufferedMessages: Array<string | ArrayBuffer> = [];
    const shouldIgnorePostHelloPlaintext = (data: string | ArrayBuffer): boolean => {
      try {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        const parsed: unknown = JSON.parse(text);
        return isE2EEHelloMessage(parsed) || isE2EEReadyMessage(parsed);
      } catch {
        return false;
      }
    };

    const handleHello = async (data: string | ArrayBuffer): Promise<void> => {
      try {
        const helloText = typeof data === "string" ? data : new TextDecoder().decode(data);

        let parsed: unknown;
        try {
          parsed = JSON.parse(helloText);
        } catch {
          throw buildInvalidHelloError(helloText);
        }

        if (!isE2EEHelloMessage(parsed)) {
          throw buildInvalidHelloError(helloText, parsed);
        }

        const msg = parsed;

        // Buffer any subsequent messages that arrive while we're doing async
        // WebCrypto work to derive the shared key. Without this, it's possible
        // for the next message (already encrypted) to be misinterpreted as a
        // second hello, causing the handshake to fail.
        const bufferNext = (next: string | ArrayBuffer): void => {
          bufferedMessages.push(next);
        };
        Object.assign(transport, { onmessage: bufferNext });

        const clientPublicKey = importPublicKey(msg.key);
        const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPublicKey);

        const authChallenge = createAuthChallenge();
        const channel = new EncryptedChannel(transport, sharedKey, events, {
          daemonKeyPair,
          securityContext: {
            clientPublicKeyB64: msg.key,
            authChallenge,
          },
        });
        transport.send(
          JSON.stringify({ type: "e2ee_ready", authChallenge } satisfies E2EEReadyMessage),
        );

        channel.setState("open");
        events.onopen?.();

        for (const buffered of bufferedMessages) {
          if (shouldIgnorePostHelloPlaintext(buffered)) continue;
          transport.onmessage?.(buffered);
        }

        resolve(channel);
      } catch (error) {
        reject(error);
      }
    };

    Object.assign(transport, {
      onmessage: handleHello,
      onerror: (error: Error) => {
        reject(error);
      },
      onclose: (code: number, reason: string) => {
        reject(new Error(`Connection closed during handshake: ${code} ${reason}`));
      },
    });
  });
}

/**
 * Encrypted channel that wraps a transport with E2EE.
 */
export class EncryptedChannel {
  private transport: Transport;
  private sharedKey: SharedKey;
  private state: ChannelState = "handshaking";
  private events: EncryptedChannelEvents;
  private options: EncryptedChannelOptions;
  private securityContext: EncryptedChannelSecurityContext | null;
  private pendingSends: Array<string | ArrayBuffer> = [];
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];
  private onWebRtcFallbackCallbacks: Array<(reason: string) => void> = [];
  // Replay protection state, maintained per channel direction.
  // Each side has its own send counter + send salt (random, generated when
  // the channel transitions to open) and tracks the peer's receive counter +
  // receive salt (locked to the first encrypted frame observed).
  private sendSeq = 0n;
  private recvSeq: bigint | null = null;
  private sendSalt: Uint8Array | null = null;
  private recvSalt: Uint8Array | null = null;
  // WebRTC DataChannel hot-cutover state
  private activeSendLeg: "primary" | "webrtc" = "primary";
  private dcTransport: BinaryDataChannelTransport | null = null;
  private rtcChunker: RelayRtcChunker | null = null;
  private rtcReassembler: RelayRtcChunkReassembler | null = null;
  private reorderBuffer: RelayReorderBuffer | null = null;
  private peerPreviousLegEndSeq: bigint | null = null;
  private primaryLegDrained = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    transport: Transport,
    sharedKey: SharedKey,
    events: EncryptedChannelEvents = {},
    options: EncryptedChannelOptions = {},
  ) {
    this.transport = transport;
    this.sharedKey = sharedKey;
    this.events = events;
    this.options = options;
    this.securityContext = options.securityContext ? { ...options.securityContext } : null;

    Object.assign(transport, {
      onmessage: (data: string | ArrayBuffer) => this.handleMessage(data),
      onclose: (code: number, reason: string) => {
        if (this.activeSendLeg === "webrtc") {
          // Once upgraded to WebRTC, closing the drained Relay WS must not
          // trigger an upper-layer disconnect.
          this.primaryLegDrained = true;
          this.clearDrainTimer();
          return;
        }
        this.emitChannelClosed(code, reason);
      },
      onerror: (error: Error) => {
        if (this.activeSendLeg === "webrtc" || this.primaryLegDrained) {
          return;
        }
        this.events.onerror?.(error);
      },
    });
  }

  private emitChannelClosed(code: number, reason: string): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.clearDrainTimer();
    this.reorderBuffer?.dispose();
    this.reorderBuffer = null;
    this.rtcReassembler?.clear();
    this.events.onclose?.(code, reason);
    for (const cb of this.onCloseCallbacks) cb();
  }

  private clearDrainTimer(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private failChannelFatally(err: Error): void {
    const closeCode = err.message.includes("replay") ? REPLAY_PROTECTION_CLOSE_CODE : 1011;
    const closeReason = err.message.includes("replay")
      ? REPLAY_PROTECTION_CLOSE_REASON
      : err.message;
    this.clearDrainTimer();
    this.reorderBuffer?.dispose();
    this.reorderBuffer = null;
    this.rtcReassembler?.clear();
    if (this.dcTransport) {
      try {
        this.dcTransport.close(closeCode, closeReason);
      } catch {
        // ignore
      }
    }
    if (!this.primaryLegDrained) {
      try {
        this.transport.close(closeCode, closeReason);
      } catch {
        // ignore
      }
    }
    this.emitChannelClosed(closeCode, closeReason);
  }

  setState(state: ChannelState): void {
    this.state = state;
    if (state === "open") {
      // Initialise the send direction when entering open. The receive
      // direction is locked to the peer's first encrypted frame.
      ensurePrng();
      this.sendSalt = nacl.randomBytes(SALT_LENGTH);
      this.sendSeq = 0n;
    }
  }

  private async handleMessage(data: string | ArrayBuffer): Promise<void> {
    if (this.state === "handshaking") {
      try {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        const parsed: unknown = JSON.parse(text);
        if (isE2EEReadyMessage(parsed)) {
          if (this.securityContext && parsed.authChallenge) {
            this.securityContext.authChallenge = parsed.authChallenge;
          }
          // Use setState so the send direction (salt + seq) is initialised.
          this.setState("open");
          this.events.onopen?.();
          for (const cb of this.onOpenCallbacks) cb();
          await this.flushPendingSends();
        }
      } catch {
        // ignore non-ready handshake traffic
      }
      return;
    }

    if (this.state !== "open") return;

    try {
      const ciphertext = await (async () => {
        // Handle (or ignore) any stray plaintext handshake traffic.
        try {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data);
          if (text.trim().startsWith("{")) {
            const parsed: unknown = JSON.parse(text);

            if (isE2EEHelloMessage(parsed)) {
              if (this.options.daemonKeyPair) {
                await this.handleDaemonRehello(parsed.key);
              }
              return null;
            }

            if (isE2EEReadyMessage(parsed)) {
              return null;
            }

            // Any other JSON-looking payload is plaintext app traffic, which
            // means the peer is not encrypting (or we are out of sync).
            throw new Error("Received plaintext frame on encrypted channel");
          }
        } catch (error) {
          // If we detected plaintext protocol mismatch, fail hard.
          if (error instanceof Error && error.message.includes("plaintext frame")) {
            throw error;
          }
          // Otherwise ignore JSON parse/TextDecoder failures and fall back to
          // decoding ciphertext below.
        }

        if (typeof data === "string") {
          return base64ToArrayBuffer(data);
        }

        // Some WebSocket implementations deliver text frames as ArrayBuffer.
        // Our protocol always transmits ciphertext as base64 text.
        try {
          const decoded = new TextDecoder().decode(data);
          return base64ToArrayBuffer(decoded);
        } catch {
          return data;
        }
      })();

      if (ciphertext) {
        this.processEncryptedBundle(new Uint8Array(ciphertext));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Treat decryption/protocol errors as fatal so the peer can reconnect and
      // re-handshake. Emitting an error event here can cause higher-level code
      // to tear down the session without triggering a clean reconnect.
      this.failChannelFatally(err);
    }
  }

  private processEncryptedBundle(bundle: Uint8Array): void {
    if (this.state !== "open") return;
    if (this.reorderBuffer) {
      const seq = extractSeqFromBundle(bundle);
      const ready = this.reorderBuffer.push(seq, bundle);
      for (const item of ready) {
        if (this.state !== "open") return;
        this.decryptAndDispatch(item.bundle);
      }
      return;
    }
    this.decryptAndDispatch(bundle);
  }

  private decryptAndDispatch(bundle: Uint8Array): void {
    const { plaintext, seq, salt } = decryptFromBytes(this.sharedKey, bundle);
    this.enforceReplayProtection(seq, salt);
    this.maybeCompletePrimaryLegDrain();
    this.events.onmessage?.(plaintext);
  }

  private handleWebRtcMessage(raw: ArrayBuffer | Uint8Array): void {
    if (this.state !== "open") return;
    try {
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const reassembler = this.rtcReassembler ?? (this.rtcReassembler = new RelayRtcChunkReassembler());
      const assembled = reassembler.push(bytes);
      if (!assembled) return;
      const { bundle } = decodeDshuFrame(assembled);
      this.processEncryptedBundle(bundle);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.failChannelFatally(err);
    }
  }

  private maybeCompletePrimaryLegDrain(): void {
    if (
      this.primaryLegDrained ||
      this.activeSendLeg !== "webrtc" ||
      this.peerPreviousLegEndSeq === null ||
      this.recvSeq === null
    ) {
      return;
    }
    if (this.recvSeq >= this.peerPreviousLegEndSeq) {
      this.completePrimaryLegDrain();
    }
  }

  private completePrimaryLegDrain(): void {
    if (this.primaryLegDrained) return;
    this.primaryLegDrained = true;
    this.clearDrainTimer();
    Object.assign(this.transport, {
      onmessage: null,
      onclose: null,
      onerror: null,
    });
    try {
      this.transport.close(RTC_UPGRADED_CLOSE_CODE, RTC_UPGRADED_CLOSE_REASON);
    } catch {
      // ignore
    }
  }

  /**
   * Returns the exact sequence counter that will be assigned to the next
   * outbound encrypted frame.
   */
  peekNextSendSeq(): bigint {
    return this.sendSeq;
  }

  /** Returns the highest sequence counter successfully decrypted so far. */
  getLastRecvSeq(): bigint | null {
    return this.recvSeq;
  }

  /** Returns true once outbound frames have been cut over to the WebRTC leg. */
  isWebRtcActive(): boolean {
    return this.activeSendLeg === "webrtc";
  }

  /** Returns true once the primary Relay WS leg has finished draining and closed. */
  isPrimaryLegDrained(): boolean {
    return this.primaryLegDrained;
  }

  /**
   * Reverts an activated WebRTC leg back to the still-open primary Relay WS leg
   * before primary-leg drain completes. Returns true if fallback succeeded.
   */
  fallbackToPrimaryLeg(reason = "webrtc_fallback"): boolean {
    if (this.state !== "open" || this.primaryLegDrained || this.activeSendLeg !== "webrtc") {
      return false;
    }
    this.activeSendLeg = "primary";
    this.peerPreviousLegEndSeq = null;
    this.clearDrainTimer();
    this.detachWebRtcReceiveLeg();
    for (const cb of [...this.onWebRtcFallbackCallbacks]) {
      try {
        cb(reason);
      } catch {
        // ignore observer errors
      }
    }
    return true;
  }

  onWebRtcFallback(cb: (reason: string) => void): () => void {
    this.onWebRtcFallbackCallbacks.push(cb);
    return () => {
      const idx = this.onWebRtcFallbackCallbacks.indexOf(cb);
      if (idx >= 0) this.onWebRtcFallbackCallbacks.splice(idx, 1);
    };
  }

  /**
   * Attaches a WebRTC DataChannel leg for early receive buffering before
   * outbound cutover. Closing this pre-activation leg does NOT disconnect the
   * channel.
   */
  attachWebRtcReceiveLeg(dcTransport: BinaryDataChannelTransport): void {
    if (this.state !== "open") {
      throw new Error("Channel not open");
    }
    if (this.dcTransport === dcTransport) {
      return;
    }
    this.dcTransport = dcTransport;
    if (!this.rtcChunker) {
      this.rtcChunker = new RelayRtcChunker();
    }
    if (!this.rtcReassembler) {
      this.rtcReassembler = new RelayRtcChunkReassembler();
    }
    if (!this.reorderBuffer) {
      const initialExpected = this.recvSeq !== null ? this.recvSeq + 1n : null;
      this.reorderBuffer = new RelayReorderBuffer(initialExpected, (err) => {
        this.failChannelFatally(err);
      });
    }
    dcTransport.onmessage = (data) => {
      if (this.dcTransport !== dcTransport) return;
      this.handleWebRtcMessage(data);
    };
    dcTransport.onclose = (code, reason) => {
      if (this.dcTransport !== dcTransport) return;
      if (this.activeSendLeg === "webrtc") {
        if (!this.primaryLegDrained) {
          this.fallbackToPrimaryLeg("dc_closed_before_drain");
          return;
        }
        this.emitChannelClosed(code, reason);
      } else {
        this.dcTransport = null;
      }
    };
    dcTransport.onerror = (error) => {
      if (this.dcTransport !== dcTransport) return;
      if (this.activeSendLeg === "webrtc" && this.primaryLegDrained) {
        this.events.onerror?.(error);
      }
    };
  }

  /** Detaches a pre-activation WebRTC receive leg without disturbing the primary leg. */
  detachWebRtcReceiveLeg(dcTransport?: BinaryDataChannelTransport): void {
    if (this.activeSendLeg === "webrtc") return;
    if (dcTransport && this.dcTransport !== dcTransport) return;
    if (this.dcTransport) {
      this.dcTransport.onmessage = null;
      this.dcTransport.onclose = null;
      this.dcTransport.onerror = null;
      this.dcTransport = null;
    }
    this.rtcReassembler?.clear();
  }

  /**
   * Atomically sends the optional final control frame on the primary Relay WS
   * leg, switches all subsequent outbound sends to the WebRTC DataChannel leg
   * (`DSHU` + `RTCH`), and begins draining the primary leg when
   * `peerPreviousLegEndSeq` is provided.
   */
  activateWebRtcLeg(params: ActivateWebRtcLegParams): { finalPrimaryLegSeq: bigint | null } {
    if (this.state !== "open") {
      throw new Error("Channel not open");
    }
    if (!this.sendSalt) {
      throw new Error("Channel open without send salt initialised");
    }

    let finalPrimaryLegSeq: bigint | null = null;
    if (params.buildFinalPrimaryLegMessage) {
      const seq = this.sendSeq;
      const finalPayload = params.buildFinalPrimaryLegMessage(seq);
      this.sendSeq += 1n;
      const bundle = encryptToBytes(this.sharedKey, finalPayload, seq, this.sendSalt);
      const copy = new Uint8Array(bundle.byteLength);
      copy.set(bundle);
      this.transport.send(arrayBufferToBase64(copy.buffer));
      finalPrimaryLegSeq = seq;
    }

    this.attachWebRtcReceiveLeg(params.dcTransport);
    this.activeSendLeg = "webrtc";

    if (params.peerPreviousLegEndSeq !== undefined && params.peerPreviousLegEndSeq !== null) {
      this.beginPrimaryLegDrain(params.peerPreviousLegEndSeq, params.drainTimeoutMs);
    }

    return { finalPrimaryLegSeq };
  }

  /**
   * Starts (or completes) draining the primary Relay WS leg up to
   * `peerPreviousLegEndSeq`, with a fallback timeout (default 3000ms) after
   * which the old Relay WS is closed cleanly without disconnecting the channel.
   */
  beginPrimaryLegDrain(
    peerPreviousLegEndSeq: bigint | number,
    drainTimeoutMs = RTC_DRAIN_TIMEOUT_MS,
  ): void {
    this.peerPreviousLegEndSeq = BigInt(peerPreviousLegEndSeq);
    if (this.primaryLegDrained) return;
    this.maybeCompletePrimaryLegDrain();
    if (this.primaryLegDrained) return;
    this.clearDrainTimer();
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.completePrimaryLegDrain();
    }, drainTimeoutMs);
    if (hasUnref(this.drainTimer)) {
      this.drainTimer.unref();
    }
  }

  /**
   * Rejects replayed or out-of-order frames. The first received frame locks
   * the per-direction salt and seeds the recv counter; every subsequent frame
   * must carry the same salt and a strictly greater seq. A violation closes
   * the channel fatally so the peer must re-handshake.
   */
  private enforceReplayProtection(seq: bigint, salt: Uint8Array): void {
    if (this.recvSalt === null || this.recvSeq === null) {
      this.recvSalt = salt;
      this.recvSeq = seq;
      return;
    }
    if (salt.byteLength !== this.recvSalt.byteLength) {
      throw new Error("E2EE replay protection violation: salt length changed");
    }
    let saltMismatch = 0;
    for (let i = 0; i < this.recvSalt.byteLength; i += 1) {
      saltMismatch |= salt[i] ^ this.recvSalt[i];
    }
    if (saltMismatch !== 0) {
      throw new Error("E2EE replay protection violation: salt changed");
    }
    if (seq <= this.recvSeq) {
      throw new Error("E2EE replay protection violation: seq not strictly increasing");
    }
    this.recvSeq = seq;
  }

  async send(data: string | ArrayBuffer): Promise<void> {
    if (this.state === "handshaking") {
      if (this.pendingSends.length >= MAX_PENDING_SENDS) {
        this.pendingSends.shift();
      }
      this.pendingSends.push(data);
      return;
    }

    if (this.state !== "open") {
      throw new Error("Channel not open");
    }

    if (!this.sendSalt) {
      throw new Error("Channel open without send salt initialised");
    }

    const seq = this.sendSeq;
    this.sendSeq += 1n;
    const bundle = encryptToBytes(this.sharedKey, data, seq, this.sendSalt);
    if (this.activeSendLeg === "webrtc" && this.dcTransport) {
      const dshu = encodeDshuFrame(seq, bundle);
      const chunker = this.rtcChunker ?? (this.rtcChunker = new RelayRtcChunker());
      const chunks = chunker.chunk(dshu);
      for (const chunk of chunks) {
        this.dcTransport.send(chunk);
      }
      return;
    }
    // Send as base64 for WebSocket text compatibility
    const copy = new Uint8Array(bundle.byteLength);
    copy.set(bundle);
    this.transport.send(arrayBufferToBase64(copy.buffer));
  }

  private async flushPendingSends(): Promise<void> {
    if (this.state !== "open") return;
    const pending = this.pendingSends;
    this.pendingSends = [];
    for (const item of pending) {
      await this.send(item);
    }
  }

  private async handleDaemonRehello(clientKeyB64: string): Promise<void> {
    if (!this.options.daemonKeyPair) return;
    const clientPublicKey = importPublicKey(clientKeyB64);
    const nextSharedKey = deriveSharedKey(this.options.daemonKeyPair.secretKey, clientPublicKey);

    // If it's the same client key (handshake retry), re-send
    // "ready" but do not re-key. Re-keying here would desync
    // the channel and cause decrypt failures.
    if (keysEqual(nextSharedKey, this.sharedKey)) {
      this.transport.send(
        JSON.stringify({
          type: "e2ee_ready",
          ...(this.securityContext?.authChallenge
            ? { authChallenge: this.securityContext.authChallenge }
            : {}),
        } satisfies E2EEReadyMessage),
      );
      return;
    }

    // A different key on an already-open encrypted channel is not an
    // authenticated reconnect. Close and require a fresh transport instead of
    // allowing the relay to switch this channel to an attacker-chosen key.
    this.state = "closed";
    this.transport.close(
      REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE,
      REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON,
    );
  }

  close(code = 1000, reason = "Normal closure"): void {
    this.state = "closed";
    this.clearDrainTimer();
    this.reorderBuffer?.dispose();
    this.reorderBuffer = null;
    this.rtcReassembler?.clear();
    if (this.dcTransport) {
      const dc = this.dcTransport;
      this.dcTransport = null;
      dc.onmessage = null;
      dc.onclose = null;
      dc.onerror = null;
      try {
        dc.close(code, reason);
      } catch {
        // ignore
      }
    }
    if (!this.primaryLegDrained) {
      try {
        this.transport.close(code, reason);
      } catch {
        // ignore
      }
    }
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  /**
   * Returns the E2EE handshake values that relay device auth must bind to.
   * @returns A defensive copy of the channel security context, or null before setup
   */
  getSecurityContext(): EncryptedChannelSecurityContext | null {
    return this.securityContext ? { ...this.securityContext } : null;
  }

  onTransitionToOpen(cb: () => void): void {
    this.onOpenCallbacks.push(cb);
  }

  onClose(cb: () => void): void {
    this.onCloseCallbacks.push(cb);
  }
}

function keysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}
