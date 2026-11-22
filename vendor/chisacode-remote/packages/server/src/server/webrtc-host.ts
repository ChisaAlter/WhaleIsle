import dgram from "node:dgram";
import os from "node:os";
import type pino from "pino";
import {
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  type RTCDataChannel,
} from "werift";
import {
  getDefaultIceServers,
  type IceServerConfig,
} from "@chisacode/protocol/connection-offer";
import {
  RTC_ACTIVATE_TIMEOUT_MS,
  RTC_ATTEMPT_TTL_MS,
  RTC_DATA_CHANNEL_LABEL,
  RTC_DRAIN_TIMEOUT_MS,
  RTC_SERIAL_SEND_MAX_BYTES,
  RTC_SERIAL_SEND_MAX_FRAMES,
  type RtcIceCandidateInit,
  type WebRtcTransportMode,
  tryParseRtcUpgradeClientMessage,
} from "@chisacode/protocol/webrtc-signaling";
import type { BinaryDataChannelTransport, EncryptedChannel } from "@chisacode/relay/e2ee";

export interface WeriftIceServer {
  urls: string;
  username?: string;
  credential?: string;
}

const VIRTUAL_OR_PROXY_IFACE_RE =
  /(?:^|[\s_-])(?:utun\d*|tun\d*|tap\d*|docker\d*|br-[0-9a-f]+|vmnet\d*|vboxnet\d*|awdl\d*|llw\d*|bridge\d*|clash|flclash|mihomo|sing-box|singbox|wg\d*|wintun|zerotier|vethernet|wsl|hyper-v|default switch|teredo|isatap|npcap)/i;
const PHYSICAL_IFACE_RE = /^(?:eth\d*|en\d*|wlan\d*|wi-fi|ethernet)/i;
const TAILSCALE_IFACE_RE = /^tailscale\d*$/i;

function iceServerPriority(url: string): number {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith("stun:") || lower.startsWith("stuns:")) return 0;
  if (lower.startsWith("turn:") && /transport=tcp\b/.test(lower)) return 10;
  if (lower.startsWith("turns:") && /transport=tcp\b/.test(lower)) return 20;
  if (lower.startsWith("turn:") && /transport=udp\b/.test(lower)) return 30;
  if (lower.startsWith("turns:")) return 40;
  if (lower.startsWith("turn:")) return 50;
  return 60;
}

/**
 * Normalizes and orders ICE servers for werift:
 * `stun/stuns (0) < turn?transport=tcp (10) < turns?transport=tcp (20) < turn?transport=udp (30) < turns (40) < turn (50)`.
 */
export function orderIceServersForWerift(
  servers?: readonly IceServerConfig[] | null,
): WeriftIceServer[] {
  const source = servers && servers.length > 0 ? servers : getDefaultIceServers();
  const flat: Array<{ server: WeriftIceServer; priority: number; index: number }> = [];
  let index = 0;
  for (const entry of source) {
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    for (const rawUrl of urls) {
      const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
      if (!url) continue;
      flat.push({
        server: {
          urls: url,
          ...(entry.username !== undefined ? { username: entry.username } : {}),
          ...(entry.credential !== undefined ? { credential: entry.credential } : {}),
        },
        priority: iceServerPriority(url),
        index: index++,
      });
    }
  }
  flat.sort((a, b) => a.priority - b.priority || a.index - b.index);
  return flat.map((item) => item.server);
}

function stripIpv6Zone(ip: string): string {
  const pct = ip.indexOf("%");
  return pct === -1 ? ip : ip.slice(0, pct);
}

function normalizeMappedIpv4(ip: string): string {
  const clean = stripIpv6Zone(ip).toLowerCase();
  if (clean.startsWith("::ffff:")) {
    return clean.slice("::ffff:".length);
  }
  return clean;
}

/** Proxy TUN fake IP range RFC 2544: 198.18.0.0/15 (including ::ffff:198.18.*). */
export function isProxyFakeIp(ip: string): boolean {
  const normalized = normalizeMappedIpv4(ip);
  const parts = normalized.split(".");
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return a === 198 && (b === 18 || b === 19);
}

/** Tailscale CGNAT (100.64.0.0/10) and ULA (fd7a:115c:a1e0::/48). */
export function isTailscaleIp(ip: string): boolean {
  const normalized = normalizeMappedIpv4(ip);
  if (normalized.startsWith("fd7a:115c:a1e0:")) {
    return true;
  }
  const parts = normalized.split(".");
  if (parts.length === 4) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 100 && b >= 64 && b <= 127) {
      return true;
    }
  }
  return false;
}

export function isLinkLocalIp(ip: string): boolean {
  const normalized = normalizeMappedIpv4(ip);
  if (normalized.startsWith("fe80:")) return true;
  const parts = normalized.split(".");
  if (parts.length === 4) {
    return Number(parts[0]) === 169 && Number(parts[1]) === 254;
  }
  return false;
}

export function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeMappedIpv4(ip);
  if (normalized === "::1") return true;
  const parts = normalized.split(".");
  if (parts.length === 4) {
    return Number(parts[0]) === 127;
  }
  return false;
}

export function isPrivateLanIp(ip: string): boolean {
  const normalized = normalizeMappedIpv4(ip);
  if (isTailscaleIp(normalized)) return false;
  if (isLoopbackIp(normalized) || isLinkLocalIp(normalized)) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return normalized.includes(":");
  }
  const parts = normalized.split(".");
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export interface DetectedHostCandidates {
  ipv4: string[];
  ipv6: string[];
  blockedHostIps: Set<string>;
}

async function probeDefaultRouteIpv4(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const finish = (ip: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(ip);
    };
    socket.once("error", () => finish(null));
    try {
      socket.connect(53, "1.1.1.1", () => {
        try {
          const addr = socket.address();
          finish(typeof addr === "object" && addr?.address ? addr.address : null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

export async function detectHostCandidates(): Promise<DetectedHostCandidates> {
  const defaultRouteIp = await probeDefaultRouteIpv4();
  const interfaces = os.networkInterfaces();
  const ipv4Candidates: Array<{ address: string; score: number }> = [];
  const ipv6Candidates: Array<{ address: string; score: number }> = [];
  const blockedHostIps = new Set<string>();

  for (const [name, rows] of Object.entries(interfaces)) {
    if (!rows) continue;
    const isTailscaleIface = TAILSCALE_IFACE_RE.test(name);
    const hasTailscaleUla = rows.some((row) =>
      stripIpv6Zone(row.address).toLowerCase().startsWith("fd7a:115c:a1e0:"),
    );
    const isTailscaleMacUtun = /^utun\d*$/i.test(name) && hasTailscaleUla;
    const isVirtualOrProxy =
      !isTailscaleIface && !isTailscaleMacUtun && VIRTUAL_OR_PROXY_IFACE_RE.test(name);

    for (const row of rows) {
      if (!row || !row.address || row.internal) continue;
      const address = stripIpv6Zone(row.address);
      if (isProxyFakeIp(address) || isLinkLocalIp(address)) {
        blockedHostIps.add(address.toLowerCase());
        continue;
      }
      if (isVirtualOrProxy) {
        blockedHostIps.add(address.toLowerCase());
        continue;
      }

      let score = 0;
      if (defaultRouteIp && address === defaultRouteIp) score += 10_000;
      if (PHYSICAL_IFACE_RE.test(name)) score += 1_000;
      if (isTailscaleIface || isTailscaleMacUtun || isTailscaleIp(address)) {
        score += 100;
      } else if (isPrivateLanIp(address)) {
        score += 500;
      }

      if (row.family === "IPv4") {
        ipv4Candidates.push({ address, score });
      } else if (row.family === "IPv6") {
        ipv6Candidates.push({ address, score });
      }
    }
  }

  ipv4Candidates.sort((a, b) => b.score - a.score);
  ipv6Candidates.sort((a, b) => b.score - a.score);

  const dedupe = (items: Array<{ address: string }>) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.address)) continue;
      seen.add(item.address);
      out.push(item.address);
    }
    return out;
  };

  return {
    ipv4: dedupe(ipv4Candidates),
    ipv6: dedupe(ipv6Candidates),
    blockedHostIps,
  };
}

/**
 * Checks whether a single ICE candidate line should be emitted/accepted.
 * Filters out proxy RFC 2544 fake IPs and virtual/proxy TUN host candidates.
 */
export function isAllowedIceCandidateLine(
  candidateLine: string,
  blockedHostIps: ReadonlySet<string>,
): boolean {
  const cleaned = candidateLine.replace(/^a=/, "").trim();
  if (!cleaned.startsWith("candidate:")) return true;
  const parts = cleaned.split(/\s+/);
  // candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ <type> ...
  if (parts.length < 8) return true;
  const ip = stripIpv6Zone(parts[4] ?? "").toLowerCase();
  const typIndex = parts.indexOf("typ");
  const candidateType = typIndex !== -1 ? (parts[typIndex + 1] ?? "").toLowerCase() : "";

  if (!ip) return true;
  if (isProxyFakeIp(ip)) return false;
  if (candidateType === "host" && blockedHostIps.has(ip)) return false;
  return true;
}

export function filterSdpCandidates(sdp: string, blockedHostIps: ReadonlySet<string>): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  return sdp
    .split(/\r?\n/)
    .filter((line) => {
      if (!line.startsWith("a=candidate:")) return true;
      return isAllowedIceCandidateLine(line, blockedHostIps);
    })
    .join(eol);
}

export function normalizeSdpMLineIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

/**
 * Detaches a werift DataChannel message from Node's shared 8 KiB Buffer slab pool.
 * Never use `Buffer.slice()` on werift payloads!
 */
export function detachWeriftMessageBytes(raw: unknown): Uint8Array | null {
  if (typeof raw === "string") {
    return new TextEncoder().encode(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw.slice(0));
  }
  if (ArrayBuffer.isView(raw)) {
    const detached = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return new Uint8Array(detached);
  }
  return null;
}

export interface StatsCandidateLike {
  candidateType?: string;
  address?: string;
  ip?: string;
}

export function classifySelectedCandidatePair(
  local: StatsCandidateLike | undefined,
  remote: StatsCandidateLike | undefined,
): WebRtcTransportMode {
  const localType = String(local?.candidateType ?? "").toLowerCase();
  const remoteType = String(remote?.candidateType ?? "").toLowerCase();
  if (localType === "relay" || remoteType === "relay") {
    return "turn";
  }

  const localIp = String(local?.address ?? local?.ip ?? "").trim();
  const remoteIp = String(remote?.address ?? remote?.ip ?? "").trim();

  if (localIp && isTailscaleIp(localIp)) return "p2p";
  if (remoteIp && isTailscaleIp(remoteIp)) return "p2p";

  const isLocalDirectType = localType === "host" || localType === "prflx";
  const isRemoteDirectType = remoteType === "host" || remoteType === "prflx";

  if (isLocalDirectType && isRemoteDirectType) {
    const localPrivate = localIp ? isPrivateLanIp(localIp) : false;
    const remotePrivate = remoteIp ? isPrivateLanIp(remoteIp) : false;
    const remoteHiddenOrMdns = !remoteIp || remoteIp.endsWith(".local");
    const localHiddenOrMdns = !localIp || localIp.endsWith(".local");

    if (localPrivate && (remotePrivate || remoteHiddenOrMdns)) {
      return "lan";
    }
    if (remotePrivate && localHiddenOrMdns) {
      return "lan";
    }
  }

  return "p2p";
}

function statsValues(stats: unknown): Array<Record<string, unknown>> {
  if (!stats || typeof stats !== "object") return [];
  if (typeof (stats as { values?: unknown }).values === "function") {
    return Array.from((stats as Map<string, Record<string, unknown>>).values());
  }
  if (Array.isArray(stats)) {
    return stats as Array<Record<string, unknown>>;
  }
  return Object.values(stats as Record<string, Record<string, unknown>>);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

/**
 * Inspects PeerConnection `getStats()` up to 5 x 50ms (250ms per-call timeout)
 * to authoritatively classify the active WebRTC path as `"lan" | "p2p" | "turn"`.
 */
export async function inspectSelectedPath(
  pc: Pick<RTCPeerConnection, "getStats">,
  options?: { maxAttempts?: number; retryDelayMs?: number; callTimeoutMs?: number },
): Promise<WebRtcTransportMode> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 50;
  const callTimeoutMs = options?.callTimeoutMs ?? 250;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const report = await withTimeout(pc.getStats(), callTimeoutMs);
      const entries = statsValues(report);
      const localCandidates = new Map<string, StatsCandidateLike>();
      const remoteCandidates = new Map<string, StatsCandidateLike>();
      const candidatePairs = new Map<string, Record<string, unknown>>();
      let transportSelectedPairId: string | null = null;

      for (const entry of entries) {
        const type = entry.type;
        const id = typeof entry.id === "string" ? entry.id : "";
        if (type === "local-candidate" && id) {
          localCandidates.set(id, entry as StatsCandidateLike);
        } else if (type === "remote-candidate" && id) {
          remoteCandidates.set(id, entry as StatsCandidateLike);
        } else if (type === "candidate-pair" && id) {
          candidatePairs.set(id, entry);
        } else if (
          type === "transport" &&
          typeof entry.selectedCandidatePairId === "string" &&
          entry.selectedCandidatePairId
        ) {
          transportSelectedPairId = entry.selectedCandidatePairId;
        }
      }

      let selectedPair: Record<string, unknown> | undefined;
      if (transportSelectedPairId) {
        selectedPair = candidatePairs.get(transportSelectedPairId);
      }
      if (!selectedPair) {
        for (const pair of candidatePairs.values()) {
          if (pair.selected === true) {
            selectedPair = pair;
            break;
          }
        }
      }
      if (!selectedPair) {
        for (const pair of candidatePairs.values()) {
          if (pair.nominated === true && pair.state === "succeeded") {
            selectedPair = pair;
            break;
          }
        }
      }
      if (!selectedPair) {
        for (const pair of candidatePairs.values()) {
          if (pair.state === "succeeded") {
            selectedPair = pair;
            break;
          }
        }
      }

      if (selectedPair) {
        const localId =
          typeof selectedPair.localCandidateId === "string" ? selectedPair.localCandidateId : "";
        const remoteId =
          typeof selectedPair.remoteCandidateId === "string" ? selectedPair.remoteCandidateId : "";
        const local = localCandidates.get(localId);
        const remote = remoteCandidates.get(remoteId);
        if (local || remote) {
          return classifySelectedCandidatePair(local, remote);
        }
      }
    } catch {
      // Retry on transient getStats() timeout or empty state right after DC open
    }
    if (attempt < maxAttempts - 1) {
      await sleepMs(retryDelayMs);
    }
  }

  return "p2p";
}

/**
 * Wraps a werift RTCDataChannel into a `BinaryDataChannelTransport` with:
 * - Node Buffer slab-pool detachment on receive
 * - Bounded serial send queue (8 MiB / 256 frames)
 * - ZERO `bufferedAmount === 0` watchdog timers
 * - Strict handler cleanup on close
 */
export function createWeriftDataChannelTransport(
  dc: RTCDataChannel,
  pc: RTCPeerConnection,
): BinaryDataChannelTransport & { detachAllHandlers: () => void } {
  const sendQueue: Uint8Array[] = [];
  let queuedBytes = 0;
  let draining = false;
  let closed = false;

  const transport: BinaryDataChannelTransport & { detachAllHandlers: () => void } = {
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data: Uint8Array) {
      if (closed || dc.readyState !== "open") {
        throw new Error("WebRTC DataChannel is not open");
      }
      if (
        sendQueue.length >= RTC_SERIAL_SEND_MAX_FRAMES ||
        queuedBytes + data.byteLength > RTC_SERIAL_SEND_MAX_BYTES
      ) {
        throw new Error(
          `WebRTC serial send queue limit exceeded (${RTC_SERIAL_SEND_MAX_FRAMES} frames / ${RTC_SERIAL_SEND_MAX_BYTES} bytes)`,
        );
      }
      sendQueue.push(data);
      queuedBytes += data.byteLength;
      if (!draining) {
        draining = true;
        try {
          while (sendQueue.length > 0 && !closed && dc.readyState === "open") {
            const next = sendQueue.shift()!;
            queuedBytes -= next.byteLength;
            dc.send(Buffer.from(next.buffer, next.byteOffset, next.byteLength));
          }
        } finally {
          draining = false;
        }
      }
    },
    close(_code?: number, _reason?: string) {
      if (closed) return;
      closed = true;
      sendQueue.length = 0;
      queuedBytes = 0;
      detachAllHandlers();
      try {
        dc.close();
      } catch {
        // ignore
      }
      void pc.close().catch(() => undefined);
    },
    detachAllHandlers,
  };

  const unsubMessage = dc.onMessage.subscribe((raw) => {
    if (closed) return;
    const bytes = detachWeriftMessageBytes(raw);
    if (!bytes) return;
    transport.onmessage?.(bytes);
  });

  const unsubState = dc.stateChanged.subscribe((state) => {
    if (state === "closed" || state === "closing") {
      if (closed) return;
      closed = true;
      sendQueue.length = 0;
      queuedBytes = 0;
      const onclose = transport.onclose;
      detachAllHandlers();
      onclose?.(1000, "DataChannel closed");
    }
  });

  const unsubError = dc.error.subscribe((err) => {
    if (closed) return;
    transport.onerror?.(err instanceof Error ? err : new Error(String(err)));
  });

  function detachAllHandlers(): void {
    transport.onmessage = null;
    transport.onclose = null;
    transport.onerror = null;
    try {
      unsubMessage.unSubscribe();
    } catch {
      // ignore
    }
    try {
      unsubState.unSubscribe();
    } catch {
      // ignore
    }
    try {
      unsubError.unSubscribe();
    } catch {
      // ignore
    }
  }

  return transport;
}

interface PendingUpgradeAttempt {
  readonly attemptId: string;
  readonly pc: RTCPeerConnection;
  readonly blockedHostIps: ReadonlySet<string>;
  readonly pendingIce: Array<RtcIceCandidateInit | null>;
  remoteDescriptionSet: boolean;
  dc: RTCDataChannel | null;
  dcTransport: (BinaryDataChannelTransport & { detachAllHandlers: () => void }) | null;
  dcOpenPromise: Promise<BinaryDataChannelTransport>;
  resolveDcOpen: (transport: BinaryDataChannelTransport) => void;
  rejectDcOpen: (error: Error) => void;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  activated: boolean;
  disposed: boolean;
  unsubPeerCallbacks: Array<() => void>;
}

export interface WebRtcHostSessionControllerOptions {
  channel: EncryptedChannel;
  logger: pino.Logger;
  iceServers?: readonly IceServerConfig[];
  onTransportModeChange?: (mode: WebRtcTransportMode) => void;
  attemptTtlMs?: number;
  activateTimeoutMs?: number;
  drainTimeoutMs?: number;
  /** Optional override for tests (e.g. skip default route probe or custom stats). */
  detectHostCandidates?: () => Promise<DetectedHostCandidates>;
}

export class WebRtcHostSessionController {
  private readonly channel: EncryptedChannel;
  private readonly logger: pino.Logger;
  private readonly configuredIceServers: readonly IceServerConfig[];
  private readonly onTransportModeChange?: (mode: WebRtcTransportMode) => void;
  private readonly attemptTtlMs: number;
  private readonly activateTimeoutMs: number;
  private readonly drainTimeoutMs: number;
  private readonly detectHostCandidatesFn: () => Promise<DetectedHostCandidates>;

  private authenticated = false;
  private currentAttempt: PendingUpgradeAttempt | null = null;
  private activePc: RTCPeerConnection | null = null;
  private disposed = false;

  constructor(options: WebRtcHostSessionControllerOptions) {
    this.channel = options.channel;
    this.logger = options.logger;
    this.configuredIceServers = options.iceServers ?? [];
    this.onTransportModeChange = options.onTransportModeChange;
    this.attemptTtlMs = options.attemptTtlMs ?? RTC_ATTEMPT_TTL_MS;
    this.activateTimeoutMs = options.activateTimeoutMs ?? RTC_ACTIVATE_TIMEOUT_MS;
    this.drainTimeoutMs = options.drainTimeoutMs ?? RTC_DRAIN_TIMEOUT_MS;
    this.detectHostCandidatesFn = options.detectHostCandidates ?? detectHostCandidates;
  }

  markAuthenticated(): void {
    this.authenticated = true;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  handleSignalingMessage(raw: unknown): void {
    if (this.disposed) return;

    const msg = tryParseRtcUpgradeClientMessage(raw);
    if (!msg) {
      const attemptId =
        raw && typeof raw === "object" && "attemptId" in raw && typeof (raw as { attemptId?: unknown }).attemptId === "string"
          ? (raw as { attemptId: string }).attemptId.slice(0, 64)
          : "";
      if (attemptId) {
        this.sendAbort(attemptId, "invalid_signaling_message");
      }
      return;
    }

    if (!this.authenticated) {
      this.logger.warn(
        { type: msg.type, attemptId: msg.attemptId },
        "webrtc_upgrade_rejected_unauthenticated",
      );
      this.sendAbort(msg.attemptId, "unauthenticated");
      return;
    }

    switch (msg.type) {
      case "rtc_upgrade_offer":
        void this.handleOffer(msg.attemptId, msg.sdp);
        break;
      case "rtc_upgrade_ice":
        void this.handleIce(msg.attemptId, msg.candidate);
        break;
      case "rtc_upgrade_activate":
        void this.handleActivate(msg.attemptId, msg.clientPreviousLegEndSeq);
        break;
      case "rtc_upgrade_abort":
        this.handleAbort(msg.attemptId, msg.reason);
        break;
    }
  }

  private sendSignaling(payload: Record<string, unknown>): void {
    if (this.disposed || !this.channel.isOpen()) return;
    void this.channel.send(JSON.stringify(payload)).catch((err) => {
      this.logger.warn({ err, type: payload.type }, "webrtc_signaling_send_failed");
    });
  }

  private sendAbort(attemptId: string, reason: string): void {
    this.sendSignaling({
      type: "rtc_upgrade_abort",
      attemptId,
      reason,
    });
  }

  private cleanupAttempt(attempt: PendingUpgradeAttempt, closePeer: boolean): void {
    if (attempt.disposed) return;
    attempt.disposed = true;
    if (attempt.ttlTimer) {
      clearTimeout(attempt.ttlTimer);
      attempt.ttlTimer = null;
    }
    if (this.currentAttempt === attempt) {
      this.currentAttempt = null;
    }
    for (const unsub of attempt.unsubPeerCallbacks) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    attempt.unsubPeerCallbacks.length = 0;

    if (!attempt.activated) {
      attempt.rejectDcOpen(new Error("WebRTC upgrade attempt aborted"));
      if (attempt.dcTransport) {
        this.channel.detachWebRtcReceiveLeg(attempt.dcTransport);
        attempt.dcTransport.detachAllHandlers();
      }
      if (closePeer) {
        try {
          attempt.dc?.close();
        } catch {
          // ignore
        }
        void attempt.pc.close().catch(() => undefined);
      }
    }
  }

  private async handleOffer(attemptId: string, sdp: string): Promise<void> {
    if (this.disposed || this.channel.isWebRtcActive()) {
      this.sendAbort(attemptId, "already_upgraded");
      return;
    }

    if (!sdp.includes("v=0") || !sdp.includes("m=application")) {
      this.sendAbort(attemptId, "invalid_offer_sdp");
      return;
    }

    if (this.currentAttempt) {
      this.cleanupAttempt(this.currentAttempt, true);
    }

    let attempt: PendingUpgradeAttempt | null = null;
    try {
      const hostCandidates = await this.detectHostCandidatesFn();
      if (this.disposed || !this.channel.isOpen()) return;

      const orderedIceServers = orderIceServersForWerift(this.configuredIceServers);
      const additionalHostAddresses = [...hostCandidates.ipv4, ...hostCandidates.ipv6];

      const pc = new RTCPeerConnection({
        iceServers: orderedIceServers,
        iceUseIpv4: true,
        iceUseIpv6: hostCandidates.ipv6.length > 0,
        iceUseLinkLocalAddress: false,
        ...(additionalHostAddresses.length > 0
          ? { iceAdditionalHostAddresses: additionalHostAddresses }
          : {}),
      });

      let resolveDcOpen!: (transport: BinaryDataChannelTransport) => void;
      let rejectDcOpen!: (error: Error) => void;
      const dcOpenPromise = new Promise<BinaryDataChannelTransport>((resolve, reject) => {
        resolveDcOpen = resolve;
        rejectDcOpen = reject;
      });
      // Prevent unhandled rejection when attempt aborts before activate awaits it
      dcOpenPromise.catch(() => undefined);

      attempt = {
        attemptId,
        pc,
        blockedHostIps: hostCandidates.blockedHostIps,
        pendingIce: [],
        remoteDescriptionSet: false,
        dc: null,
        dcTransport: null,
        dcOpenPromise,
        resolveDcOpen,
        rejectDcOpen,
        ttlTimer: null,
        activated: false,
        disposed: false,
        unsubPeerCallbacks: [],
      };
      this.currentAttempt = attempt;

      const current = attempt;
      current.ttlTimer = setTimeout(() => {
        if (current.disposed || current.activated) return;
        this.logger.warn({ attemptId }, "webrtc_upgrade_attempt_ttl_expired");
        this.sendAbort(attemptId, "attempt_ttl_expired");
        this.cleanupAttempt(current, true);
      }, this.attemptTtlMs);
      (current.ttlTimer as unknown as { unref?: () => void }).unref?.();

      const unsubDc = pc.onDataChannel.subscribe((dc) => {
        if (current.disposed || dc.label !== RTC_DATA_CHANNEL_LABEL) {
          return;
        }
        current.dc = dc;
        const dcTransport = createWeriftDataChannelTransport(dc, pc);
        current.dcTransport = dcTransport;

        const onDcOpen = () => {
          if (current.disposed) return;
          try {
            if (!this.channel.isWebRtcActive() && this.channel.isOpen()) {
              this.channel.attachWebRtcReceiveLeg(dcTransport);
            }
          } catch {
            // Channel may have closed concurrently
          }
          current.resolveDcOpen(dcTransport);
        };

        if (dc.readyState === "open") {
          onDcOpen();
        } else {
          const unsubOpen = dc.stateChanged.subscribe((state) => {
            if (state === "open") {
              unsubOpen.unSubscribe();
              onDcOpen();
            } else if (state === "closed") {
              unsubOpen.unSubscribe();
              current.rejectDcOpen(new Error("DataChannel closed before opening"));
            }
          });
          current.unsubPeerCallbacks.push(() => unsubOpen.unSubscribe());
        }
      });
      current.unsubPeerCallbacks.push(() => unsubDc.unSubscribe());

      const unsubIce = pc.onIceCandidate.subscribe((candidate) => {
        if (current.disposed || this.disposed) return;
        if (!candidate) {
          this.sendSignaling({
            type: "rtc_upgrade_ice",
            attemptId,
            candidate: null,
          });
          return;
        }
        const candStr = candidate.candidate ?? "";
        if (candStr && !isAllowedIceCandidateLine(candStr, current.blockedHostIps)) {
          return;
        }
        this.sendSignaling({
          type: "rtc_upgrade_ice",
          attemptId,
          candidate: {
            candidate: candStr,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: normalizeSdpMLineIndex(candidate.sdpMLineIndex),
          },
        });
      });
      current.unsubPeerCallbacks.push(() => unsubIce.unSubscribe());

      await pc.setRemoteDescription(new RTCSessionDescription(sdp, "offer"));
      if (current.disposed || this.disposed) return;
      current.remoteDescriptionSet = true;

      // Flush any early ICE candidates that arrived while setRemoteDescription was pending
      while (current.pendingIce.length > 0 && !current.disposed) {
        const nextIce = current.pendingIce.shift()!;
        await this.applyIceCandidate(current, nextIce);
      }

      const answer = await pc.createAnswer();
      if (current.disposed || this.disposed) return;
      await Promise.resolve(pc.setLocalDescription(answer)).then(() => undefined);
      if (current.disposed || this.disposed) return;

      const rawAnswerSdp = pc.localDescription?.sdp ?? answer.sdp;
      const filteredAnswerSdp = filterSdpCandidates(rawAnswerSdp, current.blockedHostIps);

      this.sendSignaling({
        type: "rtc_upgrade_answer",
        attemptId,
        sdp: filteredAnswerSdp,
        ...(this.configuredIceServers.length > 0
          ? { iceServers: [...this.configuredIceServers] }
          : {}),
      });
    } catch (err) {
      this.logger.warn({ err, attemptId }, "webrtc_upgrade_offer_failed");
      if (attempt) {
        this.cleanupAttempt(attempt, true);
      }
      this.sendAbort(attemptId, err instanceof Error ? err.message : "offer_failed");
    }
  }

  private async applyIceCandidate(
    attempt: PendingUpgradeAttempt,
    candidate: RtcIceCandidateInit | null,
  ): Promise<void> {
    if (attempt.disposed || !candidate || !candidate.candidate) {
      return;
    }
    if (!isAllowedIceCandidateLine(candidate.candidate, attempt.blockedHostIps)) {
      return;
    }
    try {
      await attempt.pc.addIceCandidate(
        new RTCIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? undefined,
          sdpMLineIndex: normalizeSdpMLineIndex(candidate.sdpMLineIndex) ?? undefined,
        }),
      );
    } catch (err) {
      this.logger.debug({ err, attemptId: attempt.attemptId }, "webrtc_add_ice_candidate_ignored");
    }
  }

  private async handleIce(
    attemptId: string,
    candidate: RtcIceCandidateInit | null,
  ): Promise<void> {
    const attempt = this.currentAttempt;
    if (!attempt || attempt.disposed || attempt.attemptId !== attemptId) {
      return;
    }
    if (!attempt.remoteDescriptionSet) {
      attempt.pendingIce.push(candidate);
      return;
    }
    await this.applyIceCandidate(attempt, candidate);
  }

  private async handleActivate(
    attemptId: string,
    clientPreviousLegEndSeq: number,
  ): Promise<void> {
    const attempt = this.currentAttempt;
    if (!attempt || attempt.disposed || attempt.attemptId !== attemptId) {
      this.sendAbort(attemptId, "unknown_attempt");
      return;
    }
    if (attempt.activated) {
      return;
    }

    try {
      const dcTransport = await withTimeout(attempt.dcOpenPromise, this.activateTimeoutMs);
      if (attempt.disposed || this.disposed || !this.channel.isOpen()) {
        return;
      }

      const mode = await inspectSelectedPath(attempt.pc);
      if (attempt.disposed || this.disposed || !this.channel.isOpen()) {
        return;
      }

      attempt.activated = true;
      if (attempt.ttlTimer) {
        clearTimeout(attempt.ttlTimer);
        attempt.ttlTimer = null;
      }
      this.activePc = attempt.pc;
      this.currentAttempt = null;

      // Atomically send rtc_upgrade_activated as the LAST frame on Relay WS,
      // cut outbound traffic to DataChannel, and drain Relay WS up to clientPreviousLegEndSeq.
      this.channel.activateWebRtcLeg({
        dcTransport,
        peerPreviousLegEndSeq: BigInt(clientPreviousLegEndSeq),
        drainTimeoutMs: this.drainTimeoutMs,
        buildFinalPrimaryLegMessage: (seq) =>
          JSON.stringify({
            type: "rtc_upgrade_activated",
            attemptId,
            mode,
            hostPreviousLegEndSeq: Number(seq),
          }),
      });

      this.logger.info({ attemptId, mode }, "webrtc_upgrade_activated");
      this.onTransportModeChange?.(mode);
    } catch (err) {
      this.logger.warn({ err, attemptId }, "webrtc_upgrade_activate_failed");
      this.cleanupAttempt(attempt, true);
      this.sendAbort(attemptId, err instanceof Error ? err.message : "activate_failed");
    }
  }

  private handleAbort(attemptId: string, reason?: string): void {
    const attempt = this.currentAttempt;
    if (!attempt || attempt.attemptId !== attemptId) return;
    this.logger.info({ attemptId, reason }, "webrtc_upgrade_aborted_by_client");
    this.cleanupAttempt(attempt, true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.currentAttempt) {
      this.cleanupAttempt(this.currentAttempt, true);
    }
    if (this.activePc) {
      const pc = this.activePc;
      this.activePc = null;
      void pc.close().catch(() => undefined);
    }
  }
}
