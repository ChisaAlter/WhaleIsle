import {
  SALT_LENGTH,
  decrypt,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
  type SharedKey,
} from "@chisacode/relay/e2ee";
import type {
  DaemonTransport,
  DaemonTransportFactory,
  IceServerConfig,
  RelaySecurityContext,
  RtcDataChannelLike,
  RtcIceCandidateInitLike,
  RtcPeerConnectionFactory,
  RtcPeerConnectionLike,
  TransportLogger,
  TransportMode,
} from "./daemon-client-transport-types.js";
import {
  copyArrayBufferViewToBuffer,
  extractRelayMessageData,
  normalizeTransportPayload,
} from "./daemon-client-transport-utils.js";
import {
  DEFAULT_STUN_ICE_SERVERS,
  RTC_CHUNK_MAX_MESSAGE_BYTES,
  RtcChunkReassembler,
  SequencedCiphertextReorderBuffer,
  SerialSend,
  chunkRtcPayload,
  createRtcMessageIdGenerator,
  orderIceServers,
  readBundleSeqLE,
  unwrapDshuFrame,
  wrapDshuFrame,
} from "./rtc-chunking.js";

export const LAN_CONNECT_TIMEOUT_MS = 2_500;
export const HANDSHAKE_RETRY_MS = 1_000;
export const RTC_NEGOTIATE_TIMEOUT_MS = 8_000;
export const RTC_NEGOTIATE_HOST_ONLY_TIMEOUT_MS = 4_000;
export const RTC_ACTIVATE_TIMEOUT_MS = 6_000;
export const RTC_ATTEMPT_TTL_MS = 20_000;
export const RTC_DRAIN_TIMEOUT_MS = 3_000;
export const RTC_MAX_SDP_BYTES = 128 * 1024;
export const RTC_DATA_CHANNEL_LABEL = "dsh";

const MAX_PENDING_SENDS = 200;
const REPLAY_PROTECTION_CLOSE_CODE = 1011;
const REPLAY_PROTECTION_CLOSE_REASON = "E2EE replay protection violation";

type OpenHandler = () => void;
type CloseHandler = (event?: unknown) => void;
type ErrorHandler = (event?: unknown) => void;
type MessageHandler = (data: unknown) => void;
type ModeChangeHandler = (mode: TransportMode) => void;

type ChannelState = "connecting" | "handshaking" | "open" | "closed";
type UpgradeState = "idle" | "negotiating" | "activating" | "active" | "aborted";

export interface AdaptiveTransportOptions {
  baseFactory: DaemonTransportFactory;
  daemonPublicKeyB64: string;
  logger: TransportLogger;
  serverId?: string;
  lanEndpoints?: string[];
  lanUseTls?: boolean;
  iceServers?: IceServerConfig[];
  rtcPeerConnectionFactory?: RtcPeerConnectionFactory;
  webrtcUpgrade?: boolean;
  onTransportModeChange?: (mode: TransportMode) => void;
  /** Timing overrides (intended for tests). */
  lanConnectTimeoutMs?: number;
  negotiateTimeoutMs?: number;
  hostOnlyNegotiateTimeoutMs?: number;
  activateTimeoutMs?: number;
  attemptTtlMs?: number;
  drainTimeoutMs?: number;
  reorderGapTimeoutMs?: number;
}

export function createAdaptiveTransportFactory(
  options: AdaptiveTransportOptions,
): DaemonTransportFactory {
  return ({ url, headers, protocols }) =>
    createAdaptiveTransport({
      ...options,
      relayUrl: url,
      headers,
      protocols,
    });
}

export interface CreateAdaptiveTransportInput extends AdaptiveTransportOptions {
  relayUrl: string;
  headers?: Record<string, string>;
  protocols?: string[];
}

export function buildLanWebSocketUrl(
  endpoint: string,
  serverId: string,
  useTls = false,
): string {
  const trimmed = endpoint.trim();
  if (/^wss?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    if (serverId && !parsed.searchParams.has("serverId")) {
      parsed.searchParams.set("serverId", serverId);
    }
    if (!parsed.searchParams.has("role")) {
      parsed.searchParams.set("role", "client");
    }
    if (!parsed.searchParams.has("v")) {
      parsed.searchParams.set("v", "2");
    }
    return parsed.toString();
  }
  const protocol = useTls ? "wss" : "ws";
  const url = new URL(`${protocol}://${trimmed}/ws`);
  if (serverId) {
    url.searchParams.set("serverId", serverId);
  }
  url.searchParams.set("role", "client");
  url.searchParams.set("v", "2");
  return url.toString();
}

export function defaultRtcPeerConnectionFactory(): RtcPeerConnectionFactory | null {
  const ctor = (
    globalThis as {
      RTCPeerConnection?: new (config?: { iceServers?: IceServerConfig[] }) => RtcPeerConnectionLike;
    }
  ).RTCPeerConnection;
  if (typeof ctor !== "function") {
    return null;
  }
  return (config) => {
    const pc = new ctor({ iceServers: config.iceServers });
    const rawAddIceCandidate = pc.addIceCandidate.bind(pc);
    return {
      get iceConnectionState() {
        return pc.iceConnectionState;
      },
      get connectionState() {
        return pc.connectionState;
      },
      get signalingState() {
        return pc.signalingState;
      },
      createDataChannel: (label, opts) => pc.createDataChannel(label, opts),
      createOffer: () => pc.createOffer(),
      setLocalDescription: (desc) => pc.setLocalDescription(desc),
      setRemoteDescription: (desc) => pc.setRemoteDescription(desc),
      addIceCandidate: async (candidate) => {
        if (candidate === null) {
          try {
            await rawAddIceCandidate(null);
          } catch {
            // Some browser implementations ignore or reject null end-of-candidates.
          }
          return;
        }
        await rawAddIceCandidate(candidate);
      },
      close: () => pc.close(),
      get onicecandidate() {
        return pc.onicecandidate;
      },
      set onicecandidate(handler) {
        pc.onicecandidate = handler;
      },
      get oniceconnectionstatechange() {
        return pc.oniceconnectionstatechange ?? null;
      },
      set oniceconnectionstatechange(handler) {
        pc.oniceconnectionstatechange = handler;
      },
      get onconnectionstatechange() {
        return pc.onconnectionstatechange ?? null;
      },
      set onconnectionstatechange(handler) {
        pc.onconnectionstatechange = handler;
      },
    };
  };
}

export function createAdaptiveTransport(input: CreateAdaptiveTransportInput): DaemonTransport {
  const {
    baseFactory,
    daemonPublicKeyB64,
    logger,
    relayUrl,
    headers,
    protocols,
    lanUseTls = false,
    webrtcUpgrade = true,
  } = input;

  const lanEndpoints = (input.lanEndpoints ?? [])
    .map((ep) => (typeof ep === "string" ? ep.trim() : ""))
    .filter((ep) => ep.length > 0);
  const serverId = resolveServerId(input.serverId, relayUrl);
  const lanConnectTimeoutMs = input.lanConnectTimeoutMs ?? LAN_CONNECT_TIMEOUT_MS;
  const activateTimeoutMs = input.activateTimeoutMs ?? RTC_ACTIVATE_TIMEOUT_MS;
  const attemptTtlMs = input.attemptTtlMs ?? RTC_ATTEMPT_TTL_MS;
  const drainTimeoutMs = input.drainTimeoutMs ?? RTC_DRAIN_TIMEOUT_MS;

  const openHandlers = new Set<OpenHandler>();
  const closeHandlers = new Set<CloseHandler>();
  const errorHandlers = new Set<ErrorHandler>();
  const messageHandlers = new Set<MessageHandler>();
  const modeHandlers = new Set<ModeChangeHandler>();
  if (input.onTransportModeChange) {
    modeHandlers.add(input.onTransportModeChange);
  }

  let channelState: ChannelState = "connecting";
  let opened = false;
  let closed = false;
  let transportMode: TransportMode | null = null;

  // Underlying WebSocket leg (either LAN direct WS or Relay WS)
  let wsTransport: DaemonTransport | null = null;
  let wsCleanup: Array<() => void> = [];
  let relayDrained = false;

  // LAN race state
  let lanRaceTimer: ReturnType<typeof setTimeout> | null = null;
  const lanPendingCleanups = new Set<() => void>();

  // E2EE state (byte-exact with @chisacode/relay EncryptedChannel)
  let sharedKey: SharedKey | null = null;
  let securityContext: RelaySecurityContext | null = null;
  let handshakeRetry: ReturnType<typeof setInterval> | null = null;
  let sendSalt: Uint8Array | null = null;
  let sendSeq = 0n;
  let recvSalt: Uint8Array | null = null;
  let recvSeq: bigint | null = null;
  let pendingSends: Array<string | ArrayBuffer> = [];

  // Serialized outbound queue & active send leg
  const serialSend = new SerialSend();
  let activeSendLeg: "ws" | "webrtc" = "ws";
  const nextRtcMessageId = createRtcMessageIdGenerator(1);

  // Inbound reassembly & reorder buffer
  const rtchReassembler = new RtcChunkReassembler();
  const reorderBuffer = new SequencedCiphertextReorderBuffer({
    ...(input.reorderGapTimeoutMs !== undefined
      ? { gapTimeoutMs: input.reorderGapTimeoutMs }
      : {}),
    onGapTimeout: (err) => {
      logger.warn({ err: normalizeError(err) }, "adaptive_reorder_gap_timeout");
      fatalProtocolClose(REPLAY_PROTECTION_CLOSE_CODE, err.message);
    },
  });

  // In-band WebRTC upgrade state
  let upgradeState: UpgradeState = "idle";
  let currentAttemptId: string | null = null;
  let pc: RtcPeerConnectionLike | null = null;
  let dc: RtcDataChannelLike | null = null;
  let offerSent = false;
  let remoteDescriptionSet = false;
  let pendingLocalIce: Array<RtcIceCandidateInitLike | null> = [];
  let pendingRemoteIce: Array<RtcIceCandidateInitLike | null> = [];
  let negotiateTimer: ReturnType<typeof setTimeout> | null = null;
  let activateTimer: ReturnType<typeof setTimeout> | null = null;
  let attemptTtlTimer: ReturnType<typeof setTimeout> | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let hostPreviousLegEndSeq: bigint | null = null;

  const setTransportMode = (mode: TransportMode) => {
    if (transportMode === mode) return;
    transportMode = mode;
    emitHandlers(modeHandlers, mode);
  };

  const emitOpen = () => {
    if (opened || closed) return;
    opened = true;
    emitHandlers(openHandlers);
  };

  const emitClose = (event?: unknown) => {
    if (closed) return;
    closed = true;
    channelState = "closed";
    cleanupAllResources();
    emitHandlers(closeHandlers, event);
  };

  const emitError = (event?: unknown) => {
    if (closed) return;
    emitHandlers(errorHandlers, event);
  };

  const emitMessage = (data: unknown) => {
    if (closed) return;
    emitHandlers(messageHandlers, data);
  };

  const clearHandshakeRetry = () => {
    if (handshakeRetry) {
      clearInterval(handshakeRetry);
      handshakeRetry = null;
    }
  };

  const clearUpgradeTimers = () => {
    if (negotiateTimer) {
      clearTimeout(negotiateTimer);
      negotiateTimer = null;
    }
    if (activateTimer) {
      clearTimeout(activateTimer);
      activateTimer = null;
    }
    if (attemptTtlTimer) {
      clearTimeout(attemptTtlTimer);
      attemptTtlTimer = null;
    }
  };

  const clearDrainTimer = () => {
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
  };

  const closeRtcResources = () => {
    const channel = dc;
    dc = null;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // ignore
      }
    }
    const peer = pc;
    pc = null;
    if (peer) {
      peer.onicecandidate = null;
      if ("oniceconnectionstatechange" in peer) {
        peer.oniceconnectionstatechange = null;
      }
      if ("onconnectionstatechange" in peer) {
        peer.onconnectionstatechange = null;
      }
      try {
        peer.close();
      } catch {
        // ignore
      }
    }
    rtchReassembler.reset();
    pendingLocalIce = [];
    pendingRemoteIce = [];
    offerSent = false;
    remoteDescriptionSet = false;
  };

  const detachWsHandlers = () => {
    for (const unsub of wsCleanup) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    wsCleanup = [];
  };

  const cancelLanRace = () => {
    if (lanRaceTimer) {
      clearTimeout(lanRaceTimer);
      lanRaceTimer = null;
    }
    for (const cleanup of lanPendingCleanups) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
    lanPendingCleanups.clear();
  };

  const cleanupAllResources = () => {
    cancelLanRace();
    clearHandshakeRetry();
    clearUpgradeTimers();
    clearDrainTimer();
    reorderBuffer.dispose();
    closeRtcResources();
    detachWsHandlers();
    const ws = wsTransport;
    wsTransport = null;
    if (ws) {
      try {
        ws.close(1000, "Transport closed");
      } catch {
        // ignore
      }
    }
  };

  const fatalProtocolClose = (code: number, reason: string) => {
    if (closed) return;
    if (activeSendLeg === "webrtc" && dc) {
      closeRtcResources();
    }
    const ws = wsTransport;
    if (ws && !relayDrained) {
      try {
        ws.close(code, reason);
      } catch {
        // ignore
      }
    }
    emitClose({ code, reason });
  };

  const peekNextSendSeq = (): number => Number(sendSeq);

  const sendEncryptedImmediate = (
    payload: string | ArrayBuffer,
    forceLeg?: "ws" | "webrtc",
  ): void => {
    if (channelState !== "open" || !sharedKey || !sendSalt) {
      throw new Error("Encrypted channel not ready");
    }
    const seq = sendSeq;
    sendSeq += 1n;
    const bundleBuffer = encrypt(sharedKey, payload, seq, sendSalt);
    const leg = forceLeg ?? activeSendLeg;

    if (leg === "webrtc") {
      if (!dc || dc.readyState !== "open") {
        throw new Error("WebRTC DataChannel is not open");
      }
      const dshuFrame = wrapDshuFrame(seq, new Uint8Array(bundleBuffer));
      const chunks = chunkRtcPayload(dshuFrame, nextRtcMessageId);
      for (const chunk of chunks) {
        dc.send(toIndependentArrayBuffer(chunk));
      }
      return;
    }

    if (!wsTransport || relayDrained) {
      throw new Error("WebSocket transport is not available");
    }
    wsTransport.send(bytesToBase64(new Uint8Array(bundleBuffer)));
  };

  const enqueueEncryptedSend = (
    payload: string | ArrayBuffer,
    forceLeg?: "ws" | "webrtc",
  ): Promise<void> => {
    const byteLength =
      typeof payload === "string" ? payload.length * 2 : payload.byteLength;
    return serialSend.enqueue(byteLength, () => {
      sendEncryptedImmediate(payload, forceLeg);
    });
  };

  const sendSignalingControl = (msg: Record<string, unknown>): void => {
    if (closed || channelState !== "open" || relayDrained || !wsTransport) return;
    const text = JSON.stringify(msg);
    void enqueueEncryptedSend(text, "ws").catch((error) => {
      logger.warn({ err: normalizeError(error) }, "rtc_signaling_send_failed");
    });
  };

  const finishRelayDrain = () => {
    if (relayDrained) return;
    relayDrained = true;
    clearDrainTimer();
    const ws = wsTransport;
    wsTransport = null;
    detachWsHandlers();
    if (ws) {
      try {
        ws.close(1000, "upgraded_to_webrtc");
      } catch {
        // ignore
      }
    }
  };

  const checkRelayDrain = () => {
    if (relayDrained || upgradeState !== "active" || hostPreviousLegEndSeq === null) {
      return;
    }
    if (recvSeq !== null && recvSeq >= hostPreviousLegEndSeq) {
      finishRelayDrain();
    }
  };

  const abortUpgrade = (reason: string, opts: { sendAbort: boolean }) => {
    if (upgradeState === "active" || upgradeState === "aborted" || upgradeState === "idle") {
      return;
    }
    const attemptId = currentAttemptId;
    upgradeState = "aborted";
    currentAttemptId = null;
    clearUpgradeTimers();
    activeSendLeg = "ws";
    closeRtcResources();
    logger.warn({ reason, attemptId }, "rtc_upgrade_aborted_fallback_relay");
    if (opts.sendAbort && attemptId && wsTransport && !relayDrained && channelState === "open") {
      sendSignalingControl({ type: "rtc_upgrade_abort", attemptId, reason });
    }
    setTransportMode("relay");
  };

  const handleActiveDataChannelClosed = (reason: string) => {
    if (closed) return;
    if (upgradeState !== "active") {
      abortUpgrade(reason, { sendAbort: true });
      return;
    }
    emitClose({ code: 1006, reason });
  };

  const sendRtcActivateAndSwitchLeg = (attemptId: string): void => {
    void serialSend
      .enqueue(128, () => {
        if (
          closed ||
          upgradeState !== "negotiating" ||
          currentAttemptId !== attemptId ||
          !wsTransport ||
          relayDrained ||
          !dc ||
          dc.readyState !== "open"
        ) {
          return;
        }
        const clientPreviousLegEndSeq = peekNextSendSeq();
        const activateMsg = JSON.stringify({
          type: "rtc_upgrade_activate",
          attemptId,
          clientPreviousLegEndSeq,
        });
        sendEncryptedImmediate(activateMsg, "ws");
        activeSendLeg = "webrtc";
        upgradeState = "activating";
      })
      .catch((error) => {
        logger.warn({ err: normalizeError(error) }, "rtc_upgrade_activate_failed");
        abortUpgrade("activate_send_failed", { sendAbort: true });
      });
  };

  const startWebRtcUpgrade = () => {
    if (
      closed ||
      !webrtcUpgrade ||
      transportMode !== "relay" ||
      upgradeState !== "idle" ||
      channelState !== "open"
    ) {
      return;
    }

    const factory = input.rtcPeerConnectionFactory ?? defaultRtcPeerConnectionFactory();
    if (!factory) {
      return;
    }

    const orderedIceServers =
      input.iceServers !== undefined
        ? orderIceServers(input.iceServers)
        : orderIceServers([...DEFAULT_STUN_ICE_SERVERS]);
    const isHostOnly = orderedIceServers.length === 0;
    const negotiateTimeoutMs = isHostOnly
      ? (input.hostOnlyNegotiateTimeoutMs ?? RTC_NEGOTIATE_HOST_ONLY_TIMEOUT_MS)
      : (input.negotiateTimeoutMs ?? RTC_NEGOTIATE_TIMEOUT_MS);

    const attemptId = createAttemptId();
    upgradeState = "negotiating";
    currentAttemptId = attemptId;
    offerSent = false;
    remoteDescriptionSet = false;
    pendingLocalIce = [];
    pendingRemoteIce = [];

    try {
      const peer = factory({ iceServers: orderedIceServers });
      pc = peer;
      const channel = peer.createDataChannel(RTC_DATA_CHANNEL_LABEL, { ordered: true });
      channel.binaryType = "arraybuffer";
      dc = channel;

      negotiateTimer = setTimeout(() => {
        if (upgradeState === "negotiating" && currentAttemptId === attemptId) {
          abortUpgrade("negotiate_timeout", { sendAbort: true });
        }
      }, negotiateTimeoutMs);
      unrefTimer(negotiateTimer);

      attemptTtlTimer = setTimeout(() => {
        if (
          (upgradeState === "negotiating" || upgradeState === "activating") &&
          currentAttemptId === attemptId
        ) {
          abortUpgrade("attempt_ttl_expired", { sendAbort: true });
        }
      }, attemptTtlMs);
      unrefTimer(attemptTtlTimer);

      peer.onicecandidate = (event) => {
        if (closed || currentAttemptId !== attemptId || upgradeState === "aborted") return;
        const normalized = normalizeCandidate(event?.candidate ?? null);
        if (offerSent) {
          sendSignalingControl({
            type: "rtc_upgrade_ice",
            attemptId,
            candidate: normalized,
          });
        } else {
          pendingLocalIce.push(normalized);
        }
      };

      const checkPeerFailure = () => {
        if (closed || pc !== peer) return;
        const iceState = peer.iceConnectionState;
        const connState = peer.connectionState;
        if (
          iceState === "failed" ||
          iceState === "closed" ||
          connState === "failed" ||
          connState === "closed"
        ) {
          if (upgradeState === "active") {
            handleActiveDataChannelClosed("WebRTC peer connection failed");
          } else if (currentAttemptId === attemptId) {
            abortUpgrade("ice_connection_failed", { sendAbort: true });
          }
        }
      };
      peer.oniceconnectionstatechange = checkPeerFailure;
      peer.onconnectionstatechange = checkPeerFailure;

      channel.onopen = () => {
        if (closed || dc !== channel || currentAttemptId !== attemptId) return;
        if (negotiateTimer) {
          clearTimeout(negotiateTimer);
          negotiateTimer = null;
        }
        activateTimer = setTimeout(() => {
          if (
            (upgradeState === "negotiating" || upgradeState === "activating") &&
            currentAttemptId === attemptId
          ) {
            abortUpgrade("activate_timeout", { sendAbort: true });
          }
        }, activateTimeoutMs);
        unrefTimer(activateTimer);
        sendRtcActivateAndSwitchLeg(attemptId);
      };

      channel.onmessage = (event) => {
        if (closed || dc !== channel) return;
        handleDataChannelMessage(event?.data);
      };

      channel.onerror = () => {
        if (closed || dc !== channel) return;
        if (upgradeState === "active") {
          handleActiveDataChannelClosed("WebRTC DataChannel error");
        } else if (currentAttemptId === attemptId) {
          abortUpgrade("data_channel_error", { sendAbort: true });
        }
      };

      channel.onclose = () => {
        if (closed || dc !== channel) return;
        handleActiveDataChannelClosed("WebRTC DataChannel closed");
      };

      void (async () => {
        try {
          const offer = await peer.createOffer();
          if (closed || pc !== peer || currentAttemptId !== attemptId) return;
          if (
            typeof offer?.sdp !== "string" ||
            offer.sdp.length === 0 ||
            offer.sdp.length > RTC_MAX_SDP_BYTES
          ) {
            abortUpgrade("invalid_local_sdp", { sendAbort: false });
            return;
          }
          await peer.setLocalDescription(offer);
          if (closed || pc !== peer || currentAttemptId !== attemptId) return;
          sendSignalingControl({
            type: "rtc_upgrade_offer",
            attemptId,
            sdp: offer.sdp,
          });
          offerSent = true;
          const queued = pendingLocalIce;
          pendingLocalIce = [];
          for (const candidate of queued) {
            sendSignalingControl({
              type: "rtc_upgrade_ice",
              attemptId,
              candidate,
            });
          }
        } catch (error) {
          logger.warn({ err: normalizeError(error) }, "rtc_upgrade_offer_failed");
          if (currentAttemptId === attemptId) {
            abortUpgrade("offer_creation_failed", { sendAbort: false });
          }
        }
      })();
    } catch (error) {
      logger.warn({ err: normalizeError(error) }, "rtc_upgrade_init_failed");
      abortUpgrade("rtc_init_failed", { sendAbort: false });
    }
  };

  const processDataChannelBytes = (bytes: Uint8Array): void => {
    try {
      if (closed) return;
      if (bytes.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES + 12) {
        throw new Error(`DataChannel frame too large (${bytes.byteLength} bytes)`);
      }
      const assembled = rtchReassembler.push(bytes);
      if (!assembled) return;
      const { seq, bundle } = unwrapDshuFrame(assembled);
      handleEncryptedBundle(seq, bundle, "webrtc");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({ err: normalizeError(err) }, "rtc_datachannel_frame_error");
      if (upgradeState !== "active") {
        abortUpgrade("datachannel_protocol_error", { sendAbort: true });
      } else {
        fatalProtocolClose(REPLAY_PROTECTION_CLOSE_CODE, err.message);
      }
    }
  };

  const handleDataChannelMessage = (rawData: unknown): void => {
    const syncBytes = extractSyncBinaryBytes(rawData);
    if (syncBytes) {
      processDataChannelBytes(syncBytes);
      return;
    }
    if (
      typeof Blob !== "undefined" &&
      rawData instanceof Blob &&
      typeof rawData.arrayBuffer === "function"
    ) {
      void rawData
        .arrayBuffer()
        .then((buf) => {
          if (!closed) processDataChannelBytes(new Uint8Array(buf));
        })
        .catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.warn({ err: normalizeError(err) }, "rtc_datachannel_blob_error");
          if (upgradeState !== "active") {
            abortUpgrade("datachannel_blob_error", { sendAbort: true });
          } else {
            fatalProtocolClose(REPLAY_PROTECTION_CLOSE_CODE, err.message);
          }
        });
    }
  };

  const handleSignalingMessage = (parsed: Record<string, unknown>): boolean => {
    const type = parsed.type;
    if (type === "rtc_upgrade_answer") {
      const attemptId = typeof parsed.attemptId === "string" ? parsed.attemptId : "";
      const sdp = typeof parsed.sdp === "string" ? parsed.sdp : "";
      if (
        upgradeState !== "negotiating" ||
        attemptId !== currentAttemptId ||
        !pc ||
        sdp.length === 0 ||
        sdp.length > RTC_MAX_SDP_BYTES
      ) {
        return true;
      }
      const activePc = pc;
      void (async () => {
        try {
          await activePc.setRemoteDescription({ type: "answer", sdp });
          if (closed || pc !== activePc || currentAttemptId !== attemptId) return;
          remoteDescriptionSet = true;
          const queued = pendingRemoteIce;
          pendingRemoteIce = [];
          for (const candidate of queued) {
            try {
              await activePc.addIceCandidate(candidate);
            } catch (iceErr) {
              logger.warn({ err: normalizeError(iceErr) }, "rtc_pending_ice_add_failed");
            }
          }
        } catch (error) {
          logger.warn({ err: normalizeError(error) }, "rtc_set_remote_description_failed");
          if (currentAttemptId === attemptId) {
            abortUpgrade("set_remote_description_failed", { sendAbort: true });
          }
        }
      })();
      return true;
    }

    if (type === "rtc_upgrade_ice") {
      const attemptId = typeof parsed.attemptId === "string" ? parsed.attemptId : "";
      if (attemptId !== currentAttemptId || !pc || upgradeState === "aborted") {
        return true;
      }
      const candidate = normalizeCandidate(parsed.candidate);
      if (!remoteDescriptionSet) {
        pendingRemoteIce.push(candidate);
      } else {
        void pc.addIceCandidate(candidate).catch((iceErr) => {
          logger.warn({ err: normalizeError(iceErr) }, "rtc_remote_ice_add_failed");
        });
      }
      return true;
    }

    if (type === "rtc_upgrade_activated") {
      const attemptId = typeof parsed.attemptId === "string" ? parsed.attemptId : "";
      const mode = parsed.mode;
      const endSeq = parsed.hostPreviousLegEndSeq;
      if (attemptId !== currentAttemptId || upgradeState === "aborted") {
        return true;
      }
      if (
        (mode !== "lan" && mode !== "p2p" && mode !== "turn") ||
        typeof endSeq !== "number" ||
        !Number.isSafeInteger(endSeq) ||
        endSeq < 0
      ) {
        abortUpgrade("invalid_activated_message", { sendAbort: true });
        return true;
      }
      clearUpgradeTimers();
      upgradeState = "active";
      activeSendLeg = "webrtc";
      hostPreviousLegEndSeq = BigInt(endSeq);
      setTransportMode(mode);
      checkRelayDrain();
      if (!relayDrained) {
        drainTimer = setTimeout(() => {
          finishRelayDrain();
        }, drainTimeoutMs);
        unrefTimer(drainTimer);
      }
      return true;
    }

    if (type === "rtc_upgrade_abort") {
      const attemptId = typeof parsed.attemptId === "string" ? parsed.attemptId : "";
      if (!attemptId || attemptId === currentAttemptId) {
        const reason = typeof parsed.reason === "string" ? parsed.reason : "peer_aborted";
        abortUpgrade(reason, { sendAbort: false });
      }
      return true;
    }

    return false;
  };

  const enforceReplayProtection = (seq: bigint, salt: Uint8Array): void => {
    if (recvSalt === null || recvSeq === null) {
      recvSalt = salt;
      recvSeq = seq;
      return;
    }
    if (salt.byteLength !== recvSalt.byteLength) {
      throw new Error("E2EE replay protection violation: salt length changed");
    }
    let saltMismatch = 0;
    for (let i = 0; i < recvSalt.byteLength; i += 1) {
      saltMismatch |= salt[i] ^ recvSalt[i];
    }
    if (saltMismatch !== 0) {
      throw new Error("E2EE replay protection violation: salt changed");
    }
    if (seq <= recvSeq) {
      throw new Error("E2EE replay protection violation: seq not strictly increasing");
    }
    recvSeq = seq;
  };

  const dispatchPlaintext = (plaintext: string | ArrayBuffer): void => {
    if (typeof plaintext === "string") {
      let parsed: unknown = null;
      if (plaintext.trim().startsWith("{")) {
        try {
          parsed = JSON.parse(plaintext) as unknown;
        } catch {
          parsed = null;
        }
      }
      if (isRecord(parsed)) {
        if (handleSignalingMessage(parsed)) {
          return;
        }
        if (parsed.type === "relay_device_auth_result") {
          emitMessage(plaintext);
          if (parsed.ok === true) {
            startWebRtcUpgrade();
          }
          return;
        }
      }
    }
    emitMessage(plaintext);
  };

  const handleEncryptedBundle = (
    seq: bigint,
    bundle: Uint8Array,
    source: "ws" | "webrtc",
  ): void => {
    if (closed || channelState !== "open" || !sharedKey) return;
    // Seed reorder buffer on the very first encrypted frame if peer starts at seq > 0.
    if (recvSalt === null && recvSeq === null && source === "ws" && upgradeState === "idle") {
      reorderBuffer.setNextExpectedSeq(seq);
    }
    const readyBundles = reorderBuffer.push(seq, bundle);
    for (const readyBundle of readyBundles) {
      if (closed) return;
      const { plaintext, seq: decryptedSeq, salt } = decrypt(
        sharedKey,
        toIndependentArrayBuffer(readyBundle),
      );
      enforceReplayProtection(decryptedSeq, salt);
      dispatchPlaintext(plaintext);
      checkRelayDrain();
    }
  };

  const handleWsRawMessage = (rawEvent: unknown): void => {
    if (closed || relayDrained) return;
    const data = extractRelayMessageData(rawEvent);

    if (channelState === "handshaking") {
      try {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        const parsed = JSON.parse(text) as unknown;
        if (isE2EEReadyMessage(parsed)) {
          clearHandshakeRetry();
          if (securityContext && parsed.authChallenge) {
            securityContext.authChallenge = parsed.authChallenge;
          }
          sendSalt = randomBytes(SALT_LENGTH);
          sendSeq = 0n;
          channelState = "open";
          emitOpen();
          const queued = pendingSends;
          pendingSends = [];
          for (const item of queued) {
            void enqueueEncryptedSend(item).catch((error) => {
              logger.warn({ err: normalizeError(error) }, "relay_e2ee_flush_send_failed");
              emitError(error);
            });
          }
        }
      } catch {
        // ignore non-ready handshake traffic
      }
      return;
    }

    if (channelState !== "open") return;

    try {
      // Ignore stray handshake messages; reject plaintext application traffic.
      try {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (text.trim().startsWith("{")) {
          const parsed = JSON.parse(text) as unknown;
          if (isE2EEHelloMessage(parsed) || isE2EEReadyMessage(parsed)) {
            return;
          }
          throw new Error("Received plaintext frame on encrypted channel");
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("plaintext frame")) {
          throw error;
        }
      }

      let bundleBytes: Uint8Array;
      if (typeof data === "string") {
        bundleBytes = base64ToBytes(data);
      } else {
        try {
          const decodedText = new TextDecoder().decode(data);
          bundleBytes = base64ToBytes(decodedText);
        } catch {
          bundleBytes = new Uint8Array(data);
        }
      }

      const seq = readBundleSeqLE(bundleBytes);
      handleEncryptedBundle(seq, bundleBytes, "ws");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      fatalProtocolClose(
        err.message.includes("replay") ? REPLAY_PROTECTION_CLOSE_CODE : 1011,
        err.message.includes("replay") ? REPLAY_PROTECTION_CLOSE_REASON : err.message,
      );
    }
  };

  const startE2eeHandshakeOnWs = (ws: DaemonTransport, mode: "lan" | "relay"): void => {
    if (closed) {
      try {
        ws.close(1000, "Transport closed");
      } catch {
        // ignore
      }
      return;
    }

    wsTransport = ws;
    setTransportMode(mode);
    channelState = "handshaking";

    wsCleanup = [
      ws.onMessage((event) => handleWsRawMessage(event)),
      ws.onClose((event) => {
        if (wsTransport !== ws) return;
        if (relayDrained || upgradeState === "active") {
          relayDrained = true;
          clearDrainTimer();
          detachWsHandlers();
          wsTransport = null;
          return;
        }
        emitClose(event);
      }),
      ws.onError((event) => {
        if (wsTransport !== ws) return;
        if (relayDrained || upgradeState === "active") {
          return;
        }
        emitError(event);
      }),
    ];

    try {
      const keyPair = generateKeyPair();
      const daemonPublicKey = importPublicKey(daemonPublicKeyB64);
      sharedKey = deriveSharedKey(keyPair.secretKey, daemonPublicKey);
      const clientPublicKeyB64 = exportPublicKey(keyPair.publicKey);
      securityContext = { clientPublicKeyB64 };

      const helloText = JSON.stringify({ type: "e2ee_hello", key: clientPublicKeyB64 });
      const sendHello = () => {
        if (closed || channelState !== "handshaking" || wsTransport !== ws) {
          clearHandshakeRetry();
          return;
        }
        try {
          ws.send(helloText);
        } catch (error) {
          emitError(error instanceof Error ? error : new Error(String(error)));
        }
      };

      sendHello();
      handshakeRetry = setInterval(() => {
        if (closed || channelState !== "handshaking") {
          clearHandshakeRetry();
          return;
        }
        sendHello();
      }, HANDSHAKE_RETRY_MS);
      unrefTimer(handshakeRetry);
    } catch (error) {
      logger.warn({ err: normalizeError(error) }, "relay_e2ee_handshake_failed");
      emitError(error);
      try {
        ws.close(4001, "E2EE handshake failed");
      } catch {
        // ignore
      }
      emitClose({ code: 4001, reason: "E2EE handshake failed" });
    }
  };

  const connectRelay = (): void => {
    if (closed) return;
    if (!relayUrl) {
      const error = new Error("LAN direct connection failed and no relay URL configured");
      emitError(error);
      emitClose({ code: 1006, reason: error.message });
      return;
    }

    let ws: DaemonTransport;
    try {
      ws = baseFactory({
        url: relayUrl,
        headers,
        ...(protocols ? { protocols } : {}),
      });
    } catch (error) {
      emitError(error);
      emitClose({
        code: 1006,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let openHandled = false;
    const preOpenCleanups: Array<() => void> = [];
    const clearPreOpen = () => {
      for (const unsub of preOpenCleanups) {
        try {
          unsub();
        } catch {
          // ignore
        }
      }
      preOpenCleanups.length = 0;
    };

    preOpenCleanups.push(
      ws.onOpen(() => {
        if (openHandled || closed) return;
        openHandled = true;
        clearPreOpen();
        startE2eeHandshakeOnWs(ws, "relay");
      }),
      ws.onClose((event) => {
        if (openHandled || closed) return;
        openHandled = true;
        clearPreOpen();
        emitClose(event);
      }),
      ws.onError((event) => {
        if (openHandled || closed) return;
        emitError(event);
      }),
    );
  };

  const connectLanFirst = (): void => {
    let settled = false;
    let remaining = lanEndpoints.length;
    const candidateTransports: Array<{ ws: DaemonTransport; unsubs: Array<() => void> }> = [];

    const closeLosers = (winner?: DaemonTransport) => {
      for (const item of candidateTransports) {
        for (const unsub of item.unsubs) {
          try {
            unsub();
          } catch {
            // ignore
          }
        }
        item.unsubs.length = 0;
        if (item.ws !== winner) {
          try {
            item.ws.close(1000, "LAN race finished");
          } catch {
            // ignore
          }
        }
      }
      candidateTransports.length = 0;
    };

    const failLanRace = () => {
      if (settled || closed) return;
      settled = true;
      cancelLanRace();
      closeLosers();
      connectRelay();
    };

    lanPendingCleanups.add(() => {
      settled = true;
      closeLosers();
    });

    lanRaceTimer = setTimeout(() => {
      failLanRace();
    }, lanConnectTimeoutMs);
    unrefTimer(lanRaceTimer);

    for (const endpoint of lanEndpoints) {
      if (settled || closed) break;
      let lanUrl: string;
      try {
        lanUrl = buildLanWebSocketUrl(endpoint, serverId, lanUseTls);
      } catch {
        remaining -= 1;
        if (remaining <= 0) {
          failLanRace();
        }
        continue;
      }

      let ws: DaemonTransport;
      try {
        ws = baseFactory({
          url: lanUrl,
          headers,
          ...(protocols ? { protocols } : {}),
        });
      } catch {
        remaining -= 1;
        if (remaining <= 0) {
          failLanRace();
        }
        continue;
      }

      let candidateFailed = false;
      const unsubs: Array<() => void> = [];
      candidateTransports.push({ ws, unsubs });

      const markCandidateFailed = () => {
        if (candidateFailed || settled || closed) return;
        candidateFailed = true;
        for (const unsub of unsubs) {
          try {
            unsub();
          } catch {
            // ignore
          }
        }
        unsubs.length = 0;
        try {
          ws.close(1000, "LAN candidate failed");
        } catch {
          // ignore
        }
        remaining -= 1;
        if (remaining <= 0) {
          failLanRace();
        }
      };

      unsubs.push(
        ws.onOpen(() => {
          if (settled || closed) {
            try {
              ws.close(1000, "LAN race already settled");
            } catch {
              // ignore
            }
            return;
          }
          settled = true;
          if (lanRaceTimer) {
            clearTimeout(lanRaceTimer);
            lanRaceTimer = null;
          }
          lanPendingCleanups.clear();
          closeLosers(ws);
          startE2eeHandshakeOnWs(ws, "lan");
        }),
        ws.onError(() => markCandidateFailed()),
        ws.onClose(() => markCandidateFailed()),
      );
    }
  };

  if (lanEndpoints.length > 0) {
    connectLanFirst();
  } else {
    connectRelay();
  }

  return {
    send: (data) => {
      if (closed) {
        const error = new Error("Transport is closed");
        emitError(error);
        throw error;
      }
      const normalized = normalizeTransportPayload(data);
      if (channelState === "handshaking") {
        if (pendingSends.length >= MAX_PENDING_SENDS) {
          pendingSends.shift();
        }
        pendingSends.push(normalized);
        return;
      }
      if (channelState !== "open") {
        logger.warn({}, "relay_e2ee_send_before_ready");
        const error = new Error("Encrypted channel not ready");
        emitError(error);
        throw error;
      }
      void enqueueEncryptedSend(normalized).catch((error) => {
        logger.warn({ err: normalizeError(error) }, "relay_e2ee_send_failed");
        emitError(error);
      });
    },
    close: (code = 1000, reason = "Normal closure") => {
      emitClose({ code, reason });
    },
    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onOpen: (handler) => {
      openHandlers.add(handler);
      if (opened) {
        invokeHandler(handler);
      }
      return () => openHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      if (closed) {
        invokeHandler(handler);
      }
      return () => closeHandlers.delete(handler);
    },
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    getRelaySecurityContext: () => (securityContext ? { ...securityContext } : null),
    getTransportMode: () => transportMode,
    onTransportModeChange: (handler) => {
      modeHandlers.add(handler);
      if (transportMode !== null) {
        invokeHandler(handler, transportMode);
      }
      return () => modeHandlers.delete(handler);
    },
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

function resolveServerId(explicitServerId: string | undefined, relayUrl: string): string {
  if (typeof explicitServerId === "string" && explicitServerId.trim().length > 0) {
    return explicitServerId.trim();
  }
  if (relayUrl) {
    try {
      const parsed = new URL(relayUrl);
      const id = parsed.searchParams.get("serverId");
      if (id && id.trim().length > 0) return id.trim();
    } catch {
      // ignore
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isE2EEHelloMessage(value: unknown): value is { type: "e2ee_hello"; key: string } {
  return (
    isRecord(value) &&
    value.type === "e2ee_hello" &&
    typeof value.key === "string" &&
    value.key.trim().length > 0
  );
}

function isE2EEReadyMessage(
  value: unknown,
): value is { type: "e2ee_ready"; authChallenge?: string } {
  return (
    isRecord(value) &&
    value.type === "e2ee_ready" &&
    (value.authChallenge === undefined ||
      (typeof value.authChallenge === "string" && value.authChallenge.trim().length > 0))
  );
}

function normalizeSdpMLineIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535) {
    return value;
  }
  return null;
}

function normalizeCandidate(raw: unknown): RtcIceCandidateInitLike | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const rec = raw as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof rec.candidate !== "string") return null;
  return {
    candidate: rec.candidate,
    sdpMid: typeof rec.sdpMid === "string" ? rec.sdpMid : null,
    sdpMLineIndex: normalizeSdpMLineIndex(rec.sdpMLineIndex),
  };
}

function extractSyncBinaryBytes(rawData: unknown): Uint8Array | null {
  if (rawData instanceof ArrayBuffer) {
    return new Uint8Array(rawData.slice(0));
  }
  if (ArrayBuffer.isView(rawData)) {
    const copy = copyArrayBufferViewToBuffer(rawData);
    return new Uint8Array(copy);
  }
  return null;
}

function toIndependentArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.byteLength, i + chunkSize));
    parts.push(String.fromCharCode(...slice));
  }
  return globalThis.btoa(parts.join(""));
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  }
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  const kp = generateKeyPair();
  out.set(kp.secretKey.subarray(0, length));
  return out;
}

function createAttemptId(): string {
  const bytes = randomBytes(16);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function emitHandlers<TArgs extends unknown[]>(
  handlers: Set<(...args: TArgs) => void>,
  ...args: TArgs
) {
  for (const handler of handlers) {
    invokeHandler(handler, ...args);
  }
}

function invokeHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => void,
  ...args: TArgs
) {
  try {
    handler(...args);
  } catch {
    // no-op
  }
}

function normalizeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(typeof error.stack === "string" ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof (timer as { unref?: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}
